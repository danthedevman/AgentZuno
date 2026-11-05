import { BSON, ObjectId } from 'mongodb';
const collations = new WeakMap();
async function ensureCollation(pool) {
  if (!collations.has(pool))
    collations.set(
      pool,
      (async () => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SELECT pg_advisory_xact_lock(hashtext('agentzuno:list-collation'))");
          await client.query(
            "CREATE COLLATION IF NOT EXISTS az_list_order (provider = icu, locale = 'und-u-kn-true-ks-level1', deterministic = false)",
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      })().catch((error) => {
        collations.delete(pool);
        throw error;
      }),
    );
  await collations.get(pool);
}
const encode = (value) => BSON.EJSON.serialize(value, { relaxed: false });

// Only repository-owned fields and operators reach this compiler. Values are always parameters.
export function nativeFilter(filter, values, doc = 'doc') {
  const bind = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  const field = (name) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_.]{0,100}$/.test(name)) throw new Error('Invalid query field.');
    const path = name.split('.');
    return `(${doc} #> ${bind(path)}::text[])`;
  };
  const scalar = (name, value) => {
    const expression = field(name);
    const encoded = bind(JSON.stringify(encode(value)));
    return `(${expression} = ${encoded}::jsonb OR (jsonb_typeof(${expression}) = 'array' AND ${expression} @> jsonb_build_array(${encoded}::jsonb)))`;
  };
  const clauses = [];
  for (const [name, value] of Object.entries(filter)) {
    if (name === '$and' || name === '$or') {
      if (!Array.isArray(value)) throw new Error('Invalid query group.');
      clauses.push(
        value.length
          ? '(' +
              value
                .map((part) => nativeFilter(part, values, doc))
                .join(name === '$and' ? ' AND ' : ' OR ') +
              ')'
          : name === '$and'
            ? 'TRUE'
            : 'FALSE',
      );
    } else if (
      value instanceof Date ||
      value instanceof ObjectId ||
      value === null ||
      typeof value !== 'object'
    ) {
      clauses.push(
        value === null
          ? `(${field(name)} IS NULL OR ${field(name)} = 'null'::jsonb)`
          : scalar(name, value),
      );
    } else {
      let expression;
      const target = () => (expression ||= field(name));
      for (const [operator, operand] of Object.entries(value)) {
        if (operator === '$options') continue;
        if (operator === '$in' || operator === '$nin') {
          if (!Array.isArray(operand)) throw new Error('Invalid query values.');
          const matches = operand.map((item) => scalar(name, item)).join(' OR ') || 'FALSE';
          clauses.push(operator === '$in' ? `(${matches})` : `NOT COALESCE((${matches}), FALSE)`);
        } else if (operator === '$exists')
          clauses.push(`${target()} IS ${operand ? 'NOT ' : ''}NULL`);
        else if (operator === '$regex') {
          if (
            typeof operand !== 'string' ||
            operand.length > 1000 ||
            !['', 'i', undefined].includes(value.$options)
          )
            throw new Error('Invalid search expression.');
          clauses.push(
            `COALESCE(${target()} #>> '{}', '') ${value.$options === 'i' ? '~*' : '~'} ${bind(operand)}`,
          );
        } else if (['$gte', '$lte', '$gt', '$lt'].includes(operator)) {
          const comparison = { $gte: '>=', $lte: '<=', $gt: '>', $lt: '<' }[operator];
          clauses.push(
            `${nativeComparable(target(), operand instanceof Date ? 'date' : 'number')} ${comparison} ${bind(operand instanceof Date ? operand.getTime() : operand)}`,
          );
        } else if (operator === '$ne')
          clauses.push(
            operand === null
              ? `(${target()} IS NOT NULL AND ${target()} <> 'null'::jsonb)`
              : `NOT COALESCE(${scalar(name, operand)}, FALSE)`,
          );
        else if (operator === '$elemMatch')
          clauses.push(
            `EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${target()}) = 'array' THEN ${target()} ELSE '[]'::jsonb END) AS entry(value) WHERE ${nativeFilter(operand, values, 'entry.value')})`,
          );
        else throw new Error('Unsupported native list filter.');
      }
    }
  }
  return clauses.length ? '(' + clauses.join(' AND ') + ')' : 'TRUE';
}
export function nativeComparable(expression, type = 'text') {
  if (type === 'date')
    return `(CASE WHEN jsonb_typeof(${expression}) = 'object' THEN (${expression}->'$date'->>'$numberLong')::numeric WHEN jsonb_typeof(${expression}) = 'string' THEN EXTRACT(EPOCH FROM (${expression} #>> '{}')::timestamptz) * 1000 END)`;
  if (type === 'number')
    return `COALESCE((${expression}->>'$numberInt')::numeric, (${expression}->>'$numberLong')::numeric, (${expression}->>'$numberDouble')::numeric, CASE WHEN jsonb_typeof(${expression}) = 'number' THEN (${expression} #>> '{}')::numeric END)`;
  return `COALESCE(${expression}->>'$oid', ${expression} #>> '{}')`;
}
export async function nativePage(pool, ensure, decode, name, options) {
  const values = [];
  const selections = [];
  for (const source of options.sources || [{ name, filter: options.filter }]) {
    const table = await ensure(source.name);
    const filter = nativeFilter(source.filter, values);
    let kind = '';
    if (source.kind) {
      if (!['task', 'record-mention'].includes(source.kind))
        throw new Error('Invalid list record kind.');
      values.push(JSON.stringify({ kind: source.kind }));
      kind = ` || $${values.length}::jsonb`;
    }
    selections.push(`SELECT doc${kind} AS doc, id FROM ${table} WHERE ${filter}`);
  }
  const visible = `(${selections.join(' UNION ALL ')}) AS visible`;
  const countValues = [...values];
  if (!/^[a-zA-Z_][a-zA-Z0-9_.]{0,100}$/.test(options.sortField)) throw new Error('Invalid sort.');
  values.push(options.sortField.split('.'));
  let sortValue = nativeComparable(`doc #> $${values.length}::text[]`, options.sortType);
  if (options.sortType === 'status')
    sortValue = `(CASE (doc #>> $${values.length}::text[]) WHEN 'waiting-for-employee' THEN 'Awaiting Response' WHEN 'waiting-for-approval' THEN 'Awaiting Approval' ELSE doc->>'status' END)`;
  if (['text', 'status'].includes(options.sortType))
    sortValue = `NULLIF(${sortValue}, '') COLLATE az_list_order`;
  await ensureCollation(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const counted = await client.query(`SELECT COUNT(*) AS total FROM ${visible}`, countValues);
    const total = Number(counted.rows[0].total);
    if (!Number.isSafeInteger(total)) throw new Error('List size exceeded supported limits.');
    const page = Math.min(options.page, Math.max(1, Math.ceil(total / options.pageSize)));
    const direction = options.direction === 'asc' ? 'ASC' : 'DESC';
    values.push(options.pageSize, (page - 1) * options.pageSize);
    const result = await client.query(
      `SELECT doc FROM ${visible} ORDER BY ${sortValue} ${direction} NULLS LAST, id ${options.tieDirection === 'desc' ? 'DESC' : 'ASC'} LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    await client.query('COMMIT');
    return {
      rows: result.rows.map((row) => {
        const record = decode(row.doc);
        for (const [field, include] of Object.entries(options.projection || {}))
          if (!include) delete record[field];
        return record;
      }),
      total,
      page,
      pageSize: options.pageSize,
      hasNext: page * options.pageSize < total,
      sort: options.sort,
      direction: options.direction,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

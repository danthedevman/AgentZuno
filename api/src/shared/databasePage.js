const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function parseListQuery(query, columns, defaults = {}) {
  const q = query.q ?? '',
    sort = query.sort || defaults.sort || Object.keys(columns)[0];
  const direction = query.direction || defaults.direction || 'asc';
  const page = Number(query.page || 1),
    pageSize = Number(query.pageSize || 20);
  if (
    ['page', 'pageSize', 'sort', 'direction'].some(
      (field) => query[field] !== undefined && typeof query[field] !== 'string',
    ) ||
    typeof q !== 'string' ||
    q.length > 200 ||
    !Object.hasOwn(columns, sort) ||
    !['asc', 'desc'].includes(direction) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 100000 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    throw Object.assign(new Error('Invalid list query.'), {
      status: 400,
      publicMessage: 'Invalid list query.',
    });
  return {
    q: q.trim(),
    sort,
    sortField: columns[sort].field || columns[sort],
    sortType: columns[sort].type || 'text',
    direction,
    page,
    pageSize,
  };
}
export function listSearch(q, fields) {
  return q
    ? { $or: fields.map((field) => ({ [field]: { $regex: escape(q), $options: 'i' } })) }
    : {};
}
const statusExpression = {
  $switch: {
    branches: [
      { case: { $eq: ['$status', 'waiting-for-employee'] }, then: 'Awaiting Response' },
      { case: { $eq: ['$status', 'waiting-for-approval'] }, then: 'Awaiting Approval' },
    ],
    default: '$status',
  },
};
export async function databasePage(store, sources, options) {
  const collection = store.collection(sources[0].name);
  if (collection.nativePage)
    return collection.nativePage({ ...options, sources, filter: sources[0].filter });
  const stages = (source) => [
    { $match: source.filter },
    ...(source.kind ? [{ $set: { kind: source.kind } }] : []),
  ];
  const sortValue = options.sortType === 'status' ? statusExpression : '$' + options.sortField;
  const pipeline = [
    ...stages(sources[0]),
    ...sources
      .slice(1)
      .map((source) => ({ $unionWith: { coll: source.name, pipeline: stages(source) } })),
    { $set: { _listValue: sortValue } },
    {
      $set: {
        _listMissing: {
          $cond: [
            {
              $or: [
                { $eq: [{ $ifNull: ['$_listValue', null] }, null] },
                { $eq: ['$_listValue', ''] },
              ],
            },
            1,
            0,
          ],
        },
      },
    },
    {
      $facet: {
        count: [{ $count: 'total' }],
        rows: [
          {
            $sort: {
              _listMissing: 1,
              _listValue: options.direction === 'asc' ? 1 : -1,
              _id: options.tieDirection === 'desc' ? -1 : 1,
            },
          },
          { $skip: (options.page - 1) * options.pageSize },
          { $limit: options.pageSize },
          { $project: { _listValue: 0, _listMissing: 0, ...options.projection } },
        ],
      },
    },
  ];
  const [result] = await collection
    .aggregate(pipeline, { collation: { locale: 'en', strength: 1, numericOrdering: true } })
    .toArray();
  const total = result?.count[0]?.total || 0;
  const page = Math.min(options.page, Math.max(1, Math.ceil(total / options.pageSize)));
  if (page !== options.page) return databasePage(store, sources, { ...options, page });
  return {
    rows: result?.rows || [],
    total,
    page,
    pageSize: options.pageSize,
    hasNext: page * options.pageSize < total,
    sort: options.sort,
    direction: options.direction,
  };
}

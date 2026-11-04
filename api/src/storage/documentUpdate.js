import { find, update } from 'mingo';

export function updateDocument(record, changes, arrayFilters, queryOptions, condition = {}) {
  // Mingo treats sibling filtered-array paths as conflicting; apply those paths separately.
  const ordinary = {};
  const positions = new Map();
  function positionalPath(path) {
    if (!path.includes('.$.')) return path;
    const [field, suffix] = path.split('.$.');
    if (!positions.has(field)) {
      const array = field.split('.').reduce((value, part) => value?.[part], record);
      const criteria =
        condition[field]?.$elemMatch ||
        Object.fromEntries(
          Object.entries(condition)
            .filter(([key]) => key.startsWith(field + '.'))
            .map(([key, value]) => [key.slice(field.length + 1), value]),
        );
      if (!Array.isArray(array) || !Object.keys(criteria).length)
        throw new Error('Positional update requires an array condition.');
      const matched = find(array, criteria, {}, queryOptions).next();
      const index = array.indexOf(matched);
      if (index < 0) throw new Error('Positional update did not match an array element.');
      positions.set(field, index);
    }
    return `${field}.${positions.get(field)}.${suffix}`;
  }
  for (const [operator, fields] of Object.entries(changes)) {
    for (const [originalPath, value] of Object.entries(fields)) {
      const path = positionalPath(originalPath);
      if (path.includes('$['))
        update(
          record,
          { [operator]: { [path]: value } },
          arrayFilters,
          {},
          {
            cloneMode: 'deep',
            queryOptions,
          },
        );
      else (ordinary[operator] ||= {})[path] = value;
    }
  }
  if (Object.keys(ordinary).length)
    update(record, ordinary, arrayFilters, {}, { cloneMode: 'deep', queryOptions });
}

const fail = (message) => {
  throw Object.assign(new Error(message), { status: 400, publicMessage: message });
};
export function listResponse(request, records, columns, defaults = {}) {
  if (request.query.list !== '1') return records;
  const q = request.query.q ?? '';
  const sort = request.query.sort || defaults.sort || Object.keys(columns)[0];
  const direction = request.query.direction || defaults.direction || 'asc';
  const page = Number(request.query.page || 1);
  const pageSize = Number(request.query.pageSize || 20);
  if (
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
    fail('Invalid list query.');
  const value = (record, getter) =>
    typeof getter === 'function' ? getter(record) : record[getter];
  const normalized = q.trim().toLocaleLowerCase();
  const filtered = normalized
    ? records.filter((record) =>
        Object.values(columns).some((getter) =>
          String(value(record, getter) ?? '')
            .toLocaleLowerCase()
            .includes(normalized),
        ),
      )
    : records;
  const sign = direction === 'asc' ? 1 : -1;
  const ordered = [...filtered].sort((a, b) => {
    const left = value(a, columns[sort]);
    const right = value(b, columns[sort]);
    const missingLeft = left === undefined || left === null || left === '';
    const missingRight = right === undefined || right === null || right === '';
    if (missingLeft !== missingRight) return missingLeft ? 1 : -1;
    const compared =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left ?? '').localeCompare(String(right ?? ''), undefined, {
            sensitivity: 'base',
            numeric: true,
          });
    return (
      sign * compared ||
      String(a.id || a._id || a.userId || '').localeCompare(String(b.id || b._id || b.userId || ''))
    );
  });
  const currentPage = Math.min(page, Math.max(1, Math.ceil(ordered.length / pageSize)));
  return {
    rows: ordered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    total: ordered.length,
    page: currentPage,
    pageSize,
    hasNext: currentPage * pageSize < ordered.length,
    sort,
    direction,
  };
}
export const requestListColumns = {
  Request: 'title',
  Subject: 'title',
  Status: (item) =>
    ({ 'waiting-for-employee': 'Awaiting Response', 'waiting-for-approval': 'Awaiting Approval' })[
      item.status
    ] || item.status,
  Queue: 'queueName',
  Updated: (item) => Date.parse(item.updatedAt),
};

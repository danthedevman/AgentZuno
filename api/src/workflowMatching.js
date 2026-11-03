const normalize = (value) =>
  String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
const contains = (message, phrase) => phrase && ` ${message} `.includes(` ${normalize(phrase)} `);
function requestsChoice(workflow, message) {
  const choices =
    workflow.definition?.form?.fields
      .filter((field) => field.type === 'select')
      .flatMap((field) => field.options) || [];
  return choices.some((choice) => {
    const value = normalize(choice);
    if (value.length < 3) return false;
    // Match a request for an item, rather than incidental mentions such as "Mac address" or "Windows update".
    const pattern = new RegExp(
      `(?:^| )(?:request|order|get|need|want|looking for) (?:(?:to request|to order|to get) )?(?:(?:a|an|the|new|another|replacement|work|company) )*${value}(?=$| (?:please|for|with|and|or|laptop|computer|device)(?: |$))`,
      'u',
    );
    return pattern.test(message);
  });
}
export function findWorkflowMatch(workflows, department, text, includeForm = false) {
  const message = normalize(text);
  const candidates = workflows.filter(
    (item) => !department || item.department === 'general' || item.department === department,
  );
  const literal = candidates.find((item) =>
    item.keywords.some((keyword) => contains(message, keyword)),
  );
  if (literal) return literal;
  if (!includeForm) return null;
  const offered = candidates.filter((item) => requestsChoice(item, message));
  return offered.length === 1 ? offered[0] : null;
}

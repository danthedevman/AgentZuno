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

const actionFamilies = [
  ['update', 'edit', 'change', 'modify', 'revise', 'correct'],
  ['create', 'add', 'publish'],
  ['remove', 'delete'],
  ['reset', 'recover'],
  ['request', 'order', 'get', 'need', 'want'],
];
const generalWords = new Set([
  'a',
  'an',
  'the',
  'i',
  'we',
  'my',
  'our',
  'your',
  'to',
  'for',
  'in',
  'on',
  'of',
  'and',
  'with',
  'please',
  'can',
  'could',
  'would',
  'employee',
  'user',
  'request',
  'form',
  'help',
  'support',
  'item',
  'new',
  'work',
]);
const words = (value) =>
  normalize(value)
    .split(' ')
    .map((word) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word));
function matchesIntent(workflow, message) {
  if (!workflow.definition?.form || /(?:^| )(?:not|never|don t|do not)(?: |$)/.test(message))
    return false;
  const vocabulary = words(
    [workflow.name || '', workflow.definition.form.title || '', ...(workflow.keywords || [])].join(
      ' ',
    ),
  );
  const messageWords = new Set(words(message));
  const actions = new Set(actionFamilies.flat());
  const specific = actionFamilies
    .slice(0, 4)
    .filter((family) => family.some((word) => messageWords.has(word)));
  const requestedActions = specific.length ? specific : [actionFamilies[4]];
  const actionMatch = requestedActions.some(
    (family) =>
      family.some((word) => messageWords.has(word)) &&
      family.some((word) => vocabulary.includes(word)),
  );
  const subjects = [
    ...new Set(
      vocabulary.filter((word) => word.length > 2 && !generalWords.has(word) && !actions.has(word)),
    ),
  ];
  return actionMatch && subjects.some((word) => messageWords.has(word));
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
  if (offered.length) return offered.length === 1 ? offered[0] : null;
  const inferred = candidates.filter((item) => matchesIntent(item, message));
  return inferred.length === 1 ? inferred[0] : null;
}

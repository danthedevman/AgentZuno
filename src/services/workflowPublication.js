import { defineWorkflow } from '../../api/sdk/workflows/index.js';

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
};

export function hasWorkflowChanges(definition, source, published) {
  if (!published) return true;
  if ((source || '').trim() !== (published.source || '').trim()) return true;
  try {
    return (
      JSON.stringify(canonical(defineWorkflow(definition))) !==
      JSON.stringify(canonical(defineWorkflow(published.definition)))
    );
  } catch {
    return true;
  }
}

export const activityLabels = {
  queued: 'Queued',
  'reading-attachments': 'Reading attachments',
  preparing: 'Preparing response',
  retrieving: 'Searching authorized knowledge',
  generating: 'Generating response',
  responding: 'Generating response',
  validating: 'Validating workflow',
  complete: 'Response',
  failed: 'Response',
};
export function chatActivity(events = [], phase = 'queued') {
  const normalize = (value) => (value === 'responding' ? 'generating' : value);
  phase = normalize(phase);
  const phases = [
    ...new Set(
      events
        .map((event) => normalize(event.phase))
        .filter((value) => value && !['complete', 'failed'].includes(value)),
    ),
  ];
  if (!['complete', 'failed'].includes(phase) && !phases.includes(phase)) phases.push(phase);
  if (!phases.length) phases.push(phase);
  return phases.map((value, index) => ({
    phase: value,
    label: activityLabels[value] || value,
    state:
      phase === 'complete' || index < phases.length - 1
        ? 'completed'
        : phase === 'failed'
          ? 'failed'
          : 'processing',
  }));
}

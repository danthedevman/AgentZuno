const labels = {
  complete: 'Complete',
  completed: 'Completed',
  queued: 'Queued',
  responding: 'Responding',
  failed: 'Failed',
  canceled: 'Canceled',
  interrupted: 'Interrupted',
};
export default function ConversationStatus(props) {
  const tone = () =>
    ['complete', 'completed'].includes(props.status)
      ? 'complete'
      : ['failed', 'canceled', 'interrupted'].includes(props.status)
        ? 'failed'
        : 'pending';
  return (
    <span class="conversation-status-badge" data-tone={tone()}>
      <span aria-hidden="true" />
      {labels[props.status] || 'Unknown'}
    </span>
  );
}

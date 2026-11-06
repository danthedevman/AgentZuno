import Skeleton from '../Skeleton.jsx';

export default function ConversationSkeleton() {
  return (
    <div
      class="conversation-skeleton"
      role="status"
      aria-label="Loading conversation"
      aria-busy="true"
    >
      <div class="conversation-skeleton-user" aria-hidden="true">
        <Skeleton lines={2} />
      </div>
      <div class="conversation-skeleton-reply" aria-hidden="true">
        <Skeleton lines={4} />
      </div>
      <div class="conversation-skeleton-user" aria-hidden="true">
        <Skeleton lines={1} />
      </div>
    </div>
  );
}

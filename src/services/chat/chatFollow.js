import { createEffect, onCleanup } from 'solid-js';

export function followChatProgress(element, revision, identity = () => '') {
  let observed;
  let following = true;
  let previousTop = 0;
  let frame;
  let thread;
  function onScroll() {
    if (!observed) return;
    if (observed.scrollTop < previousTop - 2) following = false;
    if (observed.scrollHeight - observed.clientHeight - observed.scrollTop < 72) following = true;
    previousTop = observed.scrollTop;
  }
  createEffect(() => {
    revision();
    const nextThread = identity();
    if (thread !== nextThread) {
      following = true;
      thread = nextThread;
    }
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const node = element();
      if (!node) return;
      if (node !== observed) {
        observed?.removeEventListener('scroll', onScroll);
        observed = node;
        following = true;
        previousTop = node.scrollTop;
        node.addEventListener('scroll', onScroll, { passive: true });
      }
      if (following)
        node.scrollTo({
          top: node.scrollHeight,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
        });
    });
  });
  onCleanup(() => {
    cancelAnimationFrame(frame);
    observed?.removeEventListener('scroll', onScroll);
  });
}

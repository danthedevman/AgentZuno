import { createEffect, onCleanup } from 'solid-js';

export function followChatProgress(element, revision, identity = () => '') {
  let observed;
  let following = true;
  let previousTop = 0;
  let frame;
  let thread;
  let initialized = false;
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
      initialized = false;
    }
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const node = element();
      if (!node) return;
      if (node !== observed) {
        observed?.removeEventListener('scroll', onScroll);
        observed = node;
        following = true;
        initialized = false;
        previousTop = node.scrollTop;
        node.addEventListener('scroll', onScroll, { passive: true });
      }
      if (following)
        node.scrollTo({
          top: node.scrollHeight,
          behavior:
            !initialized || window.matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 'instant'
              : 'smooth',
        });
      if (node.querySelector('article')) initialized = true;
    });
  });
  onCleanup(() => {
    cancelAnimationFrame(frame);
    observed?.removeEventListener('scroll', onScroll);
  });
}

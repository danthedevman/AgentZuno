import { createEffect, onCleanup } from 'solid-js';

export function followChatProgress(element, revision, identity = () => '', responseId = () => '') {
  let observed;
  let following = true;
  let previousTop = 0;
  let frame;
  let thread;
  let initialized = false;
  let previousResponse = '';
  function onScroll() {
    if (!observed) return;
    if (observed.scrollTop < previousTop - 2) following = false;
    if (observed.scrollHeight - observed.clientHeight - observed.scrollTop < 72) following = true;
    previousTop = observed.scrollTop;
  }
  createEffect(() => {
    revision();
    const nextThread = identity();
    const nextResponse = responseId();
    if (thread !== nextThread) {
      following = true;
      thread = nextThread;
      previousResponse = '';
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
      const response = nextResponse
        ? node.querySelector(`[data-message-id="${CSS.escape(nextResponse)}"]`)
        : null;
      if (response && nextResponse !== previousResponse && following) {
        node.scrollTo({
          top:
            node.scrollTop +
            response.getBoundingClientRect().top -
            node.getBoundingClientRect().top -
            16,
          behavior: 'instant',
        });
        previousTop = node.scrollTop;
      } else if (!nextResponse && following)
        node.scrollTo({
          top: node.scrollHeight,
          behavior:
            !initialized || window.matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 'instant'
              : 'smooth',
        });
      if (
        response &&
        (!following ||
          response.getBoundingClientRect().top - node.getBoundingClientRect().top <= 20)
      )
        previousResponse = nextResponse;
      if (node.querySelector('article')) initialized = true;
    });
  });
  onCleanup(() => {
    cancelAnimationFrame(frame);
    observed?.removeEventListener('scroll', onScroll);
  });
}

import { onMount, onCleanup } from 'solid-js';

export function useScrollHeader(element) {
  onMount(() => {
    const header = element();
    if (!header) return;
    let previousY = window.scrollY;
    let travel = 0;
    let frame;
    const measure = () =>
      header.parentElement.style.setProperty('--public-header-height', `${header.offsetHeight}px`);
    const resize = new ResizeObserver(measure);
    resize.observe(header);
    measure();
    const update = () => {
      frame = undefined;
      // Ignore browser rubber-band overscroll at either end of the document.
      const limit = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const y = Math.min(limit, Math.max(0, window.scrollY));
      const delta = y - previousY;
      if (delta && Math.sign(delta) !== Math.sign(travel)) travel = 0;
      travel += delta;
      const nearTop = y <= header.offsetHeight;
      if (nearTop || header.contains(document.activeElement)) {
        header.classList.remove('is-scroll-hidden');
        header.classList.toggle('is-scroll-returned', !nearTop);
        travel = 0;
      } else if (travel >= 32 || travel <= -16) {
        header.classList.toggle('is-scroll-hidden', travel > 0);
        header.classList.toggle('is-scroll-returned', travel < 0);
        travel = 0;
      }
      previousY = y;
    };
    const scroll = () => {
      if (frame === undefined) frame = requestAnimationFrame(update);
    };
    const focus = () => {
      header.classList.remove('is-scroll-hidden');
      header.classList.toggle('is-scroll-returned', window.scrollY > header.offsetHeight);
    };
    window.addEventListener('scroll', scroll, { passive: true });
    header.addEventListener('focusin', focus);
    update();
    onCleanup(() => {
      window.removeEventListener('scroll', scroll);
      header.removeEventListener('focusin', focus);
      resize.disconnect();
      cancelAnimationFrame(frame);
    });
  });
}

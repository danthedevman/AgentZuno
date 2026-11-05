// Keep panel shells visible while their inner content fades into the next cycle.
export function repeatMarketingAnimation(element, start, reset, duration) {
  let timer;
  let visible = false;
  let observer;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function cycle() {
    reset();
    element.classList.remove('is-restarting');
    start();
    if (reduced) return;
    timer = setTimeout(() => {
      element.classList.add('is-restarting');
      timer = setTimeout(() => {
        if (visible) cycle();
      }, 500);
    }, duration + 6000);
  }
  if (window.IntersectionObserver) {
    observer = new IntersectionObserver(
      ([entry]) => {
        const wasVisible = visible;
        visible = entry.isIntersecting;
        if (visible && !wasVisible) cycle();
        if (!visible) clearTimeout(timer);
      },
      { threshold: 0.15 },
    );
    observer.observe(element);
  } else {
    visible = true;
    cycle();
  }
  return () => {
    clearTimeout(timer);
    observer?.disconnect();
  };
}

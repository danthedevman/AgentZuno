import { createSignal, onMount, onCleanup } from 'solid-js';
export default function MarketingSection(props) {
  let element;
  const [visible, setVisible] = createSignal(false);
  onMount(() => {
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !window.IntersectionObserver
    ) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });
  return (
    <section
      ref={element}
      class={`${props.class || ''} marketing-scroll-section`}
      classList={{ 'is-visible': visible() }}
      aria-labelledby={props['aria-labelledby']}
    >
      {props.children}
    </section>
  );
}

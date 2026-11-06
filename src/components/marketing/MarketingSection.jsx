import { onMount, onCleanup } from 'solid-js';

export default function MarketingSection(props) {
  let element;
  onMount(() => {
    const targets = [
      ...element.querySelectorAll(
        '.marketing-section-intro, .marketing-copy, .marketing-live-chat, .marketing-builder, .marketing-workflow-preview, .marketing-knowledge-preview, .marketing-platform-preview, .marketing-static-preview',
      ),
    ];
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !window.IntersectionObserver
    ) {
      targets.forEach((target) => target.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
      },
      { threshold: 0, rootMargin: '0px 0px -32px 0px' },
    );
    targets.forEach((target) => {
      if (target.getBoundingClientRect().top < window.innerHeight) {
        target.classList.add('is-visible');
        return;
      }
      target.classList.add('marketing-reveal');
      observer.observe(target);
    });
    onCleanup(() => observer.disconnect());
  });
  return (
    <section
      ref={element}
      class={`${props.class || ''} marketing-scroll-section`}
      aria-labelledby={props['aria-labelledby']}
    >
      {props.children}
    </section>
  );
}

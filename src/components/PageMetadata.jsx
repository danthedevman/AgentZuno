import { createEffect } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { publicPages } from '../services/public/publicPages.js';
export default function PageMetadata() {
  const location = useLocation();
  function meta(attribute, key, value) {
    let element = document.head.querySelector(`meta[${attribute}="${key}"]`);
    if (!element) {
      element = document.createElement('meta');
      element.setAttribute(attribute, key);
      document.head.append(element);
    }
    element.content = value;
  }
  createEffect(() => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    const pathname = location.pathname.replace(/\/$/, '');
    const relative = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
    const page = publicPages.find((page) => `/${page.path}`.replace(/\/$/, '') === relative);
    meta('name', 'robots', page ? 'index,follow' : 'noindex,nofollow');
    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!page) {
      canonical?.remove();
      return;
    }
    const site =
      document.head.querySelector('meta[name="agentzuno-site-url"]')?.content ||
      new URL(import.meta.env.BASE_URL, window.location.origin).href;
    const url = new URL(page.path ? `${page.path}/` : '', site).href;
    document.title = page.title;
    meta('name', 'description', page.description);
    meta('property', 'og:title', page.title);
    meta('property', 'og:description', page.description);
    meta('property', 'og:url', url);
    meta('property', 'og:type', 'website');
    meta('property', 'og:site_name', 'AgentZuno');
    meta('property', 'og:image', new URL('agentzuno-logo-social.png', site).href);
    meta('property', 'og:image:type', 'image/png');
    meta('property', 'og:image:width', '1200');
    meta('property', 'og:image:height', '630');
    meta('property', 'og:image:alt', 'AgentZuno logo');
    meta('name', 'twitter:card', 'summary_large_image');
    meta('name', 'twitter:title', page.title);
    meta('name', 'twitter:description', page.description);
    meta('name', 'twitter:image', new URL('agentzuno-logo-social.png', site).href);
    meta('name', 'twitter:image:alt', 'AgentZuno logo');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.append(canonical);
    }
    canonical.href = url;
  });
  return null;
}

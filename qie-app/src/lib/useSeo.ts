import { useEffect } from 'react';

/**
 * Dependency-free per-route SEO/meta manager.
 *
 * Sets document.title and the description / Open Graph / Twitter meta tags for
 * the current page, then restores the previous values on unmount so SPA route
 * changes get correct, page-specific metadata (crawlers, link unfurls, tab
 * titles) without pulling in react-helmet. The static index.html tags remain the
 * default for any route that does not call this hook.
 */

export interface SeoOptions {
  title?: string;
  description?: string;
  /** Canonical/OG url; defaults to the current location when omitted. */
  url?: string;
  image?: string;
  /** og:type — "website" for landing pages, "article" for content. */
  type?: 'website' | 'article';
  /** When true, ask crawlers not to index (e.g. payer-specific invoice pages). */
  noindex?: boolean;
}

const SITE_NAME = 'Qantara';
const TITLE_SUFFIX = ' · Qantara';

function setMeta(selector: string, attr: 'name' | 'property', key: string, content: string): () => void {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  let created = false;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
    created = true;
  }
  const previous = el.getAttribute('content');
  el.setAttribute('content', content);
  return () => {
    if (created) {
      el?.remove();
    } else if (previous !== null) {
      el?.setAttribute('content', previous);
    }
  };
}

function setLink(rel: string, href: string): () => void {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  let created = false;
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
    created = true;
  }
  const previous = el.getAttribute('href');
  el.setAttribute('href', href);
  return () => {
    if (created) el?.remove();
    else if (previous !== null) el?.setAttribute('href', previous);
  };
}

export function useSeo(options: SeoOptions): void {
  const { title, description, url, image, type = 'website', noindex } = options;
  // Primitive deps keep the effect stable without re-running on every render.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const restores: Array<() => void> = [];

    const resolvedTitle = title
      ? title.endsWith(TITLE_SUFFIX) || title === SITE_NAME
        ? title
        : `${title}${TITLE_SUFFIX}`
      : undefined;
    const resolvedUrl = url ?? (typeof window !== 'undefined' ? window.location.href : undefined);

    if (resolvedTitle) {
      const prevTitle = document.title;
      document.title = resolvedTitle;
      restores.push(() => { document.title = prevTitle; });
      restores.push(setMeta('meta[property="og:title"]', 'property', 'og:title', resolvedTitle));
      restores.push(setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', resolvedTitle));
    }
    if (description) {
      restores.push(setMeta('meta[name="description"]', 'name', 'description', description));
      restores.push(setMeta('meta[property="og:description"]', 'property', 'og:description', description));
      restores.push(setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description));
    }
    if (resolvedUrl) {
      restores.push(setMeta('meta[property="og:url"]', 'property', 'og:url', resolvedUrl));
      restores.push(setLink('canonical', resolvedUrl));
    }
    if (image) {
      restores.push(setMeta('meta[property="og:image"]', 'property', 'og:image', image));
      restores.push(setMeta('meta[name="twitter:image"]', 'name', 'twitter:image', image));
    }
    restores.push(setMeta('meta[property="og:type"]', 'property', 'og:type', type));
    if (noindex) {
      restores.push(setMeta('meta[name="robots"]', 'name', 'robots', 'noindex, nofollow'));
    }

    return () => {
      for (const restore of restores.reverse()) restore();
    };
  }, [title, description, url, image, type, noindex]);
}

import { useCallback, useRef, useState } from 'react';

/**
 * Tiny one-shot IntersectionObserver hook: `inView` flips true once the element
 * scrolls near the viewport, then the observer disconnects. Used to lazy-gate
 * embedded-note fetches so off-screen embeds in a long feed don't all fetch up
 * front (which also implicitly caps concurrent fetches to what's visible).
 *
 * Degrades to `inView = true` where IntersectionObserver is unavailable (SSR /
 * jsdom / very old browsers), so content still loads.
 */
export function useInView<T extends Element>(rootMargin = '200px') {
  const [inView, setInView] = useState(typeof IntersectionObserver === 'undefined');
  const observer = useRef<IntersectionObserver | null>(null);

  const ref = useCallback(
    (node: T | null) => {
      observer.current?.disconnect();
      if (!node || typeof IntersectionObserver === 'undefined') return;
      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setInView(true);
            observer.current?.disconnect();
          }
        },
        { rootMargin }
      );
      observer.current.observe(node);
    },
    [rootMargin]
  );

  return { ref, inView };
}

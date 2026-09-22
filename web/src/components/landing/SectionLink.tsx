'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { onReady } from '../motion/Preloader';

const KEY = 'elysian.section';

/** Smooth-scrolls to a landing section. Goes through Lenis when it is running so the two never fight. */
export function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const lenis = (window as unknown as { __lenis?: { scrollTo: (target: HTMLElement, options?: { offset?: number }) => void } }).__lenis;
  if (lenis) lenis.scrollTo(el, { offset: -96 });
  else window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96, behavior: 'smooth' });
}

/**
 * A link to a section of the landing page that never puts a # in the address bar. On the landing
 * page it just scrolls; from anywhere else it goes to "/" and the landing page scrolls once it is up.
 */
export function SectionLink({ section, className, children }: { section: string; className?: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <a
      href="/"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        if (pathname === '/') return scrollToSection(section);
        try {
          sessionStorage.setItem(KEY, section);
        } catch {
          /* storage blocked: the visitor simply lands at the top */
        }
        router.push('/');
      }}
    >
      {children}
    </a>
  );
}

/** Mounted on the landing page: finishes a jump started elsewhere, and cleans up old-style # links. */
export function PendingSection() {
  useEffect(
    () =>
      onReady(() => {
        let id = window.location.hash.slice(1);
        if (id) history.replaceState(null, '', window.location.pathname);
        try {
          id = sessionStorage.getItem(KEY) ?? id;
          sessionStorage.removeItem(KEY);
        } catch {
          /* storage blocked */
        }
        if (id) setTimeout(() => scrollToSection(id), 150);
      }),
    [],
  );
  return null;
}

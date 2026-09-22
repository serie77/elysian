'use client';

import { useEffect, type ReactNode } from 'react';

/** Marks the document as the landing page for the duration of the visit (custom cursor styling). */
export function LandingRoot({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add('landing');
    return () => document.documentElement.classList.remove('landing');
  }, []);
  return <>{children}</>;
}

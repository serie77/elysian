'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Wordmark } from '../ui/Mark';
import { SectionLink } from './SectionLink';
import { Magnetic } from '../motion/Magnetic';
import { useReady } from '../motion/useReady';

const links: { label: string; section?: string; href?: string }[] = [
  { section: 'how', label: 'How it works' },
  { section: 'assets', label: 'Assets' },
  { section: 'compared', label: 'Compared' },
  { section: 'token', label: '$ELYSIAN' },
  { href: '/explorer', label: 'Explorer' },
  { href: '/protocol', label: 'Docs' },
];
const linkClass = 'text-[14px] font-medium tracking-[-0.01em] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]';

export function Nav() {
  const ready = useReady();
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 24);
      setHidden(y > last && y > 160);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className="fixed inset-x-0 top-0 z-50 transition-[transform,opacity] duration-700"
      style={{
        transform: hidden ? 'translateY(-100%)' : 'translateY(0)',
        opacity: ready ? 1 : 0,
        transitionTimingFunction: 'cubic-bezier(0.16,1,0.3,1)',
      }}
    >
      <SectionLink section="token" className="container-x flex h-8 items-center justify-between gap-4 border-b border-[var(--line)] bg-[var(--bg)] text-[12px] font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]">
        <span className="truncate">
          <span className="green">$ELYSIAN</span> launches on Pons. Creator fees become buybacks.
        </span>
        <span className="flex-none">Read how</span>
      </SectionLink>
      <div
        className="container-x flex h-16 items-center justify-between transition-colors duration-500"
        style={{
          borderBottom: `1px solid ${scrolled ? 'var(--line)' : 'transparent'}`,
          background: scrolled ? 'rgba(8,7,12,0.92)' : 'transparent',
        }}
      >
        <Link href="/" aria-label="Elysian home" className="flex items-center">
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-9 md:flex">
          {links.map((l) =>
            l.section ? (
              <SectionLink key={l.label} section={l.section} className={linkClass}>
                {l.label}
              </SectionLink>
            ) : (
              <Link key={l.label} href={l.href!} className={linkClass}>
                {l.label}
              </Link>
            ),
          )}
        </nav>
        <Magnetic radius={60} strength={0.25}>
          <Link href="/app" className="btn btn-solid h-9 px-4 text-[13px] font-medium" data-cursor="Open">
            Launch app
          </Link>
        </Magnetic>
      </div>
    </header>
  );
}

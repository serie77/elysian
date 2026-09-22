import type { ReactNode } from 'react';
import { Redact, type Segment } from '../motion/Redact';
import { Reveal } from '../motion/Reveal';

interface SectionProps {
  id?: string;
  tag: string;
  title: Segment[];
  lede?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Shared section chrome: a bar label, a title that arrives through redaction, one line of lede. */
export function Section({ id, tag, title, lede, children, className = '' }: SectionProps) {
  return (
    <section id={id} className={`relative py-24 md:py-36 ${className}`}>
      <div className="container-x">
        <Reveal className="tag-rule">
          <span className="tag">{tag}</span>
        </Reveal>
        <Redact as="h2" className="h2 mt-6 block max-w-[16ch] text-[clamp(2.4rem,6vw,5.4rem)]" segments={title} />
        {lede ? (
          <Reveal as="p" delay={260} className="mt-6 max-w-[46ch] text-[17px] font-medium leading-[1.5] tracking-[-0.01em] text-[var(--ink-2)] md:text-[19px]">
            {lede}
          </Reveal>
        ) : null}
        {children ? <div className="mt-14 md:mt-20">{children}</div> : null}
      </div>
    </section>
  );
}

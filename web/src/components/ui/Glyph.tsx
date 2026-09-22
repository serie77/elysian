import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  shield: <path d="M8 1.8l5 1.9v4c0 3-2 5.3-5 6.5c-3-1.2-5-3.5-5-6.5v-4l5-1.9Z" />,
  send: <path d="M2.5 8h10M9 4.2L12.8 8L9 11.8" />,
  bars: <path d="M3 13V8.5M6.3 13V4M9.6 13V6.5M13 13V9.5M2 3.2h12" />,
  key: (
    <>
      <circle cx="5.2" cy="8" r="2.7" />
      <path d="M7.9 8h6M11.6 8v2.4M13.9 8v1.8" />
    </>
  ),
  eye: (
    <>
      <path d="M1.6 8c1.7-3 3.9-4.5 6.4-4.5S12.7 5 14.4 8c-1.7 3-3.9 4.5-6.4 4.5S3.3 11 1.6 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </>
  ),
  arrow: <path d="M4.5 11.5l7-7M5.8 4.5h5.7v5.7" />,
};

export type GlyphName = keyof typeof paths;

/** A small line icon. Inherits color from the text around it. */
export function Glyph({ name, size = 16, className = '' }: { name: GlyphName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" aria-hidden className={className}>
      {paths[name]}
    </svg>
  );
}

/** Icon set in a solid tile, sized to sit inline inside a large sentence. */
export function Chip({ name }: { name: GlyphName }) {
  return (
    <span className="chip" aria-hidden>
      <Glyph name={name} size={16} />
    </span>
  );
}

/** Button trailing tile with an arrow. */
export function ArrowTile() {
  return (
    <span className="arrow-tile" aria-hidden>
      <Glyph name="arrow" size={12} />
    </span>
  );
}

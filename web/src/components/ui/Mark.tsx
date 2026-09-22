/**
 * The Elysian mark: a blackletter E run through by a spear. The letter is cut back on either side
 * of the spear so the two never touch. Glyph outline from Texturina Bold (SIL Open Font License),
 * fitted to a 24-unit box with the spear on the centre line.
 */
export const MARK_GLYPH = "M16.33 19.3L16.33 19.3Q15.92 19.3 15.1 19.27Q14.28 19.24 13.24 19.19Q12.21 19.13 11.11 19.07Q10.01 19.01 8.96 18.94Q7.91 18.86 7.1 18.78Q6.28 18.7 5.82 18.62L5.82 18.62Q5.82 18.41 5.88 18.21Q5.94 18.01 6.01 17.93L6.01 17.93L6.61 17.85Q6.96 17.81 7.17 17.6Q7.38 17.39 7.48 16.97Q7.58 16.54 7.58 15.82L7.58 15.82L7.58 7.58Q7.58 6.96 7.66 6.62Q7.73 6.28 7.83 6.14Q7.94 6.01 7.94 5.99L7.94 5.99L6.05 5.99Q5.97 5.9 5.89 5.73Q5.82 5.55 5.8 5.34L5.8 5.34Q5.92 5.2 6.18 5.05Q6.44 4.91 6.7 4.8Q6.96 4.7 7.08 4.7L7.08 4.7L16.31 4.7Q16.79 4.87 17.28 5.19Q17.77 5.51 18.06 5.86L18.06 5.86Q17.97 7.19 17.77 8.19Q17.56 9.2 17.41 9.7L17.41 9.7Q16.98 9.7 16.56 9.62Q16.15 9.53 15.9 9.45L15.9 9.45L15.34 6.42Q15.09 6.32 14.59 6.25Q14.09 6.17 13.39 6.11Q12.68 6.05 11.79 6.05L11.79 6.05Q11.27 6.05 11 6.26Q10.73 6.46 10.64 6.82Q10.55 7.17 10.55 7.58L10.55 7.58L10.55 11.13Q11.44 11.09 12.15 11.07Q12.85 11.05 13.49 10.98Q14.14 10.92 14.78 10.86L14.78 10.86L15.05 11.17Q15.01 11.65 14.94 11.98Q14.88 12.31 14.8 12.52L14.8 12.52L10.55 12.52L10.55 16.36Q10.55 16.83 10.43 17.2Q10.32 17.56 10.2 17.7L10.2 17.7L15.19 17.7L16.62 14.01Q17.12 14.01 17.58 14.14Q18.03 14.26 18.2 14.36L18.2 14.36Q18.2 15.07 18.15 15.83Q18.1 16.58 18.01 17.26Q17.93 17.93 17.85 18.39L17.85 18.39Q17.72 18.55 17.41 18.76Q17.1 18.97 16.8 19.13Q16.5 19.3 16.33 19.3";
export const MARK_SPEAR = "M11.85 3H12.15V21H11.85ZM12 0.3L12.52 2.5L12 3.7L11.48 2.5ZM11.48 21.5L12 20.3L12.52 21.5L12 23.7ZM11.1 4.5L12 4.24L12.9 4.5L12 4.76ZM11.1 19.5L12 19.24L12.9 19.5L12 19.76Z";
/** The strip cut out of the glyph around the spear: left edge and width. */
export const MARK_CUT = { x: 11.38, w: 1.24 };

export function Mark({ size = 22, className = '', trace = false }: { size?: number; className?: string; trace?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <defs>
        <mask id="mark-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          <rect x={MARK_CUT.x} y="0" width={MARK_CUT.w} height="24" fill="#000" />
        </mask>
      </defs>
      {trace ? (
        // Outline only, so the preloader can draw it stroke by stroke.
        <>
          <path d={MARK_GLYPH} stroke="currentColor" strokeWidth="0.28" mask="url(#mark-cut)" />
          <path d="M12 0.3V23.7" stroke="currentColor" strokeWidth="0.3" />
        </>
      ) : (
        <>
          <path d={MARK_GLYPH} fill="currentColor" mask="url(#mark-cut)" />
          <path d={MARK_SPEAR} fill="currentColor" />
        </>
      )}
    </svg>
  );
}

export function Wordmark({ className = '', size = 28 }: { className?: string; size?: number }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Mark size={size} />
      <span className="wordmark">Elysian</span>
    </span>
  );
}

import icons from '@/lib/token-icons.json';
import stockLogos from '@/lib/stock-logos.json';

const paths = icons as Record<string, string>;
/** Company logos fetched by scripts/fetch-stock-logos.mjs into /public/tokens/stocks. */
const stocks = new Set(stockLogos as string[]);

/** Memecoin logos are raster art, kept in /public/tokens. */
const images: Record<string, string> = {
  USDG: '/tokens/usdg.png',
  PONS: '/tokens/pons.png',
  AI: '/tokens/ai.jpg',
  CASHCAT: '/tokens/cashcat.jpg',
  ZZZ: '/tokens/zzz.jpg',
  BONER: '/tokens/boner.jpg',
  MEME: '/tokens/meme.png',
  ORBIO: '/tokens/orbio.jpg',
};

export const hasBrandIcon = (symbol: string) => symbol in paths || symbol in images || stocks.has(symbol);
const imageFor = (symbol: string) => images[symbol] ?? (stocks.has(symbol) ? `/tokens/stocks/${symbol}.png` : undefined);

/**
 * A token's logo. Real brand marks where an open-licensed SVG exists, otherwise a monogram in the
 * same tile so a row of tokens still reads as one family.
 */
export function TokenIcon({ symbol, size = 28, className = '' }: { symbol: string; size?: number; className?: string }) {
  const d = paths[symbol];
  const image = imageFor(symbol);
  return (
    <span
      className={`token-icon ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(8, size * (symbol.length > 3 ? 0.27 : 0.33)) }}
      aria-hidden
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" width={size} height={size} className="h-full w-full rounded-full object-cover" loading="lazy" />
      ) : d ? (
        <svg viewBox="0 0 24 24" width="58%" height="58%" fill="currentColor">
          <path d={d} />
        </svg>
      ) : (
        <span className="token-mono">{symbol.slice(0, 4)}</span>
      )}
    </span>
  );
}

import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

// The public origin, for absolute preview URLs. Set NEXT_PUBLIC_SITE_URL on the host to the real domain.
const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.elysianprotocol.org';
const title = 'Elysian · The privacy layer for Robinhood Chain';
const description = 'Buy stocks, memecoins or any token on Robinhood Chain, and send them to anyone. Privately.';

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title,
  description,
  applicationName: 'Elysian',
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Elysian',
    title,
    description,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Elysian: the privacy layer for Robinhood Chain' }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#08070c',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Elysian · The privacy layer for Robinhood Chain',
  description: 'Buy stocks, memecoins or any token on Robinhood Chain. Privately.',
  metadataBase: new URL('https://elysian.chud.tech'),
  openGraph: {
    title: 'Elysian',
    description: 'The privacy layer for Robinhood Chain.',
    type: 'website',
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

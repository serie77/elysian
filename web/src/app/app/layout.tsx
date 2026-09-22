import type { Metadata } from 'next';
import { Shell } from '@/components/app/Shell';

export const metadata: Metadata = { title: 'Elysian · Pool' };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}

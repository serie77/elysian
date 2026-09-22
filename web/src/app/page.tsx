import { Architecture } from '@/components/landing/Architecture';
import { Assets } from '@/components/landing/Assets';
import { Closing } from '@/components/landing/Closing';
import { Compared } from '@/components/landing/Compared';
import { Hero } from '@/components/landing/Hero';
import { Live } from '@/components/landing/Live';
import { Nav } from '@/components/landing/Nav';
import { PendingSection } from '@/components/landing/SectionLink';
import { Scanner } from '@/components/landing/Scanner';
import { Token } from '@/components/landing/Token';
import { Verbs } from '@/components/landing/Verbs';
import { Cursor } from '@/components/motion/Cursor';
import { Field } from '@/components/motion/Field';
import { Grain } from '@/components/motion/Grain';
import { LandingRoot } from '@/components/motion/LandingRoot';
import { Preloader } from '@/components/motion/Preloader';
import { ScrollProgress } from '@/components/motion/ScrollProgress';
import { SmoothScroll } from '@/components/motion/SmoothScroll';

export default function Landing() {
  return (
    <LandingRoot>
      <Preloader />
      <Field />
      <Grain />
      <Cursor />
      <SmoothScroll />
      <PendingSection />
      <ScrollProgress />
      <Nav />
      <main className="relative z-10">
        <Hero />
        <Scanner />
        <Verbs />
        <Architecture />
        <Assets />
        <Live />
        <Compared />
        <Token />
        <Closing />
      </main>
    </LandingRoot>
  );
}

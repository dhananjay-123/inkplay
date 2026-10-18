import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, JetBrains_Mono, Kalam } from 'next/font/google';
import { InkCursor } from '@/components/ink-cursor';
import { Magnetic } from '@/components/magnetic';
import { SiteNav } from '@/components/site-nav';
import './globals.css';

// next/font downloads at build time and self-hosts, so the offline demo works.
const bricolage = Bricolage_Grotesque({ variable: '--font-bricolage', subsets: ['latin'], display: 'swap' });
const kalam = Kalam({ variable: '--font-kalam', weight: ['300', '400', '700'], subsets: ['latin', 'devanagari'], display: 'swap' });
const jetbrains = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'INKPLAY — Draw it. Write the rules. Play it.', template: '%s · INKPLAY' },
  description:
    'Draw a level on paper, write the rules in plain words, snap a photo. Gemma 4 turns it into a playable platformer — in the cloud or fully offline.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFF7E6' },
    { media: '(prefers-color-scheme: dark)', color: '#120A2A' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${bricolage.variable} ${kalam.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <SiteNav />
        <main className="flex flex-1 flex-col">{children}</main>
        <InkCursor />
        <Magnetic />
      </body>
    </html>
  );
}

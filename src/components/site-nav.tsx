import Link from 'next/link';

const LINKS = [
  { href: '/create', label: 'Create' },
  { href: '/guide', label: 'Guide' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/about', label: 'About', wide: true },
] as const;

export function SiteNav() {
  return (
    <header className="relative z-40 flex items-center justify-between px-4 py-4 sm:px-8">
      <Link href="/" className="font-display text-xl font-extrabold tracking-tight">
        INKPLAY<span className="text-hazard">.</span>
      </Link>
      <nav className="flex items-center gap-3 sm:gap-6">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={`label text-graphite transition-colors hover:text-ink ${'wide' in l ? 'hidden sm:inline' : ''}`}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

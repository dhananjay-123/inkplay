'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense } from 'react';

/* Hand-drawn-feel line icons (inline: no icon font, works offline). */
const icon = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);

const PencilIcon = icon(
  <>
    <path d="M4 20l1.2-4.6L16.4 4.2a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z" />
    <path d="M14.5 6l3.5 3.5" />
    <path d="M4 20l4.6-1.2" />
  </>,
);
const MapIcon = icon(
  <>
    <path d="M3.5 6.5l5-2.2 7 2.4 5-2.2v13l-5 2.2-7-2.4-5 2.2z" />
    <path d="M8.5 4.3v13M15.5 6.7v13" />
  </>,
);
const FramesIcon = icon(
  <>
    <rect x="3.5" y="5" width="12" height="11" rx="1.5" transform="rotate(-6 9.5 10.5)" />
    <rect x="8.5" y="8" width="12" height="11" rx="1.5" transform="rotate(5 14.5 13.5)" />
    <path d="M11 17l2.8-3 2 2 1.6-1.6 2.2 2.4" />
  </>,
);
const QuestionIcon = icon(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.6" />
    <path d="M12 17.2v.1" />
  </>,
);

const LINKS = [
  { href: '/guide', label: 'Guide', icon: MapIcon },
  { href: '/gallery', label: 'Gallery', icon: FramesIcon },
  { href: '/about', label: 'About', icon: QuestionIcon },
] as const;

/** The little ink hero, as the logo mark. */
function HeroMark() {
  return (
    <svg viewBox="0 0 40 44" className="h-8 w-8 transition-transform group-hover:-translate-y-0.5 group-hover:-rotate-6" aria-hidden>
      <ellipse cx="20" cy="24" rx="15" ry="17" fill="var(--ink)" />
      <path d="M7 28 L33 26.5 L37 34" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="14.5" cy="19" rx="4" ry="5" fill="#fff" />
      <ellipse cx="25.5" cy="19" rx="4" ry="5" fill="#fff" />
      <circle cx="16" cy="20" r="2" fill="#1a1033" />
      <circle cx="27" cy="20" r="2" fill="#1a1033" />
    </svg>
  );
}

export function SiteNav() {
  return (
    <header className="relative z-40 flex h-[var(--nav-h)] shrink-0 items-center justify-between gap-3 px-3 sm:px-8">
      <Link href="/" className="group flex items-center gap-2" aria-label="INKPLAY home">
        <HeroMark />
        <span className="font-display text-xl font-extrabold tracking-tight">
          INKPLAY<span className="text-hazard">.</span>
        </span>
      </Link>
      {/* The URL isn't known while prerendering dynamic routes: render without
          an active item first, then stream in the highlighted version. */}
      <Suspense fallback={<NavItems path={null} />}>
        <ActiveNav />
      </Suspense>
    </header>
  );
}

function ActiveNav() {
  return <NavItems path={usePathname()} />;
}

function NavItems({ path }: { path: string | null }) {
  const active = (href: string) => path !== null && (path === href || path.startsWith(`${href}/`));
  return (
    <nav className="flex items-center gap-2 sm:gap-3" aria-label="Main">
      <ul className="flex items-center gap-0.5 rounded-full border-2 border-ink/80 bg-card p-1 shadow-[3px_3px_0_var(--pop)]">
        {LINKS.map((l) => {
          const on = active(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={on ? 'page' : undefined}
                aria-label={l.label}
                className={`label flex items-center gap-1.5 rounded-full px-2.5 py-1.5 transition-colors sm:px-3 ${
                  on ? 'bg-accent text-accent-ink' : 'text-graphite hover:bg-paper-deep hover:text-ink'
                }`}
              >
                {l.icon}
                <span className="hidden md:inline">{l.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link href="/create" aria-current={active('/create') ? 'page' : undefined} className="btn-game label px-3 py-2 sm:px-4">
        {PencilIcon}
        <span className="hidden sm:inline">Create</span>
      </Link>
    </nav>
  );
}

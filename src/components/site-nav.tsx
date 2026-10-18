'use client';

import Link, { useLinkStatus } from 'next/link';
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
const HomeIcon = icon(
  <>
    <path d="M3.5 11.5L12 4l8.5 7.5" />
    <path d="M6 10v9.5h4.5v-5h3v5H18V10" />
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

const SwordsIcon = icon(
  <>
    <path d="M4 4l9.5 9.5M4 4h3.5L17 13.5M4 4v3.5L13.5 17" />
    <path d="M14.5 17.5l3-3M16 19.5l3.5-3.5M18 18l2 2" />
  </>,
);

const RunnerIcon = icon(
  <>
    <circle cx="14.5" cy="4.8" r="1.8" />
    <path d="M9 21l3-5.5 3 2.5v4.5M12 15.5l1-5.5-3.5 1.5L7 14M13 10l2.5 3 3-1" />
    <path d="M2.5 21h4M18 21h3.5" />
  </>,
);

const LINKS = [
  { href: '/', label: 'Home', icon: HomeIcon },
  { href: '/arena', label: 'Arena', icon: SwordsIcon },
  { href: '/survival', label: 'Survival', icon: RunnerIcon },
  { href: '/guide', label: 'Guide', icon: MapIcon },
  { href: '/gallery', label: 'Gallery', icon: FramesIcon },
  { href: '/about', label: 'About', icon: QuestionIcon },
] as const;

/** The little ink hero, as the logo mark. */
function HeroMark() {
  return (
    <svg viewBox="0 0 40 44" className="h-9 w-9 -rotate-6 transition-transform duration-300 group-hover:-translate-y-1 group-hover:rotate-6" aria-hidden>
      <path d="M8 40 L6 43 M30 40 L33 43" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <path d="M20 6 C 31 5, 36 15, 35 25 C 34 35, 28 41, 19 40 C 10 39, 5 33, 5 23 C 5 13, 10 7, 20 6 Z" fill="var(--ink)" />
      <path d="M6 28 L33 26.5 L38 35" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="14.5" cy="18" rx="4" ry="5" fill="#fff" />
      <ellipse cx="25.5" cy="18" rx="4" ry="5" fill="#fff" />
      <circle cx="16" cy="19" r="2" fill="var(--ink)" />
      <circle cx="27" cy="19" r="2" fill="var(--ink)" />
    </svg>
  );
}

export function SiteNav() {
  return (
    <header className="relative z-40 flex h-[var(--nav-h)] shrink-0 items-center justify-between gap-3 px-3 sm:px-8">
      <Link href="/" className="group flex items-center gap-2" aria-label="INKPLAY home">
        <HeroMark />
        <span className="font-display text-2xl font-extrabold tracking-tight">
          ink<span className="highlight">play</span>
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

/** Inside a Link: wiggles the icon from the moment it's clicked until the page arrives. */
function Pending({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className={`inline-flex ${pending ? 'nav-pending' : ''}`}>{children}</span>;
}

function NavItems({ path }: { path: string | null }) {
  const active = (href: string) => path !== null && (path === href || (href !== '/' && path.startsWith(`${href}/`)));
  return (
    <nav className="flex items-center gap-2 sm:gap-3" aria-label="Main">
      <ul className="flex items-center gap-1">
        {LINKS.map((l) => {
          const on = active(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={on ? 'page' : undefined}
                aria-label={l.label}
                className={`font-hand flex items-center gap-1.5 px-2.5 py-1 text-xl transition-[color,rotate] hover:-rotate-2 sm:px-3 ${
                  on ? 'highlight text-ink' : 'text-graphite hover:text-ink'
                }`}
              >
                <Pending>{l.icon}</Pending>
                <span className="hidden md:inline">{l.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link href="/create" aria-current={active('/create') ? 'page' : undefined} className="btn-game btn-sm px-3 py-1.5 sm:px-4">
        <Pending>{PencilIcon}</Pending>
        <span className="hidden sm:inline">Create</span>
      </Link>
    </nav>
  );
}

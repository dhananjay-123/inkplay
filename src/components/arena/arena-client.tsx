'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArenaBus, type ArenaHud } from '@/game/arena-events';
import { ARENA_COLORS } from '@/game/art';
import { play as sfx, setMuted } from '@/game/sfx';
import { connectRoom, type NetMsg, type PlayerMeta, type Transport } from '@/lib/arena/net';
import { proceduralArena } from '@/lib/arena/procedural';
import { parseWireMap, type ArenaMap, type ArenaMapResponse } from '@/lib/arena/schema';
import { SAMPLES, sampleSrc, sampleThumb } from '@/lib/samples';
import { useInkplay } from '@/lib/store';
import { anonymousUserId } from '@/lib/supabase/client';
import { ArenaGame } from './arena-game';

const PROFILE_KEY = 'inkplay:arena-profile';
const ID_KEY = 'inkplay:arena-id';
const ROOM_RE = /^[A-Z0-9]{3,8}$/;

type Profile = { name: string; color: string };
type Current = { map: ArenaMap; round: number; from: string; note?: string; source?: ArenaMapResponse['source'] };
type Feed = { key: number; text: string; mine: boolean };

const randomRoom = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as Profile | null;
    if (p && typeof p.name === 'string' && (ARENA_COLORS as readonly string[]).includes(p.color)) return p;
  } catch {
    /* private mode */
  }
  return { name: '', color: ARENA_COLORS[Math.floor(Math.random() * ARENA_COLORS.length)] };
}

/** One id per tab, so two tabs of the same browser are two players. */
function tabId(): string {
  try {
    const have = sessionStorage.getItem(ID_KEY);
    if (have) return have;
    const id = crypto.randomUUID().slice(0, 8);
    sessionStorage.setItem(ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID().slice(0, 8);
  }
}

export function ArenaClient() {
  const [profile, setProfile] = useState<Profile>({ name: '', color: ARENA_COLORS[0] });
  const [room, setRoom] = useState('');
  const [net, setNet] = useState<Transport | null>(null);
  const [me, setMe] = useState<PlayerMeta | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    // Client-only state (storage, URL) is read after hydration.
    /* eslint-disable react-hooks/set-state-in-effect */
    setProfile(loadProfile());
    const q = new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '';
    setRoom(ROOM_RE.test(q) ? q : '');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const join = async (code: string) => {
    const name = profile.name.trim().slice(0, 16) || `Ink ${Math.floor(Math.random() * 90 + 10)}`;
    const p = { ...profile, name };
    setProfile(p);
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    } catch {
      /* private mode */
    }
    setConnecting(true);
    sfx('click');
    const id = tabId();
    // Best effort: a real Supabase identity when anonymous sign-ins are on.
    void anonymousUserId();
    const forceLocal = new URLSearchParams(window.location.search).has('local');
    const t = await connectRoom(code, id, { forceLocal });
    window.history.replaceState(null, '', `/arena?room=${code}${forceLocal ? '&local=1' : ''}`);
    setRoom(code);
    setMe({ id, name, color: p.color, kills: 0, deaths: 0, joinedAt: Date.now() });
    setNet(t);
    setConnecting(false);
  };

  const leave = () => {
    net?.close();
    setNet(null);
    setMe(null);
    window.history.replaceState(null, '', '/arena');
  };

  if (net && me) return <Room net={net} me={me} setMe={setMe} room={room} onLeave={leave} />;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <p className="font-hand text-xl text-pop">multiplayer, drawn in marker</p>
      <h1 className="font-display mt-1 text-5xl font-extrabold tracking-tight sm:text-6xl">
        Ink <span className="highlight">Arena</span>
      </h1>
      <p className="mt-4 max-w-xl text-lg text-graphite">
        Jetpacks, autofire and a map Gemma designs for you, from a theme or from a drawing. Share the room code and everyone plays the same map live.
      </p>

      <form
        className="sketch mt-8 grid gap-6 p-6 sm:p-8"
        onSubmit={(e) => {
          e.preventDefault();
          void join(ROOM_RE.test(room) ? room : randomRoom());
        }}
      >
        <label className="grid gap-2">
          <span className="font-hand text-xl">Your name</span>
          <input
            value={profile.name}
            onChange={(e) => setProfile({ ...profile, name: e.target.value.slice(0, 16) })}
            placeholder="Chai Commando"
            maxLength={16}
            className="rounded-[var(--wobble-btn)] border-2 border-ink bg-card px-4 py-3 text-lg outline-none focus:shadow-[var(--shadow-hard)]"
          />
        </label>
        <fieldset className="grid gap-2">
          <legend className="font-hand mb-2 text-xl">Scarf colour</legend>
          <div className="flex flex-wrap gap-3">
            {ARENA_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                aria-pressed={profile.color === c}
                onClick={() => setProfile({ ...profile, color: c })}
                className={`h-10 w-10 rounded-full border-[2.5px] border-ink transition-transform ${profile.color === c ? 'scale-110 shadow-[var(--shadow-hard)]' : 'opacity-70 hover:opacity-100'}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </fieldset>
        <label className="grid gap-2">
          <span className="font-hand text-xl">Room code (leave empty to start a new room)</span>
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
            placeholder="ABCD"
            className="label rounded-[var(--wobble-btn)] border-2 border-ink bg-card px-4 py-3 text-lg tracking-[0.3em] outline-none focus:shadow-[var(--shadow-hard)]"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={connecting} className="btn-game px-6 py-3 disabled:opacity-60">
            {connecting ? 'Joining…' : ROOM_RE.test(room) ? `Join room ${room}` : 'Start a new room'}
          </button>
          <Link href="/create" className="btn-ghost px-5 py-3">
            Back to the platformer
          </Link>
        </div>
      </form>
      <p className="font-hand mt-6 text-lg text-graphite">
        A/D to move, W or Space for the jetpack, mouse to aim. Autofire shoots when someone is in your sights. Click to fire yourself, R to reload.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- room */

function Room({ net, me, setMe, room, onLeave }: { net: Transport; me: PlayerMeta; setMe: (m: PlayerMeta) => void; room: string; onLeave: () => void }) {
  const bus = useMemo(() => new ArenaBus(), []);
  const [current, setCurrent] = useState<Current | null>(null);
  const [peers, setPeers] = useState<PlayerMeta[]>([]);
  const [waitedForMap, setWaitedForMap] = useState(false);
  const [maker, setMaker] = useState(false);
  const [hud, setHud] = useState<ArenaHud | null>(null);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [autofire, setAutofire] = useState(true);
  const [copied, setCopied] = useState(false);
  const muted = useInkplay((s) => s.muted);
  const toggleMuted = useInkplay((s) => s.toggleMuted);
  const currentRef = useRef<Current | null>(null);
  const meRef = useRef(me);
  const peersRef = useRef<PlayerMeta[]>([]);
  const lastMapHeard = useRef(0);
  const feedKey = useRef(0);

  useEffect(() => setMuted(muted), [muted]);
  useEffect(() => {
    meRef.current = me;
    net.track(me);
  }, [me, net]);

  const nameOf = useCallback((id: string | null) => (id ? peersRef.current.find((p) => p.id === id)?.name ?? 'someone' : 'gravity'), []);
  const pushFeed = useCallback((text: string, mine: boolean) => {
    const key = ++feedKey.current;
    setFeed((f) => [...f.slice(-4), { key, text, mine }]);
    setTimeout(() => setFeed((f) => f.filter((x) => x.key !== key)), 6000);
  }, []);

  const adopt = useCallback((c: Current) => {
    currentRef.current = c;
    setCurrent(c);
    setMaker(false);
  }, []);

  const broadcastMap = useCallback(() => {
    const c = currentRef.current;
    if (c) net.send({ t: 'map', map: c.map, from: c.from, round: c.round, note: c.note });
  }, [net]);

  // ---------- network: map sync, kills, roster
  useEffect(() => {
    const offMsg = net.onMessage((m: NetMsg) => {
      const mine = meRef.current;
      if (m.t === 'map') {
        lastMapHeard.current = performance.now();
        const map = parseWireMap(m.map);
        const cur = currentRef.current;
        if (!map) return;
        const newer = !cur || m.round > cur.round || (m.round === cur.round && m.from < cur.from);
        if (newer) adopt({ map, round: m.round, from: m.from, note: typeof m.note === 'string' ? m.note.slice(0, 120) : undefined });
      } else if (m.t === 'needmap') {
        if (!currentRef.current) return;
        const asked = performance.now();
        // Anyone with the map may answer; a random delay stops a reply storm.
        setTimeout(() => {
          if (lastMapHeard.current < asked) broadcastMap();
        }, 100 + Math.random() * 500);
      } else if (m.t === 'die') {
        const killedByMe = m.killer === mine.id;
        pushFeed(`${nameOf(m.killer)} inked ${nameOf(m.victim)}`, killedByMe);
        if (killedByMe) {
          sfx('stomp');
          setMe({ ...meRef.current, kills: meRef.current.kills + 1 });
        }
      }
    });
    const offPeers = net.onPeers((list) => {
      peersRef.current = list;
      setPeers(list);
      bus.emit('peers', list.filter((p) => p.id !== meRef.current.id));
    });
    net.send({ t: 'needmap', from: me.id });
    const t = setTimeout(() => setWaitedForMap(true), 2500);
    return () => {
      offMsg();
      offPeers();
      clearTimeout(t);
    };
  }, [net, bus, me.id, adopt, broadcastMap, nameOf, pushFeed, setMe]);

  // ---------- scene → React
  useEffect(() => {
    const offs = [
      bus.on('hud', setHud),
      bus.on('died', ({ killer }) => {
        pushFeed(`${nameOf(killer)} inked you`, false);
        setMe({ ...meRef.current, deaths: meRef.current.deaths + 1 });
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [bus, nameOf, pushFeed, setMe]);

  // F toggles autofire
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f' || (e.target as HTMLElement | null)?.closest('input, textarea')) return;
      setAutofire((a) => !a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => bus.emit('autofire', autofire), [bus, autofire]);

  const publish = (map: ArenaMap, extra: Pick<Current, 'note' | 'source'> = {}) => {
    const c: Current = { map, round: (currentRef.current?.round ?? 0) + 1, from: me.id, ...extra };
    adopt(c);
    broadcastMap();
    sfx('win');
  };

  const host = useMemo(() => {
    const all = peers.length ? peers : [me];
    return [...all].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))[0]?.id === me.id;
  }, [peers, me]);

  const copyInvite = async () => {
    const url = `${window.location.origin}/arena?room=${room}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt('Copy this invite link', url);
    }
  };

  const board = [...(peers.length ? peers : [me])].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const showMaker = maker || (!current && waitedForMap);

  return (
    <div className="relative mx-auto flex h-[calc(100dvh-var(--nav-h))] w-full max-w-[1800px] flex-col px-2 pb-2 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 pb-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-display truncate text-2xl font-extrabold tracking-tight sm:text-3xl">{current?.map.title ?? 'Ink Arena'}</h1>
          <button type="button" onClick={copyInvite} className="label rounded-[var(--wobble-btn)] border-2 border-ink bg-accent px-2 py-0.5 text-[0.7rem] text-accent-ink" title="Copy invite link">
            room {room} · {copied ? 'link copied' : 'invite'}
          </button>
          <span className="label text-[0.62rem] text-graphite" title={net.kind === 'online' ? 'Supabase Realtime' : 'BroadcastChannel: other tabs of this browser only'}>
            {net.kind === 'online' ? `online · ${board.length} here` : `this browser only · ${board.length} here`}
          </span>
        </div>
        <div className="label flex flex-wrap items-center gap-3 tabular-nums">
          {hud && (
            <>
              <Meter label="HP" value={hud.hp / 100} tone={hud.hp > 35 ? 'accent' : 'hazard'} text={String(hud.hp)} />
              <Meter label="Jet" value={hud.fuel} tone="sky" />
              <span title="Ammo">{hud.reloading ? 'reloading…' : `${hud.ammo}/${hud.mag}`}</span>
            </>
          )}
          <button type="button" onClick={() => setAutofire((a) => !a)} aria-pressed={autofire} className={`btn-sm px-3 py-1 ${autofire ? 'btn-game' : 'btn-ghost'}`} title="F">
            Autofire {autofire ? 'on' : 'off'}
          </button>
          <button type="button" onClick={toggleMuted} className="btn-ghost btn-sm px-3 py-1" aria-pressed={!muted}>
            {muted ? 'Sound off' : 'Sound on'}
          </button>
          {current && host && (
            <button type="button" onClick={() => setMaker(true)} className="btn-ghost btn-sm px-3 py-1">
              New map
            </button>
          )}
          <button type="button" onClick={onLeave} className="btn-ghost btn-sm px-3 py-1">
            Leave
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center [container-type:size]">
        <div className="sketch relative aspect-video w-[min(100cqw,calc(100cqh*16/9))] overflow-hidden">
          {current ? (
            <ArenaGame key={`${current.round}-${current.from}`} map={current.map} me={me} net={net} bus={bus} autofire={autofire} className="absolute inset-0" />
          ) : (
            !showMaker && (
              <div className="absolute inset-0 grid place-items-center">
                <p className="font-hand animate-pulse text-2xl text-graphite">Asking the room for its map…</p>
              </div>
            )
          )}

          {/* scoreboard */}
          {current && (
            <ol className="pointer-events-none absolute right-2 top-2 z-10 min-w-40 rounded-[var(--wobble)] border-2 border-ink bg-card/90 px-3 py-2 text-sm">
              {board.slice(0, 8).map((p) => (
                <li key={p.id} className={`label flex items-center gap-2 text-[0.68rem] ${p.id === me.id ? 'text-pop' : ''}`}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-ink" style={{ background: p.color }} />
                  <span className="min-w-0 flex-1 truncate normal-case">{p.name}</span>
                  <span className="tabular-nums">
                    {p.kills}/{p.deaths}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {/* kill feed */}
          <ul className="pointer-events-none absolute bottom-2 left-2 z-10 grid gap-1">
            {feed.map((f) => (
              <li key={f.key} className={`font-hand rounded-[var(--wobble-btn)] border-2 border-ink px-2 text-base ${f.mine ? 'bg-accent text-accent-ink' : 'bg-card/90'}`}>
                {f.text}
              </li>
            ))}
          </ul>

          {hud?.respawnIn != null && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-paper/40">
              <p className="font-display text-4xl font-extrabold">Back in {Math.ceil(hud.respawnIn)}…</p>
            </div>
          )}

          {showMaker && <MapMaker onMap={publish} onClose={current ? () => setMaker(false) : undefined} />}
        </div>
      </div>

      <div className="flex items-center gap-4 px-1 pt-2">
        <p className="font-hand min-w-0 flex-1 truncate text-base text-graphite" title={current?.map.story}>
          {current?.note ?? current?.map.story ?? 'Waiting for a map.'}
        </p>
        <p className="font-hand hidden shrink-0 text-base text-graphite lg:block">A/D move · W/Space jetpack · mouse aim · click fire · R reload · F autofire</p>
      </div>
      <ArenaTouch bus={bus} />
    </div>
  );
}

function Meter({ label, value, tone, text }: { label: string; value: number; tone: 'accent' | 'hazard' | 'sky'; text?: string }) {
  const fill = tone === 'accent' ? 'bg-accent' : tone === 'hazard' ? 'bg-hazard' : 'bg-sky';
  return (
    <span className="flex items-center gap-1.5" title={label}>
      {label}
      <span className="relative h-3 w-16 overflow-hidden rounded-full border-2 border-ink bg-card">
        <span className={`absolute inset-y-0 left-0 ${fill}`} style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
      </span>
      {text}
    </span>
  );
}

/* ---------------------------------------------------------------- map maker */

type MakerState = { busy: string | null; error: string | null };

function MapMaker({ onMap, onClose }: { onMap: (m: ArenaMap, extra: Pick<Current, 'note' | 'source'>) => void; onClose?: () => void }) {
  const [theme, setTheme] = useState('');
  const [st, setSt] = useState<MakerState>({ busy: null, error: null });
  const fileRef = useRef<HTMLInputElement>(null);

  const ask = async (body: unknown, busy: string) => {
    setSt({ busy, error: null });
    try {
      const res = await fetch('/api/arena/map', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(e?.error?.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ArenaMapResponse;
      const map = parseWireMap(data.map);
      if (!map) throw new Error('That map came back smudged.');
      setSt({ busy: null, error: null });
      onMap(map, { note: data.note, source: data.source });
    } catch (e) {
      // No server / no model at all: the ruler still draws a map.
      setSt({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const fromImage = async (source: Blob | HTMLImageElement, sampleId?: string) => {
    setSt({ busy: 'Reading your drawing…', error: null });
    try {
      const { processImage } = await import('@/lib/vision/client');
      const p = await processImage(source);
      if (p.marks.length === 0) throw new Error('No ink found on that page.');
      await ask({ mode: 'drawing', marks: p.marks, cleanImage: p.cleanSend, somImage: p.somSend, sampleId }, 'Gemma is turning your drawing into an arena…');
    } catch (e) {
      setSt({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const fromSample = async (id: string) => {
    const img = new Image();
    img.src = sampleSrc(id);
    try {
      await img.decode();
    } catch {
      setSt({ busy: null, error: 'Could not load that sample.' });
      return;
    }
    await fromImage(img, id);
  };

  return (
    <div className="absolute inset-0 z-20 overflow-y-auto bg-paper/95 p-4 sm:p-8" role="dialog" aria-label="Make a map">
      <div className="mx-auto grid max-w-3xl gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-hand text-lg text-pop">no map yet? make one</p>
            <h2 className="font-display text-3xl font-extrabold tracking-tight">Who designs the arena?</h2>
          </div>
          {onClose && (
            <button type="button" onClick={onClose} className="btn-ghost btn-sm px-3 py-1">
              Close
            </button>
          )}
        </div>

        {st.busy ? (
          <p className="font-hand animate-pulse py-10 text-center text-2xl">{st.busy}</p>
        ) : (
          <>
            <form
              className="sketch grid gap-3 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void ask({ mode: 'theme', theme: theme.trim() || undefined }, 'Gemma is sketching an arena… (about 20 s)');
              }}
            >
              <span className="font-hand text-xl">Gemma, by itself</span>
              <div className="flex flex-wrap gap-2">
                <input
                  value={theme}
                  onChange={(e) => setTheme(e.target.value.slice(0, 80))}
                  placeholder="theme, e.g. hostel rooftops (or leave empty)"
                  className="min-w-0 flex-1 rounded-[var(--wobble-btn)] border-2 border-ink bg-card px-3 py-2 outline-none"
                />
                <button type="submit" className="btn-game px-4 py-2">
                  {theme.trim() ? 'Design it' : 'Surprise me'}
                </button>
              </div>
            </form>

            <div className="sketch grid gap-3 p-4">
              <span className="font-hand text-xl">From a drawing</span>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {SAMPLES.map((s) => (
                  <button key={s.id} type="button" onClick={() => void fromSample(s.id)} className="group grid gap-1 text-left" title={s.note}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- tiny local thumbs, works offline */}
                    <img src={sampleThumb(s.id)} alt={s.title} className="aspect-video w-full rounded border-2 border-ink object-cover transition-transform group-hover:-rotate-2" />
                    <span className="font-hand truncate text-sm">{s.title}</span>
                  </button>
                ))}
                <button type="button" onClick={() => fileRef.current?.click()} className="grid aspect-video place-items-center rounded border-2 border-dashed border-ink text-sm">
                  Upload
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void fromImage(f);
                  e.target.value = '';
                }}
              />
            </div>

            <button type="button" onClick={() => onMap(proceduralArena(Math.floor(Math.random() * 2 ** 31)), { source: 'procedural', note: 'The ruler drew this one, instantly.' })} className="font-hand link-scrawl justify-self-start text-lg text-graphite">
              No time? Instant ruler map
            </button>
          </>
        )}
        {st.error && <p className="font-hand text-lg text-hazard">{st.error}</p>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- touch */

function ArenaTouch({ bus }: { bus: ArenaBus }) {
  const hold = (key: 'left' | 'right' | 'jet') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      bus.emit('touch', { [key]: true });
    },
    onPointerUp: () => bus.emit('touch', { [key]: false }),
    onPointerCancel: () => bus.emit('touch', { [key]: false }),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  const btn = 'grid h-16 w-16 touch-none select-none place-items-center rounded-[var(--wobble-btn)] border-[2.5px] border-ink bg-card text-2xl font-bold text-ink shadow-[var(--shadow-hard)] active:translate-y-1 active:bg-accent active:shadow-none';
  return (
    <div className="pointer-coarse:flex fixed inset-x-0 bottom-0 z-30 hidden items-end justify-between p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex gap-3">
        <button type="button" aria-label="Move left" className={btn} {...hold('left')}>←</button>
        <button type="button" aria-label="Move right" className={btn} {...hold('right')}>→</button>
      </div>
      <button type="button" aria-label="Jetpack" className={`${btn} h-20 w-20`} {...hold('jet')}>⇧</button>
    </div>
  );
}

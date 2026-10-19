'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArenaBus, isTyping, type ArenaEvents, type ArenaHud } from '@/game/arena-events';
import { ARENA_COLORS } from '@/game/art';
import { play as sfx, setMuted } from '@/game/sfx';
import { CHAT_MAX, QUICK_CHAT, chatLimiter, cleanChat } from '@/lib/arena/chat';
import { connectRoom, type NetMsg, type PlayerMeta, type Transport } from '@/lib/arena/net';
import { proceduralArena } from '@/lib/arena/procedural';
import { DEFAULT_OPTIONS, MAX_BOTS, parseWireMap, type ArenaMap, type ArenaMapResponse, type MapOptions } from '@/lib/arena/schema';
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
type ChatLine = { key: number; id: string; name: string; color: string; text: string; fresh: boolean; mine: boolean };

/** Closed chat shows lines this fresh; open chat shows the history. */
const CHAT_FRESH_MS = 12_000;
const CHAT_KEEP = 50;

/** Phones and tablets: play immersive + landscape by default. */
const isTouch = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** Real full screen where the browser allows it (must run inside a click), then try to lock landscape. */
function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => {
      /* iOS Safari and friends: the fixed overlay still covers the page */
    });
}

function exitFullscreen() {
  try {
    screen.orientation?.unlock?.();
  } catch {
    /* not locked */
  }
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}

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
  const [immersive, setImmersive] = useState(false);

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
    // Inside the click: browsers only allow full screen from a user gesture.
    if (isTouch()) {
      setImmersive(true);
      enterFullscreen();
    }
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
    setImmersive(false);
    exitFullscreen();
    window.history.replaceState(null, '', '/arena');
  };

  if (net && me) return <Room net={net} me={me} setMe={setMe} room={room} onLeave={leave} immersive={immersive} setImmersive={setImmersive} />;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <p className="font-hand text-xl text-pop">multiplayer, drawn in marker</p>
      <h1 className="font-display mt-1 text-5xl font-extrabold tracking-tight sm:text-6xl">
        Ink <span className="highlight">Arena</span>
      </h1>
      <p className="mt-4 max-w-xl text-lg text-graphite">
        Jetpacks, auto-aim autofire and a map designed for you, from a theme or from a drawing. Share the room code and everyone plays the same map live.
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
        A/D to move, W or Space to jump and jetpack, G or right-click for a grenade. Walk over crates for rifles, flamethrowers, chainsaws, rockets, shields and boosts. Autofire aims and shoots at the nearest enemy you can see; turn it off (F) to aim with the mouse and click to fire. R reloads. Enter or T opens the room chat.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- room */

type RoomProps = {
  net: Transport;
  me: PlayerMeta;
  setMe: (m: PlayerMeta) => void;
  room: string;
  onLeave: () => void;
  immersive: boolean;
  setImmersive: (on: boolean) => void;
};

/** Hidden on short (landscape phone) screens to leave room for the game. */
// `!` because .btn-* set display outside the utilities layer.
const SHORT_HIDE = '[@media(max-height:520px)]:hidden!';

function Room({ net, me, setMe, room, onLeave, immersive, setImmersive }: RoomProps) {
  const bus = useMemo(() => new ArenaBus(), []);
  const [current, setCurrent] = useState<Current | null>(null);
  const [peers, setPeers] = useState<PlayerMeta[]>([]);
  const [waitedForMap, setWaitedForMap] = useState(false);
  const [maker, setMaker] = useState(false);
  const [hud, setHud] = useState<ArenaHud | null>(null);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [autofire, setAutofire] = useState(true);
  const [copied, setCopied] = useState(false);
  const [portraitOk, setPortraitOk] = useState(false);
  const muted = useInkplay((s) => s.muted);
  const toggleMuted = useInkplay((s) => s.toggleMuted);
  const currentRef = useRef<Current | null>(null);
  const meRef = useRef(me);
  const peersRef = useRef<PlayerMeta[]>([]);
  const lastMapHeard = useRef(0);
  const feedKey = useRef(0);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [mutedIds, setMutedIds] = useState<ReadonlySet<string>>(new Set());
  const mutedRef = useRef(mutedIds);
  const sendLimit = useMemo(() => chatLimiter(), []);
  // A little looser than my own send limit, so honest players never get dropped.
  const recvLimit = useMemo(() => chatLimiter(6, 8000, 300), []);
  // And for the whole room, so made-up ids can't add up to a flood.
  const roomLimit = useMemo(() => chatLimiter(20, 8000, 0), []);

  useEffect(() => setMuted(muted), [muted]);
  useEffect(() => {
    mutedRef.current = mutedIds;
  }, [mutedIds]);
  useEffect(() => {
    meRef.current = me;
    net.track(me);
  }, [me, net]);

  const [bots, setBots] = useState<ArenaEvents['botboard']>([]);
  const botWant = useRef<number | null>(null);
  const [botShown, setBotShown] = useState<number | null>(null);
  const botsRef = useRef<ArenaEvents['botboard']>([]);
  const nameOf = useCallback((id: string | null) => {
    if (!id) return 'the map';
    if (id.startsWith('npc:')) return 'an ink monster';
    if (id.startsWith('bot:')) return botsRef.current.find((b) => b.id === id)?.name ?? 'a bot';
    return peersRef.current.find((p) => p.id === id)?.name ?? 'someone';
  }, []);
  const creditKill = useCallback(() => {
    sfx('stomp');
    setMe({ ...meRef.current, kills: meRef.current.kills + 1 });
  }, [setMe]);
  const pushFeed = useCallback((text: string, mine: boolean) => {
    const key = ++feedKey.current;
    setFeed((f) => [...f.slice(-4), { key, text, mine }]);
    setTimeout(() => setFeed((f) => f.filter((x) => x.key !== key)), 6000);
  }, []);

  const addChat = useCallback(
    (line: Omit<ChatLine, 'key' | 'fresh'>) => {
      const key = ++feedKey.current;
      setChat((c) => [...c.slice(-(CHAT_KEEP - 1)), { ...line, key, fresh: true }]);
      bus.emit('chat', { id: line.id, text: line.text });
      // Fade it out of the closed view on time.
      setTimeout(() => setChat((c) => c.map((l) => (l.key === key ? { ...l, fresh: false } : l))), CHAT_FRESH_MS);
    },
    [bus],
  );

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
        if (killedByMe) creditKill();
      } else if (m.t === 'npcdie') {
        const mineKill = m.killer === mine.id;
        pushFeed(`${nameOf(m.killer)} popped an ink monster`, mineKill);
        if (mineKill) creditKill();
      } else if (m.t === 'chat') {
        // Only players on the roster may talk; name and colour come from the roster, not the message.
        const peer = peersRef.current.find((p) => p.id === m.id);
        if (!peer || m.id === mine.id || mutedRef.current.has(m.id) || !recvLimit(m.id) || !roomLimit('room')) return;
        const text = cleanChat(m.text);
        if (!text) return;
        addChat({ id: m.id, name: peer.name, color: peer.color, text, mine: false });
        sfx('click');
      }
    });
    const offPeers = net.onPeers((list) => {
      peersRef.current = list;
      setPeers(list);
      bus.emit('peers', list.filter((p) => p.id !== meRef.current.id));
    });
    net.send({ t: 'needmap', from: me.id });
    // Ask twice: the first request can race the other clients' subscriptions.
    const retry = setTimeout(() => {
      if (!currentRef.current) net.send({ t: 'needmap', from: me.id });
    }, 1200);
    const t = setTimeout(() => setWaitedForMap(true), 3000);
    return () => {
      offMsg();
      offPeers();
      clearTimeout(t);
      clearTimeout(retry);
    };
  }, [net, bus, me.id, adopt, broadcastMap, nameOf, pushFeed, creditKill, addChat, recvLimit, roomLimit]);

  // ---------- scene → React
  useEffect(() => {
    const offs = [
      bus.on('hud', setHud),
      bus.on('died', ({ killer }) => {
        pushFeed(`${nameOf(killer)} inked you`, false);
        setMe({ ...meRef.current, deaths: meRef.current.deaths + 1 });
      }),
      // As host I decide enemy deaths; the network doesn't echo them back to me.
      bus.on('npcdie', ({ killer }) => {
        const mineKill = killer === meRef.current.id;
        pushFeed(`${nameOf(killer)} popped an ink monster`, mineKill);
        if (mineKill) creditKill();
      }),
      bus.on('botdie', ({ victim, killer }) => {
        const mineKill = killer === meRef.current.id;
        pushFeed(`${nameOf(killer)} inked ${nameOf(victim)}`, mineKill);
        if (mineKill) creditKill();
      }),
      bus.on('botboard', (list) => {
        botsRef.current = list;
        if (botWant.current === list.length) {
          botWant.current = null;
          setBotShown(null);
        }
        setBots((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [bus, nameOf, pushFeed, setMe, creditKill]);

  // Leaving browser full screen (Esc, system back) leaves immersive mode on desktop too.
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement && !isTouch()) setImmersive(false);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, [setImmersive]);

  const toggleImmersive = () => {
    if (immersive) {
      setImmersive(false);
      exitFullscreen();
    } else {
      setImmersive(true);
      enterFullscreen();
    }
  };

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

  /** Returns false when rate-limited (the box keeps the text). */
  const sendChat = (raw: string): boolean => {
    const text = cleanChat(raw);
    if (!text) return true;
    if (!sendLimit(me.id)) return false;
    net.send({ t: 'chat', id: me.id, text });
    addChat({ id: me.id, name: me.name, color: me.color, text, mine: true });
    return true;
  };
  const toggleMute = (id: string) => {
    const next = new Set(mutedIds);
    if (!next.delete(id)) next.add(id);
    setMutedIds(next);
    if (next.has(id)) setChat((c) => c.filter((l) => l.id !== id));
  };

  // Any text box in the room (chat, map theme) borrows the keyboard from the game while focused.
  useEffect(() => {
    const check = () => bus.emit('typing', isTyping());
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', check);
    return () => {
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', check);
      bus.emit('typing', false);
    };
  }, [bus]);

  const publish = (map: ArenaMap, extra: Pick<Current, 'note' | 'source'> = {}) => {
    // The round is a timestamp, so a map made after a reload is still newer than the one before it.
    const c: Current = { map, round: Math.max(Date.now(), (currentRef.current?.round ?? 0) + 1), from: me.id, ...extra };
    adopt(c);
    broadcastMap();
    sfx('win');
  };

  const host = useMemo(() => {
    const all = peers.length ? peers : [me];
    return [...all].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))[0]?.id === me.id;
  }, [peers, me]);
  // Someone is on a newer map (we missed it): ask again, at most every 3 s.
  const lastAsk = useRef(0);
  useEffect(
    () =>
      bus.on('newerMap', () => {
        const now = performance.now();
        if (now - lastAsk.current < 3000) return;
        lastAsk.current = now;
        net.send({ t: 'needmap', from: me.id });
      }),
    [bus, net, me.id],
  );

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

  const humans = peers.length || 1;
  const board = [...(peers.length ? peers : [me]), ...bots].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  // Anyone can add or remove AI players; the room host runs them. Quick
  // clicks add up from the requested count, not the last reported one.
  const changeBots = (delta: number) => {
    if (!current) return;
    const next = Math.max(0, Math.min(MAX_BOTS, (botWant.current ?? bots.length) + delta));
    botWant.current = next;
    setBotShown(next);
    bus.emit('bots', next);
    net.send({ t: 'bots', n: next, r: current.round });
    sfx('click');
  };
  const botCount = botShown ?? bots.length;
  const showMaker = maker || (!current && waitedForMap);

  return (
    <div
      className={
        immersive
          ? 'fixed inset-0 z-[60] flex flex-col bg-paper px-2 pb-1 pt-[max(0.25rem,env(safe-area-inset-top))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]'
          : 'relative mx-auto flex h-[calc(100dvh-var(--nav-h))] w-full max-w-[1800px] flex-col px-2 pb-2 sm:px-6'
      }
    >
      <div className={`flex items-center justify-between gap-x-4 gap-y-2 px-1 ${immersive ? 'flex-nowrap pb-1' : 'flex-wrap pb-2'}`}>
        <div className={`flex items-center gap-x-3 gap-y-1 ${immersive ? 'min-w-0 shrink flex-nowrap [@media(max-height:520px)]:shrink-0' : 'min-w-0 flex-wrap'}`}>
          <h1 className={`font-display truncate font-extrabold tracking-tight ${immersive ? `text-xl ${SHORT_HIDE}` : 'text-2xl sm:text-3xl'}`}>{current?.map.title ?? 'Ink Arena'}</h1>
          <button type="button" onClick={copyInvite} className="label shrink-0 whitespace-nowrap rounded-[var(--wobble-btn)] border-2 border-ink bg-accent px-2 py-0.5 text-[0.7rem] text-accent-ink" title="Copy invite link">
            {immersive ? room : `room ${room}`} · {copied ? 'copied' : 'invite'}
          </button>
          <span className={`label text-[0.62rem] text-graphite ${immersive ? SHORT_HIDE : ''}`} title={net.kind === 'online' ? 'Supabase Realtime' : 'BroadcastChannel: other tabs of this browser only'}>
            {net.kind === 'online' ? `online · ${humans} here` : `this browser only · ${humans} here`}
          </span>
        </div>
        <div className={`label flex items-center gap-2 tabular-nums sm:gap-3 [&_button]:whitespace-nowrap ${immersive ? 'min-w-0 flex-nowrap overflow-x-auto' : 'flex-wrap'}`}>
          {hud && (
            <>
              <Meter label="HP" value={hud.hp / 100} tone={hud.hp > 35 ? 'accent' : 'hazard'} text={hud.shield > 0 ? `${hud.hp}+${hud.shield}` : String(hud.hp)} />
              <Meter label="Jet" value={hud.fuel} tone="sky" text={`${Math.round(hud.fuel * 100)}%`} />
              <span className="shrink-0" title="Weapon and ammo">
                {hud.weapon} {hud.reloading ? 'reloading…' : hud.ammo}
              </span>
              <span className="shrink-0" title="Grenades (G or right-click)">
                nade {hud.grenades}
              </span>
              {hud.buffs.map((b) => (
                <span key={b.name} className="shrink-0 rounded-[var(--wobble-btn)] border-2 border-ink bg-sky px-1.5 text-[0.62rem] text-accent-ink" title={b.name}>
                  {b.name} {b.s}s
                </span>
              ))}
            </>
          )}
          <button type="button" onClick={() => setAutofire((a) => !a)} aria-pressed={autofire} className={`btn-sm px-3 py-1 ${autofire ? 'btn-game' : 'btn-ghost'}`} title="F">
            Autofire {autofire ? 'on' : 'off'}
          </button>
          <button type="button" onClick={toggleImmersive} aria-pressed={immersive} className="btn-ghost btn-sm px-3 py-1" title="Full screen">
            {immersive ? 'Exit full' : 'Full screen'}
          </button>
          <button type="button" onClick={toggleMuted} className={`btn-ghost btn-sm px-3 py-1 ${immersive ? SHORT_HIDE : ''}`} aria-pressed={!muted}>
            {muted ? 'Sound off' : 'Sound on'}
          </button>
          {current && (
            <span className="flex shrink-0 items-center gap-1" title="AI players">
              <button type="button" aria-label="Remove a bot" onClick={() => changeBots(-1)} disabled={botCount === 0} className="btn-ghost btn-sm px-2 py-0.5 disabled:opacity-40">
                −
              </button>
              <span className="tabular-nums">bots {botCount}</span>
              <button type="button" aria-label="Add a bot" onClick={() => changeBots(1)} disabled={botCount >= MAX_BOTS} className="btn-ghost btn-sm px-2 py-0.5 disabled:opacity-40">
                +
              </button>
            </span>
          )}
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
            <ArenaGame key={`${current.round}-${current.from}`} map={current.map} me={me} net={net} bus={bus} autofire={autofire} round={current.round} mapFrom={current.from} className="absolute inset-0" />
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
              {board.slice(0, 12).map((p) => (
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
          <ul className="pointer-events-none absolute bottom-2 right-2 z-10 grid justify-items-end gap-1">
            {feed.map((f) => (
              <li key={f.key} className={`font-hand rounded-[var(--wobble-btn)] border-2 border-ink px-2 text-base ${f.mine ? 'bg-accent text-accent-ink' : 'bg-card/90'}`}>
                {f.text}
              </li>
            ))}
          </ul>

          {current && !showMaker && (
            <RoomChat
              lines={chat}
              open={chatOpen}
              setOpen={setChatOpen}
              onSend={sendChat}
              onMute={toggleMute}
              mutedCount={mutedIds.size}
              onUnmuteAll={() => setMutedIds(new Set())}
            />
          )}

          {hud?.respawnIn != null && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-paper/40">
              <p className="font-display text-4xl font-extrabold">Back in {Math.ceil(hud.respawnIn)}…</p>
            </div>
          )}

          {showMaker && <MapMaker onMap={publish} onClose={current ? () => setMaker(false) : undefined} />}
        </div>
      </div>

      <div className={`flex items-center gap-4 px-1 pt-2 ${immersive ? 'hidden' : ''}`}>
        <p className="font-hand min-w-0 flex-1 truncate text-base text-graphite" title={current?.map.story}>
          {current?.note ?? current?.map.story ?? 'Waiting for a map.'}
        </p>
        <p className="font-hand hidden shrink-0 text-base text-graphite lg:block">A/D move · W/Space jump + jetpack · G grenade · autofire aims for you · F to aim yourself · R reload · Enter chat</p>
      </div>
      {current && !showMaker && <ArenaTouch bus={bus} />}
      {!portraitOk && (
        <div className="pointer-coarse:portrait:grid fixed inset-0 z-[70] hidden place-items-center bg-paper p-8 text-center" role="dialog" aria-label="Rotate your phone">
          <div className="grid justify-items-center gap-4">
            <svg viewBox="0 0 64 64" className="h-20 w-20 animate-[spin_2.4s_ease-in-out_infinite] motion-reduce:animate-none" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
              <rect x="20" y="8" width="24" height="44" rx="4" />
              <path d="M29 46h6" />
            </svg>
            <p className="font-display text-3xl font-extrabold">Turn your phone sideways</p>
            <p className="font-hand text-lg text-graphite">The arena is wide. Landscape shows you the whole fight.</p>
            <button type="button" onClick={() => setPortraitOk(true)} className="btn-ghost btn-sm px-4 py-2">
              Play in portrait anyway
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- chat */

type RoomChatProps = {
  lines: ChatLine[];
  open: boolean;
  setOpen: (open: boolean) => void;
  onSend: (text: string) => boolean;
  onMute: (id: string) => void;
  mutedCount: number;
  onUnmuteAll: () => void;
};

function RoomChat({ lines, open, setOpen, onSend, onMute, mutedCount, onUnmuteAll }: RoomChatProps) {
  const [draft, setDraft] = useState('');
  const [slow, setSlow] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    // Closed: Enter or T opens it (not from another text box or a focused button).
    // Open: Esc closes it, even when the box itself doesn't have focus.
    // Lives here, so it's off whenever the chat isn't on screen (map maker open).
    const onKey = (e: KeyboardEvent) => {
      if (open) {
        if (e.key !== 'Escape') return;
        setOpen(false);
        inputRef.current?.blur();
        return;
      }
      if ((e.key !== 'Enter' && e.key.toLowerCase() !== 't') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, button, a')) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines, open]);

  const close = () => {
    setOpen(false);
    inputRef.current?.blur();
  };
  const send = (text: string, keepOpen = false) => {
    if (!onSend(text)) {
      setSlow(true);
      setTimeout(() => setSlow(false), 1500);
      return;
    }
    setDraft('');
    if (!keepOpen) close();
  };

  const shown = open ? lines : lines.filter((l) => l.fresh).slice(-5);

  return (
    // Phones: below the minimap, clear of the thumb controls.
    <div className="absolute bottom-2 left-2 z-20 grid w-[min(22rem,62%)] gap-1 pointer-coarse:bottom-auto pointer-coarse:top-[21%]">
      {/* Always mounted: screen readers only announce live regions that already exist. */}
      <ol
        ref={logRef}
        aria-live="polite"
        aria-label="Room chat"
        className={`grid gap-0.5 ${open && shown.length ? 'max-h-48 overflow-y-auto rounded-[var(--wobble)] border-2 border-ink bg-card/90 p-2' : 'pointer-events-none'}`}
      >
        {shown.map((l) => (
          <li key={l.key} className={`font-hand group flex items-baseline gap-1.5 text-base leading-snug ${open ? '' : 'w-fit rounded-[var(--wobble-btn)] bg-card/80 px-2'}`}>
            <span className="h-2 w-2 shrink-0 self-center rounded-full border border-ink" style={{ background: l.color }} />
            {/* bdi: a right-to-left name can't flip the message that follows it. */}
            <span className={`min-w-0 break-words ${l.mine ? 'text-pop' : ''}`}>
              <b className="font-bold">
                <bdi>{l.name}</bdi>
              </b>{' '}
              <bdi>{l.text}</bdi>
            </span>
            {open && !l.mine && (
              <button
                type="button"
                onClick={() => onMute(l.id)}
                aria-label={`Mute ${l.name}`}
                className="label -my-1 ml-auto shrink-0 px-1.5 py-1 text-[0.6rem] text-graphite opacity-0 group-hover:opacity-100 focus:opacity-100 pointer-coarse:px-3 pointer-coarse:opacity-100"
                title={`Hide messages from ${l.name}`}
              >
                mute
              </button>
            )}
          </li>
        ))}
      </ol>

      {open ? (
        <div className="grid gap-1 rounded-[var(--wobble)] border-2 border-ink bg-card/95 p-2">
          <div className="flex flex-wrap gap-1">
            {QUICK_CHAT.map((q) => (
              <button key={q} type="button" onClick={() => send(q, true)} className="btn-ghost btn-sm px-2 py-0 text-sm">
                {q}
              </button>
            ))}
          </div>
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) send(draft);
              else close();
            }}
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, CHAT_MAX))}
              maxLength={CHAT_MAX}
              placeholder="say something, Enter sends"
              aria-label="Chat message"
              enterKeyHint="send"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-[var(--wobble-btn)] border-2 border-ink bg-card px-2 py-1 text-base outline-none focus:shadow-[var(--shadow-hard)]"
            />
            <button type="submit" className="btn-game btn-sm px-3 py-1">
              Send
            </button>
            <button type="button" onClick={close} aria-label="Close chat" className="btn-ghost btn-sm px-2 py-1">
              ✕
            </button>
          </form>
          {slow && <p className="font-hand text-sm text-hazard">Slow down a little, then try again.</p>}
          {mutedCount > 0 && (
            <button type="button" onClick={onUnmuteAll} className="font-hand link-scrawl justify-self-start text-sm text-graphite">
              {mutedCount} muted · show them again
            </button>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="label w-fit rounded-[var(--wobble-btn)] border-2 border-ink bg-card/90 px-2 py-0.5 text-[0.62rem] pointer-coarse:px-4 pointer-coarse:py-2" title="Enter or T">
          chat<span className="pointer-coarse:hidden"> · enter</span>
        </button>
      )}
    </div>
  );
}

function Meter({ label, value, tone, text }: { label: string; value: number; tone: 'accent' | 'hazard' | 'sky'; text?: string }) {
  const fill = tone === 'accent' ? 'bg-accent' : tone === 'hazard' ? 'bg-hazard' : 'bg-sky';
  return (
    <span className="flex shrink-0 items-center gap-1.5" title={label}>
      <span className="[@media(max-height:520px)]:sr-only">{label}</span>
      <span className="relative h-3 w-16 overflow-hidden rounded-full border-2 border-ink bg-card [@media(max-height:520px)]:w-12">
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
  const [opts, setOpts] = useState<MapOptions>(DEFAULT_OPTIONS);
  const [st, setSt] = useState<MakerState>({ busy: null, error: null });
  const fileRef = useRef<HTMLInputElement>(null);

  const ask = async (body: unknown, busy: string, backdrop?: string) => {
    setSt({ busy, error: null });
    try {
      const res = await fetch('/api/arena/map', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(e?.error?.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ArenaMapResponse;
      const map = parseWireMap(backdrop ? { ...data.map, backdrop } : data.map);
      if (!map) throw new Error('That map came back smudged.');
      setSt({ busy: null, error: null });
      onMap(map, { note: data.note, source: data.source });
    } catch (e) {
      // No server / no model at all: the ruler still draws a map.
      setSt({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const fromImage = async (source: Blob | HTMLImageElement) => {
    setSt({ busy: 'Reading your drawing…', error: null });
    try {
      const { processImage } = await import('@/lib/vision/client');
      const p = await processImage(source);
      if (p.marks.length === 0) throw new Error('No ink found on that page.');
      const backdrop = await shrinkJpeg(p.cleanFull, 800, 0.55);
      await ask({ mode: 'drawing', marks: p.marks, cleanImage: p.cleanSend, somImage: p.somSend, options: opts }, 'Turning your drawing into an arena… (about 30 s)', backdrop);
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
    await fromImage(img);
  };

  return (
    // See-through: the arena keeps playing (and stays visible) behind the map maker.
    <div className="absolute inset-0 z-20 overflow-y-auto bg-paper/45 p-4 backdrop-blur-[1.5px] sm:p-8 [&_.sketch-soft]:bg-card/80! [&_.sketch]:bg-card/80!" role="dialog" aria-label="Make a map">
      <div className="mx-auto grid max-w-3xl gap-5">
        <div className="flex items-start justify-between gap-4 rounded-[var(--wobble)] bg-card/90 px-4 py-3">
          <div>
            <p className="font-hand text-lg text-pop">{onClose ? 'the game keeps going while you pick' : 'no map yet? make one'}</p>
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
            <MapOptionsPanel opts={opts} setOpts={setOpts} />
            <form
              className="sketch grid gap-3 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void ask({ mode: 'theme', theme: theme.trim() || undefined, options: opts }, 'Sketching an arena… (about 30 s)');
              }}
            >
              <span className="font-hand text-xl">Surprise me</span>
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

            <button type="button" onClick={() => onMap(proceduralArena(Math.floor(Math.random() * 2 ** 31), opts), { source: 'procedural', note: 'The ruler drew this one, instantly.' })} className="font-hand link-scrawl justify-self-start text-lg text-graphite">
              No time? Instant ruler map
            </button>
          </>
        )}
        {st.error && <p className="font-hand text-lg text-hazard">{st.error}</p>}
      </div>
    </div>
  );
}

/** Small JPEG of the cleaned drawing, sent with the map so everyone sees the same backdrop. */
async function shrinkJpeg(dataUrl: string, maxW: number, quality: number): Promise<string | undefined> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = Math.min(maxW, img.width);
    c.height = Math.round((img.height * c.width) / img.width);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL('image/jpeg', quality);
    return out.length < 150_000 ? out : c.toDataURL('image/jpeg', 0.35);
  } catch {
    return undefined;
  }
}

function MapOptionsPanel({ opts, setOpts }: { opts: MapOptions; setOpts: (o: MapOptions) => void }) {
  const toggles: { key: 'weapons' | 'buffs' | 'lava' | 'water' | 'spikes' | 'crumble'; label: string }[] = [
    { key: 'weapons', label: 'Weapon crates' },
    { key: 'buffs', label: 'Buffs' },
    { key: 'lava', label: 'Lava' },
    { key: 'water', label: 'Water currents' },
    { key: 'spikes', label: 'Spikes' },
    { key: 'crumble', label: 'Crumbling floors' },
  ];
  return (
    <div className="sketch-soft grid gap-3 p-4">
      <span className="font-hand text-xl">What goes in the map</span>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2">
          <span className="font-hand text-lg">Monsters</span>
          <input
            type="range"
            min={0}
            max={8}
            value={opts.enemies}
            onChange={(e) => setOpts({ ...opts, enemies: Number(e.target.value) })}
            className="w-28 accent-[var(--hazard)]"
          />
          <span className="label w-4 tabular-nums">{opts.enemies}</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="font-hand text-lg">Bots</span>
          <input
            type="range"
            min={0}
            max={MAX_BOTS}
            value={opts.bots}
            onChange={(e) => setOpts({ ...opts, bots: Number(e.target.value) })}
            className="w-28 accent-[var(--pop)]"
          />
          <span className="label w-4 tabular-nums">{opts.bots}</span>
        </label>
        <div className="flex items-center gap-2" role="radiogroup" aria-label="Pickups">
          <span className="font-hand text-lg">Pickups</span>
          {(['few', 'normal', 'lots'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={opts.pickups === k} onClick={() => setOpts({ ...opts, pickups: k })} className={`btn-sm px-2.5 py-0.5 ${opts.pickups === k ? 'btn-game' : 'btn-ghost'}`}>
              {k}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {toggles.map((t) => (
          <button key={t.key} type="button" aria-pressed={opts[t.key]} onClick={() => setOpts({ ...opts, [t.key]: !opts[t.key] })} className={`btn-sm px-3 py-1 ${opts[t.key] ? 'btn-game' : 'btn-ghost line-through opacity-70'}`}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- touch */

function ArenaTouch({ bus }: { bus: ArenaBus }) {
  const hold = (key: 'left' | 'right' | 'jet' | 'grenade') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      bus.emit('touch', { [key]: true });
    },
    onPointerUp: () => bus.emit('touch', { [key]: false }),
    onPointerCancel: () => bus.emit('touch', { [key]: false }),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  const btn = 'grid h-16 w-16 [@media(max-height:520px)]:h-14 [@media(max-height:520px)]:w-14 touch-none select-none place-items-center rounded-[var(--wobble-btn)] border-[2.5px] border-ink bg-card text-2xl font-bold text-ink shadow-[var(--shadow-hard)] active:translate-y-1 active:bg-accent active:shadow-none';
  return (
    <div className="pointer-coarse:flex fixed inset-x-0 bottom-0 z-30 hidden items-end justify-between p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex gap-3">
        <button type="button" aria-label="Move left" className={btn} {...hold('left')}>←</button>
        <button type="button" aria-label="Move right" className={btn} {...hold('right')}>→</button>
      </div>
      <div className="flex items-end gap-3">
        <button type="button" aria-label="Throw grenade" className={btn} {...hold('grenade')}><span className="label text-xs">nade</span></button>
        <button type="button" aria-label="Jump and jetpack" className={`${btn} h-20 w-20`} {...hold('jet')}>⇧</button>
      </div>
    </div>
  );
}

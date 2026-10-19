/**
 * Room chat. Messages ride the same transport as the game (Realtime
 * broadcast online, BroadcastChannel offline), so chat needs no server and
 * stores nothing: it lives only as long as the players in the room.
 *
 * Everything is cleaned twice, when sending and when receiving, because any
 * client with the anon key can put anything on the channel.
 */

export const CHAT_MAX = 120;

/** One-tap lines for phones (and anyone mid-fight). */
export const QUICK_CHAT = ['gg', 'nice shot!', 'help!', 'rematch?', 'new map?', 'lol'] as const;

/** Common swears, masked rather than blocked so the message still reads. Match is on letters only. */
const MASK = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'asshole', 'bastard', 'slut', 'whore', 'retard', 'nigger', 'nigga', 'faggot', 'chutiya', 'madarchod', 'bhenchod', 'behenchod', 'bsdk', 'gandu', 'randi'];
const MASK_RE = new RegExp(MASK.map((w) => w.split('').join('+[^a-z0-9]{0,2}') + '+').join('|'), 'gi');
const LINK_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|gg|xyz|ru|me|ly|co|app|dev|site|link|in)(?:\/\S*)?\b/gi;
// Control chars, zero-width and bidi overrides (used to hide or flip text).
const INVISIBLE_RE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

/** Clean one line of chat; null when nothing readable is left. */
export function cleanChat(raw: string): string | null {
  const text = raw
    .normalize('NFKC')
    .replace(INVISIBLE_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX)
    .replace(LINK_RE, '[link]')
    .replace(MASK_RE, (w) => w[0] + '*'.repeat(Math.max(2, w.length - 1)));
  return text ? text : null;
}

/**
 * Sliding-window limiter: at most `count` messages per `windowMs`, and no two
 * closer than `gapMs`. Used per sender on receive, and on my own send so an
 * honest player never trips the receivers' limit.
 */
export function chatLimiter(count = 5, windowMs = 8000, gapMs = 500) {
  const times = new Map<string, number[]>();
  return (sender: string, now = Date.now()): boolean => {
    const recent = (times.get(sender) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= count || (recent.length && now - recent[recent.length - 1] < gapMs)) {
      times.set(sender, recent);
      return false;
    }
    recent.push(now);
    times.set(sender, recent);
    // Forget senders who went quiet, so fake ids can't grow the map forever.
    if (times.size > 64) for (const [k, v] of times) if (!v.some((t) => now - t < windowMs)) times.delete(k);
    return true;
  };
}

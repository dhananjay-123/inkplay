import type { Role, Rule } from '@/lib/schema';

/** Short HUD label for a rule ("LOW GRAVITY"). */
export function ruleChip(r: Rule): string {
  switch (r.kind) {
    case 'gravity': return r.value < 0.8 ? 'Low gravity' : r.value > 1.25 ? 'Heavy gravity' : 'Gravity tweaked';
    case 'invert_gravity': return 'Upside down';
    case 'player_speed': return r.value >= 1 ? 'Super speed' : 'Slow-mo hero';
    case 'jump_power': return r.value >= 1 ? 'Big jumps' : 'Tiny hops';
    case 'enemy_speed': return r.value >= 1 ? 'Fast enemies' : 'Sleepy enemies';
    case 'enemies_accelerate': return 'Enemies get faster';
    case 'time_limit': return `${r.seconds}s time limit`;
    case 'collectible_effect': return `Pickups = ${r.effect.replace('_', ' ')}`;
    case 'boss': return `Boss: ${r.name}`;
    case 'night_mode': return 'Night mode';
    case 'mirror_world': return 'Mirror controls';
  }
}

export const ROLE_COLOR: Record<Role, string> = {
  platform: 'var(--ink)',
  hazard: 'var(--hazard)',
  bouncy: 'var(--ink)',
  enemy: 'var(--hazard)',
  collectible: 'var(--ink)',
  powerup: 'var(--ink)',
  goal: 'var(--ink)',
  player: 'var(--ink)',
  rule_text: 'var(--graphite)',
  decoration: 'var(--graphite)',
};

export const ROLE_LABEL: Record<Role, string> = {
  platform: 'platform',
  hazard: 'hazard',
  bouncy: 'bouncy',
  enemy: 'enemy',
  collectible: 'collectible',
  powerup: 'power-up',
  goal: 'goal',
  player: 'player',
  rule_text: 'rule',
  decoration: 'decoration',
};

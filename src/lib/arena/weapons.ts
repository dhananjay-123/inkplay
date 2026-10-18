/**
 * Arena weapons and buffs. Plain numbers, shared by every client so a shot
 * that crosses the wire is simulated the same way everywhere. The shot only
 * carries the weapon index; the victim looks the damage up here.
 */

export type ProjectileKind = 'bullet' | 'flame' | 'saw' | 'rocket' | 'grenade';

export type Weapon = {
  name: string;
  kind: ProjectileKind;
  fireMs: number;
  /** Rounds per pickup (SMG: per magazine, it reloads; specials run out and drop back to the SMG). */
  ammo: number;
  speed: number;
  life: number;
  damage: number;
  spread: number;
  pellets: number;
  /** Autofire only pulls the trigger when the locked enemy is closer than this. */
  reach: number;
  /** Splash radius for explosives. */
  radius?: number;
};

export const WEAPON_IDS = ['smg', 'rifle', 'flamethrower', 'chainsaw', 'rockets', 'grenade'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

export const WEAPONS: Record<WeaponId, Weapon> = {
  smg: { name: 'SMG', kind: 'bullet', fireMs: 115, ammo: 30, speed: 1500, life: 0.55, damage: 10, spread: 0.06, pellets: 1, reach: 760 },
  rifle: { name: 'Ink rifle', kind: 'bullet', fireMs: 210, ammo: 24, speed: 2300, life: 0.6, damage: 24, spread: 0.012, pellets: 1, reach: 1200 },
  flamethrower: { name: 'Flamethrower', kind: 'flame', fireMs: 40, ammo: 140, speed: 640, life: 0.4, damage: 3, spread: 0.32, pellets: 1, reach: 260 },
  chainsaw: { name: 'Chainsaw', kind: 'saw', fireMs: 70, ammo: Infinity, speed: 900, life: 0.06, damage: 7, spread: 0.2, pellets: 1, reach: 62 },
  rockets: { name: 'Rockets', kind: 'rocket', fireMs: 800, ammo: 5, speed: 760, life: 1.6, damage: 75, spread: 0, pellets: 1, reach: 950, radius: 140 },
  grenade: { name: 'Grenade', kind: 'grenade', fireMs: 600, ammo: 0, speed: 720, life: 1.6, damage: 70, spread: 0, pellets: 1, reach: 0, radius: 150 },
};

/** Chainsaw is a timed weapon (no ammo): seconds it lasts after pickup. */
export const CHAINSAW_SECONDS = 15;
export const START_GRENADES = 2;
export const MAX_GRENADES = 5;

export const BUFFS = {
  shield: { name: 'Shield', seconds: 15 },
  speed: { name: 'Speed', seconds: 12 },
  double_jump: { name: 'Double jump', seconds: 20 },
  jetfuel: { name: 'Endless jet', seconds: 12 },
  damage: { name: 'Double damage', seconds: 12 },
} as const;
export type BuffId = keyof typeof BUFFS;
export const BUFF_IDS = Object.keys(BUFFS) as BuffId[];
export const SHIELD_HP = 60;

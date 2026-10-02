/** ВСИЧКИ числа за баланса на играта са тук. */

export type WeaponKind = 'pistol' | 'revolver' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'rocket' | 'grenade' | 'ray';

export type FireMode = 'bullet' | 'pellets' | 'rocket' | 'grenade' | 'beam';

export type WeaponDef = {
  kind: WeaponKind;
  name: string;
  model: string;
  mode: FireMode;
  /** Редкост, с която излиза от сандък (1..5) */
  baseTier: number;
  dmg: number;
  /** изстрела в секунда */
  rate: number;
  range: number;
  /** разсейване в градуси */
  spread: number;
  pellets?: number;
  /** през колко зомбита минава куршумът */
  pierce?: number;
  /** радиус на взрива */
  aoe?: number;
  knock?: number;
  /** дължина на модела в ръката (м) */
  size: number;
  /** цвят на следата */
  tracer: number;
  sound: 'light' | 'heavy' | 'shotgun' | 'snipe' | 'rocket' | 'pop' | 'zap';
};

export const WEAPONS: Record<WeaponKind, WeaponDef> = {
  pistol: { kind: 'pistol', name: 'Пистолет', model: 'gun_pistol', mode: 'bullet', baseTier: 1, dmg: 11, rate: 2.6, range: 13, spread: 3, size: 0.55, tracer: 0xffe9a0, sound: 'light' },
  revolver: { kind: 'revolver', name: 'Револвер', model: 'gun_revolver', mode: 'bullet', baseTier: 1, dmg: 26, rate: 1.25, range: 15, spread: 2, pierce: 1, knock: 0.5, size: 0.65, tracer: 0xffd27a, sound: 'heavy' },
  smg: { kind: 'smg', name: 'Узи', model: 'gun_smg', mode: 'bullet', baseTier: 2, dmg: 6, rate: 9, range: 11, spread: 7, size: 0.65, tracer: 0xfff2b0, sound: 'light' },
  shotgun: { kind: 'shotgun', name: 'Пушка', model: 'gun_shotgun', mode: 'pellets', baseTier: 2, dmg: 8, pellets: 7, rate: 1.1, range: 9, spread: 26, knock: 0.9, size: 0.98, tracer: 0xffc070, sound: 'shotgun' },
  rifle: { kind: 'rifle', name: 'Автомат', model: 'gun_rifle', mode: 'bullet', baseTier: 3, dmg: 13, rate: 6.5, range: 15, spread: 4, pierce: 1, size: 1.04, tracer: 0xffe080, sound: 'heavy' },
  sniper: { kind: 'sniper', name: 'Снайпер', model: 'gun_sniper', mode: 'bullet', baseTier: 3, dmg: 75, rate: 0.85, range: 26, spread: 0, pierce: 6, knock: 1.2, size: 1.23, tracer: 0xaee8ff, sound: 'snipe' },
  grenade: { kind: 'grenade', name: 'Гранатомет', model: 'gun_grenade', mode: 'grenade', baseTier: 3, dmg: 40, rate: 0.8, range: 16, spread: 4, aoe: 3.2, knock: 2, size: 0.78, tracer: 0xffffff, sound: 'pop' },
  rocket: { kind: 'rocket', name: 'Ракетомет', model: 'gun_rocket', mode: 'rocket', baseTier: 4, dmg: 70, rate: 0.55, range: 22, spread: 2, aoe: 4.2, knock: 3, size: 1.10, tracer: 0xffffff, sound: 'rocket' },
  ray: { kind: 'ray', name: 'Лъчемет', model: 'gun_ray', mode: 'beam', baseTier: 4, dmg: 34, rate: 10, range: 14, spread: 0, pierce: 99, size: 0.72, tracer: 0x7dff6a, sound: 'zap' },
};

export const ALL_WEAPONS = Object.keys(WEAPONS) as WeaponKind[];

export const TIERS = [
  { name: '', color: '#888', hex: 0x888888 },
  { name: 'Обикновено', color: '#9aa3ad', hex: 0x9aa3ad },
  { name: 'Необикновено', color: '#3fc35a', hex: 0x3fc35a },
  { name: 'Рядко', color: '#3a8bff', hex: 0x3a8bff },
  { name: 'Епично', color: '#a64dff', hex: 0xa64dff },
  { name: 'Легендарно', color: '#ffb21e', hex: 0xffb21e },
];
export const MAX_TIER = 5;

/** Сила на оръжие според редкостта (всяко сливане = следваща редкост). */
export function weaponStats(kind: WeaponKind, tier: number) {
  const w = WEAPONS[kind];
  const up = tier - 1;
  return {
    dmg: w.dmg * Math.pow(1.75, up),
    rate: w.rate * (1 + 0.12 * up),
    range: w.range * (1 + 0.06 * up),
    pellets: (w.pellets ?? 1) + (w.mode === 'pellets' ? up : 0),
    pierce: (w.pierce ?? 0) + (w.mode === 'bullet' && up >= 2 ? 1 : 0),
    aoe: (w.aoe ?? 0) * (1 + 0.1 * up),
  };
}

export type Item = { id: number; kind: WeaponKind; tier: number };

let nextId = 1;
export function makeItem(kind: WeaponKind, tier: number): Item {
  return { id: nextId++, kind, tier };
}

export const BACKPACK = { cols: 3, rows: 3 };

export const HERO = {
  hp: 100,
  speed: 6.2,
  /** колко далеч скача между покривите (празнина в метри) */
  leapGap: 6.2,
  /** с колко метра нагоре може да скочи */
  leapUp: 3.6,
  regenDelay: 4,
  regen: 3,
  radius: 0.45,
};

export type ZombieKind = 'walker' | 'runner' | 'brute' | 'boss';

export const ZOMBIES: Record<ZombieKind, { hp: number; speed: number; scale: number; dmg: number; tint: [number, number, number]; climb: number }> = {
  walker: { hp: 16, speed: 2.1, scale: 1, dmg: 5, tint: [1, 1, 1], climb: 1.35 },
  runner: { hp: 11, speed: 4.4, scale: 0.9, dmg: 4, tint: [1.15, 1.05, 0.7], climb: 2.6 },
  brute: { hp: 120, speed: 1.6, scale: 1.55, dmg: 18, tint: [1.2, 0.7, 0.65], climb: 1.1 },
  boss: { hp: 1400, speed: 1.9, scale: 2.5, dmg: 35, tint: [0.85, 0.6, 1.25], climb: 1.4 },
};

/** Темпото на ордата според изминалите секунди. */
export const DIRECTOR = {
  waveLength: 45,
  spawnRate: (t: number) => 1.9 + t * 0.055,
  hpMul: (t: number) => 1 + t * 0.011,
  runnerShare: (t: number) => Math.min(0.45, Math.max(0, (t - 30) / 400)),
  bruteEvery: 14,
  bruteFrom: 75,
  bossEvery: 4, // всяка 4-та вълна
  chestFirst: 6,
  chestEvery: (t: number) => Math.min(30, 16 + t * 0.05),
};

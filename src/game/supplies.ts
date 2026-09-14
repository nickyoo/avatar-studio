/**
 * Office supplies, as ordnance.
 *
 * The progression fantasy is that your weapon is always something you could
 * plausibly have found on a desk — the joke only works if the stats stay
 * honest to the object. A paperclip is fast and nearly harmless; a stapler is
 * slow, heavy and genuinely ends someone.
 */
export interface Supply {
  id: string;
  name: string;
  /** Damage on a clean hit. */
  damage: number;
  /** Horizontal launch speed at zero and full wind-up, m/s. */
  speedMin: number;
  speedMax: number;
  /** Upward launch speed at zero and full wind-up. Weak throws lob. */
  liftMin: number;
  liftMax: number;
  gravity: number;
  /** Collision radius and visual size. */
  radius: number;
  size: [number, number, number];
  color: number;
  /** Impulse applied to whatever it hits. */
  knockback: number;
  /** Times it bounces off geometry before despawning. */
  bounces: number;
  /** Seconds between throws. */
  cooldown: number;
  /** Never runs out. The baseline supply you always fall back to. */
  infinite: boolean;
  /** Screen punch on impact, 0..1. */
  impact: number;
}

export const SUPPLIES: Record<string, Supply> = {
  paperclip: {
    id: 'paperclip',
    name: 'PAPERCLIP',
    damage: 9,
    speedMin: 16,
    speedMax: 32,
    liftMin: 4.2,
    liftMax: 1.4,
    gravity: 17,
    radius: 0.22,
    size: [0.1, 0.06, 0.24],
    color: 0xd8dbe0,
    knockback: 1.2,
    bounces: 0,
    cooldown: 0.2,
    infinite: true,
    impact: 0.1,
  },
  stapler: {
    id: 'stapler',
    name: 'STAPLER',
    damage: 38,
    speedMin: 12,
    speedMax: 24,
    liftMin: 5.0,
    liftMax: 2.2,
    gravity: 26,
    radius: 0.34,
    size: [0.2, 0.18, 0.46],
    color: 0xc8402e,
    knockback: 7.5,
    bounces: 1,
    cooldown: 0.46,
    infinite: false,
    impact: 0.4,
  },
};

export const STARTING_LOADOUT: Array<{ id: string; count: number }> = [
  { id: 'paperclip', count: Infinity },
  { id: 'stapler', count: 6 },
];

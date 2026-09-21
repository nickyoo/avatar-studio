import { Color } from 'three';

/**
 * Colour is the progress bar.
 *
 * Every floor band restates the same palette one rung further up the ladder:
 * the carpet warms, the walls stop being drywall, and the light stops being
 * fluorescent. A player should be able to screenshot any frame and guess
 * roughly how high they are without reading the HUD.
 */
export interface FloorPalette {
  name: string;
  carpet: number;
  wall: number;
  partition: number;
  desk: number;
  accent: number;
  fog: number;
  light: number;
  ambient: number;
  /** 0..1 fed to the composite grade. */
  grade: number;
}

export const BANDS: FloorPalette[] = [
  {
    name: 'THE FLOOR',
    carpet: 0x5f5f53,
    wall: 0x8e8b7e,
    partition: 0x6f7264,
    desk: 0x9a8f78,
    accent: 0xc8402e,
    fog: 0x4a4d42,
    light: 0xdfe6c8,
    ambient: 0x474a3f,
    grade: 0.0,
  },
  {
    name: 'MIDDLE MANAGEMENT',
    carpet: 0x52606b,
    wall: 0x8d94a0,
    partition: 0x5e6a74,
    desk: 0x8b8272,
    accent: 0xe07a2a,
    fog: 0x424d57,
    light: 0xe8eede,
    ambient: 0x454e57,
    grade: 0.35,
  },
  {
    name: 'THE EXECUTIVE LEVEL',
    carpet: 0x5f4b41,
    wall: 0xa89a82,
    partition: 0x7a6552,
    desk: 0x6b4b34,
    accent: 0xf0c04a,
    fog: 0x4e4038,
    light: 0xfff0cc,
    ambient: 0x554740,
    grade: 0.72,
  },
  {
    name: 'THE TOP',
    carpet: 0x6d563d,
    wall: 0xd8c79a,
    partition: 0x9d8354,
    desk: 0x4a3222,
    accent: 0xffe08a,
    fog: 0x5c4a32,
    light: 0xfff6dd,
    ambient: 0x665443,
    grade: 1.0,
  },
];

/**
 * Which band a given floor number belongs to.
 *
 * Five floors per band, so each band ends on a boss and a good mobile run
 * visibly climbs through two or three of them. The previous thresholds (15,
 * 40, 75) meant a typical session never left band one and the whole
 * colour-as-progress idea was invisible in practice.
 */
export function bandForFloor(floor: number): FloorPalette {
  if (floor <= 5) return BANDS[0];
  if (floor <= 10) return BANDS[1];
  if (floor <= 15) return BANDS[2];
  return BANDS[3];
}

export const SHADOW_TINT = new Color(0.86, 0.9, 0.78);
export const HIGHLIGHT_TINT = new Color(1.06, 0.98, 0.82);

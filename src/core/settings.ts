/**
 * Player preferences, persisted across sessions.
 *
 * These are the knobs that genuinely differ between people holding a phone,
 * not a wall of options for its own sake. Thumb reach varies enormously, and a
 * two-thumb game with a hardcoded throwing hand is quietly unplayable for a
 * left-hander.
 */
export interface Settings {
  /** Which half of the screen throws. The other half moves. */
  throwHand: 'right' | 'left';
  /** Pixels of pull-back for a full-power throw. */
  pullRadius: number;
  /** Timescale while winding up. 1 disables the slow-motion entirely. */
  slowmo: number;
  /** How far the camera swings to face a throw. 0 keeps it locked forward. */
  cameraTurn: number;
  /** Screen shake amount. 0 disables it. */
  shake: number;
  /** Highest floor ever reached. */
  bestFloor: number;
}

export const DEFAULTS: Settings = {
  throwHand: 'right',
  pullRadius: 130,
  slowmo: 0.3,
  cameraTurn: 0.65,
  shake: 0.7,
  bestFloor: 0,
};

export const LIMITS = {
  pullRadius: { min: 80, max: 200, step: 10 },
  slowmo: { min: 0.15, max: 1, step: 0.05 },
  cameraTurn: { min: 0, max: 1, step: 0.05 },
  shake: { min: 0, max: 1, step: 0.05 },
};

const KEY = 'upward-mobility/settings';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function loadSettings(): Settings {
  // localStorage throws outright in some privacy modes, so every access is
  // guarded and the game has to be happy with defaults.
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      throwHand: parsed.throwHand === 'left' ? 'left' : 'right',
      pullRadius: clamp(
        Number(parsed.pullRadius) || DEFAULTS.pullRadius,
        LIMITS.pullRadius.min,
        LIMITS.pullRadius.max,
      ),
      slowmo: clamp(Number(parsed.slowmo) || DEFAULTS.slowmo, LIMITS.slowmo.min, LIMITS.slowmo.max),
      // `?? ` rather than `||` — 0 is a legitimate value for both of these and
      // must not fall through to the default.
      cameraTurn: clamp(
        parsed.cameraTurn ?? DEFAULTS.cameraTurn,
        LIMITS.cameraTurn.min,
        LIMITS.cameraTurn.max,
      ),
      shake: clamp(parsed.shake ?? DEFAULTS.shake, LIMITS.shake.min, LIMITS.shake.max),
      bestFloor: Math.max(0, Math.floor(Number(parsed.bestFloor) || 0)),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Nothing to do — the run just won't be remembered.
  }
}

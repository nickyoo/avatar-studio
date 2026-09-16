import { Vector2 } from 'three';
import type { Settings } from './settings';

/**
 * Everything the game is allowed to know about the player's hands.
 *
 * Deliberately abstract: a WebXR implementation fills the same struct from
 * controller poses and throw velocity, and no gameplay code changes.
 */
export interface InputState {
  /** Desired movement on the ground plane, screen-relative, length <= 1. */
  move: Vector2;
  /** True while the player is winding up a throw. */
  aiming: boolean;
  /** Screen-relative throw direction, normalised. Valid while aiming. */
  aimDir: Vector2;
  /** Wind-up strength, 0..1. */
  aimPower: number;
  /** One-frame flag: a throw was released this frame. */
  released: boolean;
  /** Wind-up strength at the instant of release. */
  releasePower: number;
  /** Throw direction at the instant of release. */
  releaseDir: Vector2;
  /** One-frame flag: a wind-up was cancelled without throwing. */
  cancelled: boolean;
}

const DEAD_ZONE = 6; // px before a drag counts as intent
const MOVE_RADIUS = 58; // px of drag for full-speed movement
/** Time constant of the aim low-pass filter, in seconds. */
const AIM_TAU = 0.055;

const scratch = new Vector2();

interface Stick {
  id: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
}

/**
 * Touch layout: left half of the screen is a floating movement stick, right
 * half is the throw. Both halves are "floating" — wherever the thumb lands
 * becomes the origin — because fixed on-screen sticks are miserable on a
 * phone you're holding one-handed on a train.
 */
export class Input {
  readonly state: InputState = {
    move: new Vector2(),
    aiming: false,
    aimDir: new Vector2(0, -1),
    aimPower: 0,
    released: false,
    releasePower: 0,
    releaseDir: new Vector2(0, -1),
    cancelled: false,
  };

  private moveStick: Stick | null = null;
  private aimStick: Stick | null = null;
  private keys = new Set<string>();
  private mouseAiming = false;

  /**
   * Low-passed aim, and the only aim the game ever sees.
   *
   * A thumb resting on glass is never still — raw touch coordinates jitter by
   * a few pixels constantly, which at throwing distance swings the arc around
   * by a noticeable amount. The release latches these smoothed values too, so
   * what you were shown is exactly what you throw.
   */
  private readonly smoothDir = new Vector2(0, -1);
  private smoothPower = 0;
  private wasAiming = false;

  constructor(
    el: HTMLElement,
    private readonly settings: Settings,
  ) {
    el.addEventListener('pointerdown', this.onDown, { passive: false });
    el.addEventListener('pointermove', this.onMove, { passive: false });
    el.addEventListener('pointerup', this.onUp, { passive: false });
    el.addEventListener('pointercancel', this.onUp, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Read-only view of the on-screen sticks, for the HUD to draw. */
  get sticks() {
    return { move: this.moveStick, aim: this.aimStick };
  }

  private isTouch(e: PointerEvent) {
    return e.pointerType !== 'mouse';
  }

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    const stick: Stick = {
      id: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      x: e.clientX,
      y: e.clientY,
    };

    if (this.isTouch(e)) {
      // One half of the screen throws, the other moves. Which is which is a
      // setting, because a hardcoded throwing hand locks out left-handers.
      const onRight = e.clientX >= window.innerWidth * 0.5;
      const isThrow = this.settings.throwHand === 'right' ? onRight : !onRight;
      if (isThrow && !this.aimStick) this.aimStick = stick;
      else if (!isThrow && !this.moveStick) this.moveStick = stick;
    } else {
      // Desktop: mouse aims, WASD moves.
      this.aimStick = stick;
      this.mouseAiming = true;
    }
  };

  private onMove = (e: PointerEvent) => {
    if (this.moveStick?.id === e.pointerId) {
      this.moveStick.x = e.clientX;
      this.moveStick.y = e.clientY;
    }
    if (this.aimStick?.id === e.pointerId) {
      this.aimStick.x = e.clientX;
      this.aimStick.y = e.clientY;
    }
  };

  private onUp = (e: PointerEvent) => {
    if (this.moveStick?.id === e.pointerId) this.moveStick = null;
    if (this.aimStick?.id === e.pointerId) {
      // Snapshot the wind-up here rather than letting the game read it next
      // frame: by then update() has already cleared it, and every throw would
      // leave the hand at zero power.
      if (this.wasAiming && this.smoothPower > 0.05) {
        this.state.released = true;
        this.state.releasePower = this.smoothPower;
        this.state.releaseDir.copy(this.smoothDir);
      } else {
        // A tap under the dead zone is a stray thumb, not a throw.
        this.state.cancelled = true;
      }
      this.aimStick = null;
      this.mouseAiming = false;
      this.wasAiming = false;
      this.smoothPower = 0;
    }
  };

  /** Pull *back* to throw forward, like a slingshot. */
  private readStick(stick: Stick): { dir: Vector2; power: number; engaged: boolean } {
    const dx = stick.originX - stick.x;
    const dy = stick.originY - stick.y;
    const len = Math.hypot(dx, dy);
    if (len <= DEAD_ZONE) return { dir: this.state.aimDir, power: 0, engaged: false };
    return {
      dir: scratch.set(dx / len, dy / len),
      power: Math.min(1, (len - DEAD_ZONE) / this.settings.pullRadius),
      engaged: true,
    };
  }

  /** Call once per frame, before gameplay reads `state`. */
  update(rawDt: number) {
    const s = this.state;

    // --- movement -------------------------------------------------------
    s.move.set(0, 0);
    if (this.moveStick) {
      const dx = this.moveStick.x - this.moveStick.originX;
      const dy = this.moveStick.y - this.moveStick.originY;
      const len = Math.hypot(dx, dy);
      if (len > DEAD_ZONE) {
        const mag = Math.min(1, (len - DEAD_ZONE) / MOVE_RADIUS);
        s.move.set((dx / len) * mag, (dy / len) * mag);
      }
    }
    // Keyboard is additive so desktop testing feels identical.
    const kx = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const ky = (this.keys.has('KeyS') ? 1 : 0) - (this.keys.has('KeyW') ? 1 : 0);
    if (kx || ky) s.move.set(kx, ky).normalize();
    if (s.move.lengthSq() > 1) s.move.normalize();

    // --- throw wind-up --------------------------------------------------
    s.aiming = false;
    s.aimPower = 0;
    if (this.aimStick) {
      const aim = this.readStick(this.aimStick);
      if (aim.engaged) {
        if (!this.wasAiming) {
          // First engaged frame: snap, so the wind-up starts where the thumb
          // actually is rather than easing in from a stale direction.
          this.smoothDir.copy(aim.dir);
          this.smoothPower = aim.power;
        } else {
          const k = 1 - Math.exp(-rawDt / AIM_TAU);
          this.smoothDir.lerp(aim.dir, k);
          if (this.smoothDir.lengthSq() > 1e-6) this.smoothDir.normalize();
          this.smoothPower += (aim.power - this.smoothPower) * k;
        }
        this.wasAiming = true;
        s.aiming = true;
        s.aimPower = this.smoothPower;
        s.aimDir.copy(this.smoothDir);
      } else if (this.mouseAiming) {
        // Holding the mouse still counts as aiming, at zero power.
        s.aiming = true;
      }
    }
    if (!s.aiming) this.wasAiming = false;
  }

  /** Clear one-frame flags. Call at the very end of the frame. */
  lateUpdate() {
    this.state.released = false;
    this.state.cancelled = false;
  }
}

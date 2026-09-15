import { Box3, Group, Vector2, Vector3 } from 'three';
import { humanoid, walkCycle, type Humanoid } from './models';
import { resolveCircle } from './physics';
import { SUPPLIES, STARTING_LOADOUT, type Supply } from './supplies';
import type { HitTarget } from './Projectiles';

const SPEED = 7.2;
const AIM_SPEED_MULT = 0.45; // you can still shuffle while winding up, barely
const ACCEL = 34;
const RADIUS = 0.42;

export interface Slot {
  supply: Supply;
  count: number;
}

export class Player implements HitTarget {
  readonly root = new Group();
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  /** Where the throw comes from — roughly the right hand. */
  readonly muzzle = new Vector3();

  readonly body: Humanoid;

  health = 100;
  maxHealth = 100;
  alive = true;

  /** HitTarget: centre of the hurt sphere, measured up from the feet. */
  readonly hitHeight = 1.0;
  readonly hitRadius = 0.5;

  /** Fired whenever damage actually lands, so the game can shake the screen. */
  onDamaged: ((amount: number) => void) | null = null;

  /** Facing, in radians. Y-up, 0 = -Z. */
  yaw = 0;

  slots: Slot[] = [];
  slotIndex = 0;

  cooldown = 0;
  invuln = 0;

  private walkPhase = 0;
  private throwAnim = 0;

  constructor() {
    this.body = humanoid({ skin: 0xc79a72, shirt: 0x5b7fa6, trousers: 0x3a3d44, hair: 0x3b2b20 });
    this.root.add(this.body.root);
    this.slots = STARTING_LOADOUT.map((s) => ({ supply: SUPPLIES[s.id], count: s.count }));
  }

  get supply(): Supply {
    return this.slots[this.slotIndex].supply;
  }

  get ammo(): number {
    return this.slots[this.slotIndex].count;
  }

  cycleSlot() {
    // Skip anything we're out of, but never leave the player weaponless.
    for (let i = 1; i <= this.slots.length; i++) {
      const next = (this.slotIndex + i) % this.slots.length;
      const s = this.slots[next];
      if (s.count > 0 || s.supply.infinite) {
        this.slotIndex = next;
        return;
      }
    }
  }

  give(id: string, count: number) {
    const slot = this.slots.find((s) => s.supply.id === id);
    if (slot) slot.count += count;
  }

  canThrow() {
    return this.alive && this.cooldown <= 0 && (this.ammo > 0 || this.supply.infinite);
  }

  consume() {
    const slot = this.slots[this.slotIndex];
    if (!slot.supply.infinite) slot.count = Math.max(0, slot.count - 1);
    this.cooldown = slot.supply.cooldown;
    this.throwAnim = 1;
    if (slot.count <= 0 && !slot.supply.infinite) this.cycleSlot();
  }

  /** HitTarget: incoming projectile. Knockback is ignored — being shoved
   *  around by a memo would fight the player for control of their own feet. */
  onHit(damage: number, _knockback: Vector3, _impact: number) {
    this.damage(damage);
  }

  damage(amount: number) {
    if (!this.alive || this.invuln > 0) return false;
    this.health -= amount;
    this.invuln = 0.7;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
    this.onDamaged?.(amount);
    return true;
  }

  spawnAt(p: Vector3) {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.root.position.copy(p);
  }

  /**
   * @param move    desired direction on the ground plane, world space
   * @param aiming  whether the player is winding up a throw
   * @param facing  direction to face while aiming, world space
   */
  update(dt: number, move: Vector3, aiming: boolean, facing: Vector3 | null, colliders: Box3[], bounds: {
    minX: number; maxX: number; minZ: number; maxZ: number;
  }) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.throwAnim = Math.max(0, this.throwAnim - dt * 5);

    const targetSpeed = SPEED * (aiming ? AIM_SPEED_MULT : 1);
    const desired = move.clone().multiplyScalar(targetSpeed);
    this.velocity.x += (desired.x - this.velocity.x) * Math.min(1, ACCEL * dt);
    this.velocity.z += (desired.z - this.velocity.z) * Math.min(1, ACCEL * dt);

    this.position.addScaledVector(this.velocity, dt);
    this.position.x = Math.max(bounds.minX, Math.min(bounds.maxX, this.position.x));
    this.position.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, this.position.z));
    resolveCircle(this.position, RADIUS, colliders);

    // Face the throw while aiming, otherwise face where you're going.
    const face = aiming && facing ? facing : this.velocity;
    if (face.lengthSq() > 0.02) {
      const target = Math.atan2(face.x, face.z);
      let delta = target - this.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.yaw += delta * Math.min(1, (aiming ? 22 : 12) * dt);
    }

    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.walkPhase += speed * dt * 2.6;
    walkCycle(this.body, this.walkPhase, Math.min(0.85, speed * 0.14));

    // Throw follow-through: right arm snaps forward then settles.
    const t = this.throwAnim;
    this.body.armR.rotation.x = -t * 2.3 - (aiming ? 1.5 : 0);
    this.body.armL.rotation.x += aiming ? -0.4 : 0;
    this.body.torso.rotation.y = aiming ? -0.25 : 0;

    // Blink on i-frames so a hit is unmissable on a small screen.
    this.body.root.visible = this.invuln <= 0 || Math.floor(this.invuln * 22) % 2 === 0;

    this.muzzle.copy(this.position);
    this.muzzle.y += 1.45;
    this.muzzle.x += Math.sin(this.yaw) * 0.55;
    this.muzzle.z += Math.cos(this.yaw) * 0.55;
  }
}

/** Screen-space input -> world-space direction, relative to the camera yaw. */
export function screenToWorld(v: Vector2, cameraYaw: number, out: Vector3): Vector3 {
  // Screen +y is down, which is "away from the camera" in world terms.
  const sin = Math.sin(cameraYaw);
  const cos = Math.cos(cameraYaw);
  // Camera basis on the ground plane, using the convention that a yaw of Y
  // faces (sin Y, 0, cos Y) — the same one Player.yaw uses.
  const forward = -v.y;
  out.set(v.x * cos + forward * sin, 0, forward * cos - v.x * sin);
  return out;
}

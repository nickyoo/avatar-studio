import { Box3, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { humanoid, walkCycle, type Humanoid, type HumanoidColors } from './models';
import { resolveCircle } from './physics';
import type { HitTarget } from './Projectiles';

export type EnemyKind = 'drone' | 'intern';

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  speed: number;
  damage: number;
  /** How close it needs to be to start a swing. */
  reach: number;
  /** Seconds of obvious wind-up before the hit lands. This is the tell. */
  telegraph: number;
  recover: number;
  scale: number;
  hitRadius: number;
  hitHeight: number;
  colors: HumanoidColors;
  score: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  drone: {
    kind: 'drone',
    name: 'CUBICLE DRONE',
    hp: 42,
    speed: 2.35,
    damage: 12,
    reach: 1.55,
    telegraph: 0.5,
    recover: 0.55,
    scale: 1,
    hitRadius: 0.55,
    hitHeight: 1.1,
    colors: { skin: 0xb98f6a, shirt: 0x7d8a93, trousers: 0x33363c, hair: 0x2e2620 },
    score: 10,
  },
  intern: {
    kind: 'intern',
    name: 'THE INTERN',
    hp: 16,
    speed: 5.1,
    damage: 8,
    reach: 1.35,
    telegraph: 0.26,
    recover: 0.34,
    scale: 0.88,
    hitRadius: 0.46,
    hitHeight: 1.0,
    colors: { skin: 0xd2a880, shirt: 0xd8d2c0, trousers: 0x4a4436, hair: 0x6b4a2a },
    score: 6,
  },
};

/** Shared white material used for the one-frame hit pop. */
const HIT_MATERIAL = new MeshBasicMaterial({ color: 0xffffff, fog: false });

type State = 'chase' | 'windup' | 'strike' | 'recover' | 'dead';

export class Enemy implements HitTarget {
  readonly def: EnemyDef;
  readonly root = new Group();
  readonly position = new Vector3();
  readonly velocity = new Vector3();

  hp: number;
  alive = true;
  /** Set once the death animation is finished and it's safe to remove. */
  removable = false;

  hitRadius: number;
  hitHeight: number;

  private readonly body: Humanoid;
  private readonly skins: Array<{ mesh: Mesh; material: Mesh['material'] }> = [];
  private state: State = 'chase';
  private timer = 0;
  private walkPhase = Math.random() * 10;
  private flash = 0;
  private stagger = 0;
  private unstick = 0;
  private unstickSign = 1;
  private deathSpin = 0;
  private yaw = 0;
  private struck = false;

  constructor(def: EnemyDef) {
    this.def = def;
    this.hp = def.hp;
    this.hitRadius = def.hitRadius;
    this.hitHeight = def.hitHeight * def.scale;

    this.body = humanoid(def.colors, def.scale);
    this.root.add(this.body.root);

    // Cache the real material per mesh so the hit pop can be reverted without
    // touching the shared material (which every other enemy is also using).
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) this.skins.push({ mesh: m, material: m.material });
    });
  }

  spawnAt(p: Vector3) {
    this.position.copy(p);
    this.root.position.copy(p);
  }

  onHit(damage: number, knockback: Vector3, _impact: number) {
    if (!this.alive) return;
    this.hp -= damage;
    this.flash = 0.09;
    this.velocity.add(knockback);

    if (this.hp <= 0) {
      this.kill();
      return;
    }
    // A solid hit interrupts a wind-up. Heavy supplies are a panic button.
    if (damage >= 25 || this.state === 'windup') {
      this.stagger = Math.max(this.stagger, damage >= 25 ? 0.42 : 0.18);
      this.state = 'chase';
      this.timer = 0;
    }
  }

  kill() {
    if (!this.alive) return;
    this.alive = false;
    this.state = 'dead';
    this.timer = 0;
    this.deathSpin = (Math.random() - 0.5) * 3;
  }

  /**
   * @returns damage to apply to the player this frame, or 0
   */
  update(
    dt: number,
    target: Vector3,
    others: Enemy[],
    colliders: Box3[],
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  ): number {
    if (this.flash > 0) {
      this.flash -= dt;
      const hit = this.flash > 0;
      for (const s of this.skins) s.mesh.material = hit ? HIT_MATERIAL : s.material;
    }

    if (this.state === 'dead') {
      this.timer += dt;
      // Topple, sink, vanish. No ragdoll physics, no bones — a rotation and a
      // y-offset sells "dropped" perfectly well at this resolution.
      const t = Math.min(1, this.timer / 0.9);
      this.root.rotation.x = -t * 1.5;
      this.root.rotation.z = this.deathSpin * t * 0.4;
      this.root.position.y = -t * t * 1.4;
      this.root.scale.setScalar(1 - t * 0.15);
      if (this.timer > 1.3) this.removable = true;
      return 0;
    }

    this.stagger = Math.max(0, this.stagger - dt);
    this.unstick = Math.max(0, this.unstick - dt);

    const toTarget = new Vector3().subVectors(target, this.position).setY(0);
    const dist = toTarget.length();
    if (dist > 0.001) toTarget.divideScalar(dist);

    let damageDealt = 0;
    let desired = new Vector3();

    switch (this.state) {
      case 'chase': {
        if (this.stagger <= 0) {
          desired.copy(toTarget);
          // Slide around whatever we're grinding into instead of pushing at it.
          if (this.unstick > 0) {
            const a = this.unstickSign * 1.1;
            desired.set(
              desired.x * Math.cos(a) - desired.z * Math.sin(a),
              0,
              desired.x * Math.sin(a) + desired.z * Math.cos(a),
            );
          }
          if (dist < this.def.reach) {
            this.state = 'windup';
            this.timer = this.def.telegraph;
            this.struck = false;
          }
        }
        break;
      }
      case 'windup': {
        this.timer -= dt;
        // Creep forward during the tell so the swing still connects if you
        // stand still, but backing off beats it.
        desired.copy(toTarget).multiplyScalar(0.25);
        if (this.timer <= 0) {
          this.state = 'strike';
          this.timer = 0.12;
        }
        break;
      }
      case 'strike': {
        this.timer -= dt;
        desired.copy(toTarget).multiplyScalar(0.8);
        if (!this.struck) {
          this.struck = true;
          if (dist < this.def.reach + 0.35) damageDealt = this.def.damage;
        }
        if (this.timer <= 0) {
          this.state = 'recover';
          this.timer = this.def.recover;
        }
        break;
      }
      case 'recover': {
        this.timer -= dt;
        if (this.timer <= 0) this.state = 'chase';
        break;
      }
    }

    // Separation, so a pack reads as a crowd rather than one enemy wearing
    // five hats.
    for (const o of others) {
      if (o === this || !o.alive) continue;
      const dx = this.position.x - o.position.x;
      const dz = this.position.z - o.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1.6 * 1.6 || d2 < 1e-5) continue;
      const d = Math.sqrt(d2);
      desired.x += (dx / d) * (1 - d / 1.6) * 1.4;
      desired.z += (dz / d) * (1 - d / 1.6) * 1.4;
    }

    if (desired.lengthSq() > 1) desired.normalize();
    const speed = this.def.speed * (this.stagger > 0 ? 0.15 : 1);
    this.velocity.x += (desired.x * speed - this.velocity.x) * Math.min(1, 9 * dt);
    this.velocity.z += (desired.z * speed - this.velocity.z) * Math.min(1, 9 * dt);

    const before = this.position.clone();
    this.position.addScaledVector(this.velocity, dt);
    this.position.x = Math.max(bounds.minX, Math.min(bounds.maxX, this.position.x));
    this.position.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, this.position.z));
    const blocked = resolveCircle(this.position, this.def.hitRadius * 0.8, colliders);

    if (blocked && this.unstick <= 0) {
      const moved = this.position.distanceTo(before);
      if (moved < speed * dt * 0.4) {
        this.unstick = 0.85;
        this.unstickSign = Math.random() < 0.5 ? -1 : 1;
      }
    }

    if (toTarget.lengthSq() > 0.001) {
      const want = Math.atan2(toTarget.x, toTarget.z);
      let delta = want - this.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.yaw += delta * Math.min(1, 8 * dt);
    }

    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;

    const moveSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.walkPhase += moveSpeed * dt * 2.8;
    walkCycle(this.body, this.walkPhase, Math.min(0.8, moveSpeed * 0.16));

    // Arms telegraph the attack: raised through the wind-up, slammed down on
    // the strike. On a phone screen this is the only warning the player gets.
    const raise =
      this.state === 'windup'
        ? 1 - this.timer / this.def.telegraph
        : this.state === 'strike'
          ? 1 - this.timer / 0.12
          : 0;
    const swing = this.state === 'strike' ? -2.4 * (1 - this.timer / 0.12) : raise * 2.0;
    this.body.armL.rotation.x = -swing;
    this.body.armR.rotation.x = -swing;

    return damageDealt;
  }
}

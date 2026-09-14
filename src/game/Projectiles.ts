import {
  Box3,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';
import { SHARED_BOX } from './models';
import { pointInBoxes, segmentHitsSphere } from './physics';
import type { Supply } from './supplies';

const POOL = 64;
const PREVIEW_DOTS = 26;
const PREVIEW_STEP = 0.042;

export interface HitTarget {
  position: Vector3;
  /** Centre of the hit sphere, measured up from the feet. */
  hitHeight: number;
  hitRadius: number;
  alive: boolean;
  onHit(damage: number, knockback: Vector3, impact: number): void;
}

/**
 * Launch velocity for a supply at a given wind-up.
 *
 * Shared by the aim preview and the real throw. If these two ever drift apart
 * the arc line becomes a liar and the whole mechanic stops being trustworthy,
 * so there is exactly one implementation.
 */
export function launchVelocity(dir: Vector3, power: number, s: Supply, out: Vector3): Vector3 {
  const speed = s.speedMin + (s.speedMax - s.speedMin) * power;
  out.set(dir.x, 0, dir.z).normalize().multiplyScalar(speed);
  out.y = s.liftMin + (s.liftMax - s.liftMin) * power;
  return out;
}

interface Live {
  mesh: Mesh;
  vel: Vector3;
  prev: Vector3;
  spin: Vector3;
  supply: Supply;
  life: number;
  bounces: number;
  active: boolean;
}

export class Projectiles {
  readonly group = new Group();
  private readonly pool: Live[] = [];
  private readonly materials = new Map<string, MeshBasicMaterial>();

  constructor() {
    for (let i = 0; i < POOL; i++) {
      const mesh = new Mesh(SHARED_BOX, new MeshBasicMaterial({ color: 0xffffff }));
      mesh.visible = false;
      this.group.add(mesh);
      this.pool.push({
        mesh,
        vel: new Vector3(),
        prev: new Vector3(),
        spin: new Vector3(),
        supply: null as unknown as Supply,
        life: 0,
        bounces: 0,
        active: false,
      });
    }
  }

  private materialFor(s: Supply) {
    let m = this.materials.get(s.id);
    if (!m) {
      m = new MeshBasicMaterial({ color: s.color });
      this.materials.set(s.id, m);
    }
    return m;
  }

  spawn(origin: Vector3, dir: Vector3, power: number, supply: Supply) {
    const p = this.pool.find((x) => !x.active);
    if (!p) return;

    p.active = true;
    p.supply = supply;
    p.life = 4;
    p.bounces = supply.bounces;
    p.prev.copy(origin);
    launchVelocity(dir, power, supply, p.vel);

    p.mesh.material = this.materialFor(supply);
    p.mesh.position.copy(origin);
    p.mesh.scale.set(...supply.size);
    p.mesh.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
    p.mesh.visible = true;
    p.spin.set(Math.random() * 18 + 6, Math.random() * 6, Math.random() * 18 + 6);
  }

  update(dt: number, colliders: Box3[], targets: HitTarget[], onImpact: (p: Vector3, s: Supply) => void) {
    for (const p of this.pool) {
      if (!p.active) continue;

      p.life -= dt;
      p.prev.copy(p.mesh.position);
      p.vel.y -= p.supply.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.z += p.spin.z * dt;

      let consumed = false;

      // Swept test first: fast projectiles skip straight through a body in a
      // single frame if you only test the end point.
      for (const t of targets) {
        if (!t.alive) continue;
        const centre = t.position.clone();
        centre.y += t.hitHeight;
        if (!segmentHitsSphere(p.prev, p.mesh.position, centre, t.hitRadius + p.supply.radius)) {
          continue;
        }
        const kb = p.vel.clone().setY(0).normalize().multiplyScalar(p.supply.knockback);
        t.onHit(p.supply.damage, kb, p.supply.impact);
        onImpact(p.mesh.position.clone(), p.supply);
        consumed = true;
        break;
      }

      if (!consumed) {
        const hitFloor = p.mesh.position.y <= p.supply.radius;
        const hitWall = pointInBoxes(p.mesh.position, colliders);
        if (hitFloor || hitWall) {
          if (p.bounces > 0) {
            p.bounces--;
            if (hitFloor) {
              p.mesh.position.y = p.supply.radius;
              p.vel.y = Math.abs(p.vel.y) * 0.42;
            } else {
              // Cheap but readable: reverse the dominant horizontal axis.
              if (Math.abs(p.vel.x) > Math.abs(p.vel.z)) p.vel.x *= -0.45;
              else p.vel.z *= -0.45;
              p.mesh.position.copy(p.prev);
            }
            p.vel.x *= 0.7;
            p.vel.z *= 0.7;
            onImpact(p.mesh.position.clone(), p.supply);
          } else {
            onImpact(p.mesh.position.clone(), p.supply);
            consumed = true;
          }
        }
      }

      if (consumed || p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
      }
    }
  }
}

/**
 * The dotted arc shown while winding up.
 *
 * Simulated with the same integrator the projectile uses, at a coarser step —
 * so what you see is genuinely where the thing goes, not an idealised parabola
 * that ignores the desk in front of you.
 */
export class AimArc {
  readonly mesh: InstancedMesh;
  private readonly dummy = new Object3D();
  private readonly pos = new Vector3();
  private readonly vel = new Vector3();
  private readonly colour = new Color();

  constructor() {
    const mat = new MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.95 });
    this.mesh = new InstancedMesh(SHARED_BOX, mat, PREVIEW_DOTS);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.count = 0;
  }

  hide() {
    this.mesh.visible = false;
  }

  /** Returns the predicted landing point, for the ground reticle. */
  update(
    origin: Vector3,
    dir: Vector3,
    power: number,
    supply: Supply,
    colliders: Box3[],
    accent: number,
  ): Vector3 {
    this.pos.copy(origin);
    launchVelocity(dir, power, supply, this.vel);

    const base = new Color(supply.color);
    const hot = new Color(accent);
    let n = 0;

    for (let i = 0; i < PREVIEW_DOTS; i++) {
      this.vel.y -= supply.gravity * PREVIEW_STEP;
      this.pos.addScaledVector(this.vel, PREVIEW_STEP);

      if (this.pos.y <= 0.04 || pointInBoxes(this.pos, colliders)) break;

      const t = i / PREVIEW_DOTS;
      // Dots shrink and warm toward the end so the eye reads direction of travel.
      const s = 0.13 * (1 - t * 0.55);
      this.dummy.position.copy(this.pos);
      this.dummy.scale.setScalar(s);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      this.mesh.setColorAt(n, this.colour.copy(base).lerp(hot, t));
      n++;
    }

    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return this.pos;
  }
}

/** Chunky impact sparks. One pooled Points cloud for the whole game. */
export class Sparks {
  readonly points: Points;
  private readonly vel: Vector3[] = [];
  private readonly life: Float32Array;
  private readonly positions: Float32Array;
  private readonly max = 220;
  private cursor = 0;

  constructor() {
    this.positions = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    for (let i = 0; i < this.max; i++) {
      this.vel.push(new Vector3());
      this.positions[i * 3 + 1] = -999;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    this.points = new Points(
      geo,
      new PointsMaterial({ size: 0.16, color: 0xffffff, fog: true, sizeAttenuation: true }),
    );
    this.points.frustumCulled = false;
  }

  burst(at: Vector3, count: number, speed: number) {
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.positions[idx * 3] = at.x;
      this.positions[idx * 3 + 1] = at.y;
      this.positions[idx * 3 + 2] = at.z;
      this.vel[idx]
        .set(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(speed * (0.5 + Math.random()));
      this.life[idx] = 0.45 + Math.random() * 0.35;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i].y -= 22 * dt;
      this.positions[i * 3] += this.vel[i].x * dt;
      this.positions[i * 3 + 1] += this.vel[i].y * dt;
      this.positions[i * 3 + 2] += this.vel[i].z * dt;
      if (this.life[i] <= 0) this.positions[i * 3 + 1] = -999;
    }
    (this.points.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
  }
}

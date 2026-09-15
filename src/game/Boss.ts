import { Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { humanoid, walkCycle, box, type Humanoid } from './models';
import { ps1Material } from '../render/ps1';
import { resolveCircle } from './physics';
import type { HitTarget } from './Projectiles';
import { Box3 } from 'three';

/** Everything the boss needs the game to do on its behalf. */
export interface BossHooks {
  spawnAdds(count: number, around: Vector3): void;
  addsRemaining(): number;
  fireMemo(from: Vector3, dir: Vector3): void;
  telegraph(at: Vector3, radius: number, duration: number): void;
  detonate(at: Vector3, radius: number, damage: number): void;
  say(text: string, seconds?: number): void;
  punch(strength: number, color?: number): void;
  sparks(at: Vector3, count: number, speed: number): void;
}

const PREFERRED_RANGE = 7.5;
const SPEED = 2.1;

/** Fractions of max HP at which it insists on taking this offline. */
const SHIELD_THRESHOLDS = [0.7, 0.35];

const INVITE_RADIUS = 3.4;
const INVITE_TELEGRAPH = 1.6;
const INVITE_DAMAGE = 22;

type State = 'approach' | 'agenda' | 'invite' | 'offline' | 'dead';

/**
 * THE QUICK SYNC — a meeting that could have been an email.
 *
 * Every ability is the same joke told mechanically. It books time in your
 * calendar whether you're free or not (a timed AoE under your feet), it
 * forwards you paperwork (a fan of memos), and when cornered it insists on
 * taking things offline — going invulnerable behind a ring of attendees you
 * have to clear before anyone can get back to the actual point.
 */
export class Boss implements HitTarget {
  readonly root = new Group();
  readonly position = new Vector3();
  readonly name = 'THE QUICK SYNC';

  readonly hitRadius = 1.0;
  readonly hitHeight = 1.8;

  maxHp: number;
  hp: number;
  alive = true;
  removable = false;

  /** Invulnerable while presenting. */
  shielded = false;

  private readonly body: Humanoid;
  private readonly shield: Mesh;
  private readonly skins: Array<{ mesh: Mesh; material: Mesh['material'] }> = [];

  private state: State = 'approach';
  private yaw = Math.PI;
  private walkPhase = 0;
  private flash = 0;

  private actionT = 0;
  private stage = 0;
  private nextAgenda = 2.4;
  private nextInvite = 4.5;

  private offlineTimer = 0;
  private thresholds = [...SHIELD_THRESHOLDS];

  private phase2 = false;
  private circleTimer = 6;
  private history: Vector3[] = [];
  private historyTick = 0;

  private deathT = 0;

  /** Wall-following, so the conference table can't pin it in place. */
  private unstick = 0;
  private unstickSign = 1;

  constructor(floorNumber: number) {
    // Scales with the building, so floor 25's sync meeting is worse than
    // floor 5's. It always is.
    this.maxHp = 620 + floorNumber * 38;
    this.hp = this.maxHp;

    this.body = humanoid(
      { skin: 0xc49a70, shirt: 0x2b3550, trousers: 0x1d2330, hair: 0x4a4038 },
      1.55,
    );
    this.root.add(this.body.root);

    // A tie, because the silhouette needs one thing that isn't a drone's.
    this.body.torso.add(box(ps1Material(0xa8322a), 0.1, 0.5, 0.06, 0, -0.08, 0.2));

    this.shield = box(
      new MeshBasicMaterial({
        color: 0x7fd8ff,
        fog: false,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
      2.6,
      3.4,
      2.6,
      0,
      1.7,
      0,
    );
    this.shield.visible = false;
    this.shield.renderOrder = 3;
    this.root.add(this.shield);

    this.root.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m !== this.shield) this.skins.push({ mesh: m, material: m.material });
    });
  }

  spawnAt(p: Vector3) {
    this.position.copy(p);
    this.root.position.copy(p);
    for (let i = 0; i < 24; i++) this.history.push(p.clone());
  }

  onHit(damage: number, _knockback: Vector3, _impact: number) {
    if (!this.alive) return;
    if (this.shielded) {
      // Hitting the shield should feel like hitting a wall, not like whiffing.
      this.flash = 0.06;
      return;
    }
    this.hp -= damage;
    this.flash = 0.08;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.state = 'dead';
      this.deathT = 0;
    }
  }

  private startOffline(hooks: BossHooks) {
    this.shielded = true;
    this.state = 'offline';
    this.offlineTimer = 20;
    this.shield.visible = true;
    hooks.say("LET'S TAKE THIS OFFLINE", 2.4);
    hooks.spawnAdds(this.phase2 ? 5 : 4, this.position);
    hooks.punch(0.4, 0x7fd8ff);
  }

  private endOffline(hooks: BossHooks) {
    this.shielded = false;
    this.shield.visible = false;
    this.state = 'approach';
    this.nextAgenda = 1.2;
    this.nextInvite = 2.6;
    hooks.say('CIRCLING BACK TO THE AGENDA', 1.8);
  }

  update(
    dt: number,
    target: Vector3,
    hooks: BossHooks,
    colliders: Box3[],
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  ) {
    if (this.flash > 0) {
      this.flash -= dt;
      const hot = this.flash > 0;
      for (const s of this.skins) s.mesh.material = hot ? HIT_MATERIAL : s.material;
    }

    if (this.state === 'dead') {
      this.deathT += dt;
      const t = Math.min(1, this.deathT / 1.6);
      this.root.rotation.x = -t * 1.5;
      this.root.position.y = -t * t * 2.0;
      this.shield.visible = false;
      if (this.deathT > 2.2) this.removable = true;
      return;
    }

    const toTarget = new Vector3().subVectors(target, this.position).setY(0);
    const dist = toTarget.length();
    if (dist > 0.001) toTarget.divideScalar(dist);

    // Position history feeds CIRCLE BACK: it rewinds to roughly where it stood
    // four seconds ago, which invalidates whatever lead you were aiming.
    this.historyTick += dt;
    if (this.historyTick > 0.18) {
      this.historyTick = 0;
      this.history.push(this.position.clone());
      if (this.history.length > 24) this.history.shift();
    }

    if (!this.phase2 && this.hp <= this.maxHp * 0.5) {
      this.phase2 = true;
      this.circleTimer = 4.5;
      hooks.say('PER MY LAST EMAIL', 2);
      hooks.punch(0.5, 0xffffff);
    }

    if (!this.shielded && this.thresholds.length && this.hp <= this.maxHp * this.thresholds[0]) {
      this.thresholds.shift();
      this.startOffline(hooks);
    }

    let move = new Vector3();
    // Set by any state that poses the arms, so the walk cycle below leaves
    // the telegraph alone.
    let posingArms = false;

    if (this.shielded) {
      this.offlineTimer -= dt;
      if (this.offlineTimer <= 0 || hooks.addsRemaining() === 0) this.endOffline(hooks);
      // Presenting: stands still, both arms up, entirely pleased with itself.
      posingArms = true;
      this.body.armL.rotation.x = -2.2;
      this.body.armR.rotation.x = -2.2;
      const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.04;
      this.shield.scale.setScalar(pulse);
    } else {
      if (this.phase2) {
        this.circleTimer -= dt;
        if (this.circleTimer <= 0) {
          this.circleTimer = 5.5;
          const back = this.history[0];
          if (back) {
            hooks.sparks(this.position.clone().setY(1.2), 16, 5);
            this.position.copy(back);
            hooks.sparks(this.position.clone().setY(1.2), 16, 5);
            hooks.say('CIRCLING BACK', 1.1);
          }
        }
      }

      switch (this.state) {
        case 'approach': {
          this.nextAgenda -= dt;
          this.nextInvite -= dt;
          if (this.nextInvite <= 0) {
            this.state = 'invite';
            this.actionT = 0;
            this.stage = 0;
          } else if (this.nextAgenda <= 0) {
            // Deliberately ungated on range: the memo fan is its long-distance
            // tool, so being far away is a reason to use it, not to hold it.
            this.state = 'agenda';
            this.actionT = 0;
            this.stage = 0;
          } else {
            // Holds a working distance: close enough to threaten, far enough
            // that you have to commit to a throw rather than flail.
            if (dist > PREFERRED_RANGE + 1.5) move.copy(toTarget);
            else if (dist < PREFERRED_RANGE - 1.5) move.copy(toTarget).multiplyScalar(-0.7);
            posingArms = false;
          }
          break;
        }

        case 'agenda': {
          this.actionT += dt;
          posingArms = true;
          const wind = Math.min(1, this.actionT / 0.65);
          this.body.armR.rotation.x = -wind * 2.4;
          this.body.armL.rotation.x = -wind * 1.2;

          if (this.stage === 0 && this.actionT >= 0.65) {
            this.stage = 1;
            // A fan of three: the middle one punishes standing still, the
            // outer two punish lazy strafing.
            for (const spread of [-0.28, 0, 0.28]) {
              const dir = new Vector3(
                toTarget.x * Math.cos(spread) - toTarget.z * Math.sin(spread),
                0,
                toTarget.x * Math.sin(spread) + toTarget.z * Math.cos(spread),
              );
              hooks.fireMemo(
                new Vector3(this.position.x, this.position.y + 1.9, this.position.z),
                dir,
              );
            }
          }
          if (this.actionT >= 1.25) {
            this.state = 'approach';
            this.nextAgenda = this.phase2 ? 2.4 : 3.6;
          }
          break;
        }

        case 'invite': {
          this.actionT += dt;
          if (this.stage === 0) {
            this.stage = 1;
            // Booked at your current position — standing still is the mistake.
            this.pending.copy(target);
            hooks.telegraph(this.pending, INVITE_RADIUS, INVITE_TELEGRAPH);
            hooks.say('QUICK SYNC?', 1.1);
          }
          posingArms = true;
          this.body.armL.rotation.x = -1.6;
          this.body.armR.rotation.x = -1.6;
          if (this.stage === 1 && this.actionT >= INVITE_TELEGRAPH) {
            this.stage = 2;
            hooks.detonate(this.pending, INVITE_RADIUS, INVITE_DAMAGE);
            hooks.spawnAdds(2, this.pending);
            hooks.punch(0.35, 0xff5a3c);
          }
          if (this.actionT >= INVITE_TELEGRAPH + 0.6) {
            this.state = 'approach';
            this.nextInvite = this.phase2 ? 4.5 : 6.5;
          }
          break;
        }
      }
    }

    if (move.lengthSq() > 1) move.normalize();

    this.unstick = Math.max(0, this.unstick - dt);
    if (this.unstick > 0 && move.lengthSq() > 0.001) {
      const a = this.unstickSign * 1.2;
      move.set(
        move.x * Math.cos(a) - move.z * Math.sin(a),
        0,
        move.x * Math.sin(a) + move.z * Math.cos(a),
      );
    }

    const before = this.position.clone();
    this.position.addScaledVector(move, SPEED * dt);
    this.position.x = Math.max(bounds.minX, Math.min(bounds.maxX, this.position.x));
    this.position.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, this.position.z));
    const blocked = resolveCircle(this.position, this.hitRadius, colliders);

    if (blocked && this.unstick <= 0 && move.lengthSq() > 0.001) {
      // Barely moved despite trying: pick a side and slide along the obstacle.
      if (this.position.distanceTo(before) < SPEED * dt * 0.4) {
        this.unstick = 1.1;
        this.unstickSign = Math.random() < 0.5 ? -1 : 1;
      }
    }

    if (dist > 0.001) {
      const want = Math.atan2(toTarget.x, toTarget.z);
      let delta = want - this.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.yaw += delta * Math.min(1, 6 * dt);
    }

    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;

    const speed = move.length() * SPEED;
    this.walkPhase += speed * dt * 2.4;
    walkCycle(this.body, this.walkPhase, Math.min(0.6, speed * 0.2), !posingArms);
  }

  private readonly pending = new Vector3();
}

const HIT_MATERIAL = new MeshBasicMaterial({ color: 0xffffff, fog: false });

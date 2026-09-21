import { Group, Mesh, MeshBasicMaterial, Vector2, Vector3 } from 'three';
import { Engine } from '../core/Engine';
import { Input } from '../core/Input';
import { Time } from '../core/Time';
import { loadSettings, saveSettings, type Settings } from '../core/settings';
import { Hud } from '../ui/hud';
import { bandForFloor } from '../render/palette';
import { SHARED_BOX } from './models';
import { Floor } from './Floor';
import { Player, screenToWorld } from './Player';
import { Enemy, ENEMIES, type EnemyKind } from './Enemy';
import { Boss, type BossHooks } from './Boss';
import { Telegraphs } from './Telegraph';
import { AimArc, Projectiles, Sparks, type HitTarget } from './Projectiles';
import { HAZARDS } from './supplies';

/** Draw-call budget: every humanoid is ~11 meshes, and phones are not kind. */
const MAX_ALIVE = 12;
const SPAWN_INTERVAL = 0.45;
const WAVES_PER_FLOOR = 3;

/** Every fifth floor is a review. */
const BOSS_EVERY = 5;

/**
 * Over-the-shoulder, pitched down about 17 degrees.
 *
 * A portrait viewport wants depth, not headroom: pitching down fills the tall
 * screen with the floor you're about to fight across and leaves the ceiling
 * and window band as a bright strip along the top.
 */
const CAM_DIST = 7.4;
const CAM_HEIGHT = 4.0;
const CAM_LOOK_HEIGHT = 1.0;
const CAM_LOOK_AHEAD = 4.5;

/** How fast the camera eases toward its resting yaw, in units per second. */
const CAM_TURN_RATE = 4.5;

/** Auto-advance: cruise fraction of the player's top speed. */
const ADVANCE_CRUISE = 0.82;
/** Auto-advance: steering rate at full stick, radians per second. */
const ADVANCE_TURN = 2.8;
/**
 * Auto-advance: how hard winding up plants your feet.
 *
 * Stacks on top of the player's own aim multiplier, so a wind-up brings you
 * to very nearly a stop. Throwing should be a decision to stand still, not
 * something you drift through.
 */
const ADVANCE_AIM_PLANT = 0.25;

/** Shortest signed angle from an arbitrary delta. */
function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Seconds for one pass of the attract dolly behind the title screen. */
const ATTRACT_PERIOD = 34;

type State = 'title' | 'playing' | 'cleared' | 'dead';

interface Pickup {
  mesh: Mesh;
  taken: boolean;
  spin: number;
}

export function isBossFloor(n: number) {
  return n % BOSS_EVERY === 0;
}

export class Game {
  private readonly engine: Engine;
  private readonly input: Input;
  private readonly time = new Time();
  private readonly hud: Hud;
  private readonly settings: Settings;

  private readonly player = new Player();
  private readonly projectiles = new Projectiles();
  /** A second pool for things thrown *at* the player. */
  private readonly hazards = new Projectiles();
  private readonly arc = new AimArc();
  private readonly sparks = new Sparks();
  private readonly telegraphs = new Telegraphs();
  private readonly pickupGroup = new Group();

  private floor!: Floor;
  private enemies: Enemy[] = [];
  private boss: Boss | null = null;
  private pickups: Pickup[] = [];

  private state: State = 'title';
  private floorNumber = 1;
  private waveIndex = 0;
  private spawnQueue: EnemyKind[] = [];
  private spawnTimer = 0;
  private waveBreak = 0;
  private bossIntro = 0;

  private camYaw = 0;
  /**
   * Where the camera is easing to.
   *
   * Stored as an absolute yaw, which is the whole point: the previous version
   * recomputed the target every frame from the aim stick, and because a
   * screen-relative aim resolves to `camYaw + thumbAngle`, the target ran away
   * from the camera exactly as fast as the camera chased it. It never
   * converged — a motionless thumb spun the camera indefinitely.
   */
  private camTargetYaw = 0;
  private camShake = 0;
  private attractT = 0;

  /**
   * Auto-advance heading, in world space.
   *
   * Integrated from the raw stick rather than derived from the camera, which
   * is exactly why the camera is allowed to chase it: the target owes nothing
   * to camYaw, so it converges instead of running away.
   */
  private advanceYaw = Math.PI;

  private readonly worldMove = new Vector3();
  private readonly worldAim = new Vector3();
  private readonly playerTargets: HitTarget[] = [];

  /** `?debug=1` parks the camera above the floor to inspect the layout. */
  private readonly debugCam = new URLSearchParams(location.search).has('debug');

  private readonly bossHooks: BossHooks = {
    spawnAdds: (count, around) => {
      for (let i = 0; i < count; i++) {
        if (this.aliveCount() >= MAX_ALIVE) break;
        const angle = (i / count) * Math.PI * 2 + Math.random();
        const at = new Vector3(
          around.x + Math.cos(angle) * 4.5,
          0,
          around.z + Math.sin(angle) * 4.5,
        );
        this.spawnAt(i % 2 === 0 ? 'intern' : 'drone', at);
      }
    },
    addsRemaining: () => this.aliveCount(),
    fireMemo: (from, dir) => this.hazards.spawn(from, dir, 1, HAZARDS.memo),
    telegraph: (at, radius, duration) => this.telegraphs.add(at, radius, duration),
    detonate: (at, radius, damage) => {
      this.sparks.burst(new Vector3(at.x, 0.4, at.z), 22, 7);
      const dx = this.player.position.x - at.x;
      const dz = this.player.position.z - at.z;
      if (dx * dx + dz * dz <= radius * radius) this.player.damage(damage);
    },
    say: (text, seconds) => this.hud.say(text, seconds),
    punch: (strength, color) => this.engine.punch(strength, color),
    sparks: (at, count, speed) => this.sparks.burst(at, count, speed),
  };

  constructor(canvas: HTMLCanvasElement, hudHost: HTMLElement) {
    this.settings = loadSettings();
    this.engine = new Engine(canvas);
    this.input = new Input(canvas, this.settings);
    this.hud = new Hud(hudHost);

    this.engine.scene.add(this.player.root);
    this.engine.scene.add(this.projectiles.group);
    this.engine.scene.add(this.hazards.group);
    this.engine.scene.add(this.arc.mesh);
    this.engine.scene.add(this.sparks.points);
    this.engine.scene.add(this.telegraphs.group);
    this.engine.scene.add(this.pickupGroup);

    this.playerTargets.push(this.player);
    this.player.onDamaged = () => {
      this.engine.punch(0.45, 0xc8402e, 5);
      this.camShake = 0.5;
      this.hud.setHealth(this.player.health, this.player.maxHealth);
      if (!this.player.alive) this.die();
    };

    this.hud.onSwap = () => {
      this.player.cycleSlot();
      this.refreshSupplyHud();
    };
    this.hud.onStart = () => this.start();
    this.hud.onRestart = () => this.start();
    this.hud.onMenu = () => this.toTitle();
    this.hud.onSetting = (key, value) => {
      // The settings object is shared by reference with Input, so handedness
      // and thumb reach take effect the instant the control moves.
      (this.settings[key] as Settings[typeof key]) = value;
      saveSettings(this.settings);
    };

    this.toTitle();
  }

  // --- lifecycle --------------------------------------------------------

  private toTitle() {
    this.state = 'title';
    this.attractT = 0;
    this.boss?.root.removeFromParent();
    this.boss = null;
    this.floorNumber = 1;
    this.buildFloor(1);
    this.player.root.visible = false;
    this.arc.hide();
    this.hud.setChromeVisible(false);
    this.hud.setBoss(null);
    this.hud.showTitle(this.settings);
  }

  private start() {
    this.hud.hideScreen();
    this.hud.setChromeVisible(true);
    this.player.root.visible = true;
    this.floorNumber = 1;
    this.player.health = this.player.maxHealth;
    this.player.alive = true;
    this.player.invuln = 0;
    this.player.slots.forEach((s) => {
      if (!s.supply.infinite) s.count = 6;
    });
    this.player.slotIndex = 0;
    this.buildFloor(1);
    this.state = 'playing';
  }

  private buildFloor(n: number) {
    this.floor?.dispose();
    for (const e of this.enemies) e.root.removeFromParent();
    this.enemies = [];
    this.boss?.root.removeFromParent();
    this.boss = null;
    this.telegraphs.clear();
    this.hud.setBoss(null);

    const palette = bandForFloor(n);
    const boss = isBossFloor(n);
    this.floor = new Floor(n, palette, boss ? 'boardroom' : 'office');
    this.engine.scene.add(this.floor.group);
    this.engine.applyPalette(palette);
    this.floor.setDoors(0);

    this.player.spawnAt(this.floor.playerSpawn);
    this.player.yaw = Math.PI; // start facing up the room, toward the elevator
    this.camYaw = Math.PI;
    this.camTargetYaw = Math.PI;
    this.advanceYaw = Math.PI;

    this.buildPickups(palette.accent);

    this.waveIndex = 0;
    this.spawnQueue = [];
    this.waveBreak = boss ? 0 : 1.4;
    this.bossIntro = boss ? 2.2 : 0;
    this.hud.setFloor(n, palette.name);
    this.hud.setWave(boss ? 'PERFORMANCE REVIEW' : '');
    this.refreshSupplyHud();
    this.hud.setHealth(this.player.health, this.player.maxHealth);
  }

  private buildPickups(accent: number) {
    for (const p of this.pickups) p.mesh.removeFromParent();
    this.pickups = [];
    const mat = new MeshBasicMaterial({ color: accent, fog: false });
    for (const point of this.floor.supplyPoints) {
      const mesh = new Mesh(SHARED_BOX, mat);
      mesh.scale.set(0.34, 0.34, 0.34);
      mesh.position.copy(point);
      this.pickupGroup.add(mesh);
      this.pickups.push({ mesh, taken: false, spin: Math.random() * 6 });
    }
  }

  private refreshSupplyHud() {
    this.hud.setSupply(this.player.supply.name, this.player.ammo);
  }

  private die() {
    this.state = 'dead';
    this.engine.punch(0.85, 0xc8402e, 1.6);
    this.time.setScale(1);
    this.arc.hide();

    const isBest = this.floorNumber > this.settings.bestFloor;
    if (isBest) {
      this.settings.bestFloor = this.floorNumber;
      saveSettings(this.settings);
    }
    this.hud.showGameOver(this.floorNumber, this.settings, isBest);
  }

  // --- spawning ---------------------------------------------------------

  private spawnAt(kind: EnemyKind, at: Vector3) {
    const e = new Enemy(ENEMIES[kind]);
    e.spawnAt(
      new Vector3(
        Math.max(this.floor.minX, Math.min(this.floor.maxX, at.x)),
        0,
        Math.max(this.floor.minZ, Math.min(this.floor.maxZ, at.z)),
      ),
    );
    this.engine.scene.add(e.root);
    this.enemies.push(e);
    this.sparks.burst(new Vector3(e.position.x, 0.6, e.position.z), 6, 3);
  }

  private spawnOne(kind: EnemyKind) {
    // Spawn out of the player's immediate space so nothing lands in their lap.
    const candidates = this.floor.spawnPoints
      .map((p) => ({ p, d: p.distanceTo(this.player.position) }))
      .filter((c) => c.d > 9)
      .sort((a, b) => a.d - b.d);
    const pick = candidates.length
      ? candidates[Math.floor(Math.random() * Math.min(5, candidates.length))].p
      : this.floor.spawnPoints[0];
    this.spawnAt(kind, new Vector3(pick.x + (Math.random() - 0.5) * 3, 0, pick.z + (Math.random() - 0.5) * 3));
  }

  private aliveCount() {
    return this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
  }

  private queueWave() {
    const scale = 1 + (this.floorNumber - 1) * 0.18;
    const drones = Math.max(1, Math.round((3 + this.waveIndex) * scale));
    const interns = Math.round(this.waveIndex * 1.5 * scale);

    this.spawnQueue = [];
    for (let i = 0; i < drones; i++) this.spawnQueue.push('drone');
    for (let i = 0; i < interns; i++) this.spawnQueue.push('intern');
    // Shuffle so the pack arrives mixed rather than in neat blocks.
    for (let i = this.spawnQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.spawnQueue[i], this.spawnQueue[j]] = [this.spawnQueue[j], this.spawnQueue[i]];
    }
    this.hud.setWave(`WAVE ${this.waveIndex + 1} / ${WAVES_PER_FLOOR}`);
  }

  private clearFloor(message: string) {
    this.state = 'cleared';
    this.hud.setWave('FLOOR CLEARED');
    this.hud.say(message, 2.4);
    this.engine.punch(0.3, 0xffffff, 3);
  }

  private updateWaves(dt: number) {
    if (this.state !== 'playing') return;

    if (isBossFloor(this.floorNumber)) {
      if (this.bossIntro > 0) {
        this.bossIntro -= dt;
        if (this.bossIntro <= 0) {
          this.boss = new Boss(this.floorNumber);
          this.boss.spawnAt(new Vector3(0, 0, -this.floor.maxZ * 0.55));
          this.engine.scene.add(this.boss.root);
          this.hud.say('THE QUICK SYNC', 2.6);
          this.engine.punch(0.4, 0xffffff, 2.5);
        }
        return;
      }
      if (this.boss && !this.boss.alive && this.boss.removable) {
        this.boss.root.removeFromParent();
        this.boss = null;
        this.hud.setBoss(null);
        this.clearFloor('THE MEETING IS OVER');
      }
      return;
    }

    if (this.waveBreak > 0) {
      this.waveBreak -= dt;
      if (this.waveBreak <= 0) this.queueWave();
      return;
    }

    if (this.spawnQueue.length > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.aliveCount() < MAX_ALIVE) {
        this.spawnOne(this.spawnQueue.pop()!);
        this.spawnTimer = SPAWN_INTERVAL;
      }
      return;
    }

    if (this.aliveCount() > 0) return;

    this.waveIndex++;
    if (this.waveIndex >= WAVES_PER_FLOOR) {
      this.clearFloor('ELEVATOR UNLOCKED');
    } else {
      this.waveBreak = 2.2;
      this.hud.say(`WAVE ${this.waveIndex + 1}`, 1.2);
    }
  }

  // --- per-frame --------------------------------------------------------

  /**
   * Turn the raw stick into a world-space movement vector.
   *
   * Classic reads the stick as a direction relative to the camera. Auto-advance
   * reads it as a vehicle would: X steers, Y is a throttle that only ever
   * slows you down, and forward is the default state rather than something you
   * have to keep asking for.
   */
  private updateMoveIntent(dt: number, stick: Vector2, aiming: boolean) {
    if (this.settings.movement === 'classic') {
      screenToWorld(stick, this.camYaw, this.worldMove);
      return;
    }

    // Steering is locked during a wind-up. The body turns to face the throw,
    // so a heading change would be invisible until you released — and input
    // you cannot see the result of is input you cannot learn.
    if (!aiming) this.advanceYaw += stick.x * ADVANCE_TURN * dt;

    const throttle =
      Math.max(0, Math.min(1.35, 1 - stick.y * 1.6)) *
      ADVANCE_CRUISE *
      (aiming ? ADVANCE_AIM_PLANT : 1);

    this.worldMove
      .set(Math.sin(this.advanceYaw), 0, Math.cos(this.advanceYaw))
      .multiplyScalar(throttle);

    // Safe to chase continuously: advanceYaw is a world angle, not a
    // camera-relative one, so this converges.
    this.camTargetYaw = this.advanceYaw;
  }

  private handleThrow() {
    const s = this.input.state;
    if (!s.released || !this.player.alive) return;
    if (!this.player.canThrow()) return;

    screenToWorld(s.releaseDir, this.camYaw, this.worldAim);
    const supply = this.player.supply;
    this.projectiles.spawn(this.player.muzzle, this.worldAim, s.releasePower, supply);
    this.player.consume();
    this.refreshSupplyHud();
    this.camShake = Math.max(this.camShake, 0.12 + supply.impact * 0.3);

    // The camera reorients after you commit, never during the wind-up. Held
    // as an absolute target so it settles instead of chasing itself. In
    // auto-advance it is already following the heading, so leave it alone.
    if (this.settings.movement === 'classic') {
      const throwYaw = Math.atan2(this.worldAim.x, this.worldAim.z);
      this.camTargetYaw = this.camYaw + wrapAngle(throwYaw - this.camYaw) * this.settings.cameraTurn;
    }
  }

  private updateAttract(rawDt: number) {
    this.attractT += rawDt;
    const t = (this.attractT % ATTRACT_PERIOD) / ATTRACT_PERIOD;
    // A slow glide up the floor toward the lift, with a touch of drift so it
    // never reads as a still image.
    const z = this.floor.maxZ - t * (this.floor.maxZ - this.floor.minZ);
    const x = Math.sin(this.attractT * 0.21) * 2.2;
    const cam = this.engine.camera;
    cam.position.set(x, 2.7 + Math.sin(this.attractT * 0.13) * 0.25, z);
    cam.lookAt(x * 0.4, 1.7, z - 9);
  }

  private updateCamera(rawDt: number) {
    if (this.debugCam) {
      const cam = this.engine.camera;
      cam.position.set(0, 5.4, 21);
      cam.lookAt(0, 0.6, -10);
      return;
    }

    const s = this.input.state;

    // Absolutely still during a wind-up. Aiming is the one moment precision
    // matters, and a frame that rotates under you while you aim is precisely
    // what "fidgety" means. Movement never turns the camera either — a
    // camera that chases a camera-relative stick just orbits forever.
    if (!s.aiming) {
      this.camYaw += wrapAngle(this.camTargetYaw - this.camYaw) * Math.min(1, CAM_TURN_RATE * rawDt);
    }

    const sin = Math.sin(this.camYaw);
    const cos = Math.cos(this.camYaw);
    const p = this.player.position;

    this.camShake = Math.max(0, this.camShake - rawDt * 1.6);
    // A decaying wobble on fixed frequencies rather than fresh noise every
    // frame: per-frame Math.random() is white noise, and white noise reads as
    // jitter, not as impact.
    const amp = this.camShake * this.camShake * this.settings.shake * 0.6;
    const t = performance.now() * 0.001;
    const shakeX = Math.sin(t * 37.1) * amp;
    const shakeY = Math.sin(t * 28.7 + 1.7) * amp * 0.7;
    const shakeZ = Math.sin(t * 41.3 + 3.1) * amp;

    const cam = this.engine.camera;
    cam.position.set(
      p.x - sin * CAM_DIST + shakeX,
      CAM_HEIGHT + shakeY,
      p.z - cos * CAM_DIST + shakeZ,
    );
    // Keep the camera inside the shell so backing into a wall doesn't put the
    // lens in the stairwell.
    cam.position.x = Math.max(this.floor.minX, Math.min(this.floor.maxX, cam.position.x));
    cam.position.z = Math.max(this.floor.minZ, Math.min(this.floor.maxZ, cam.position.z));

    // Look at a point above and ahead of the player: tilts the view up the
    // tower and pushes the player into the lower third of a tall screen.
    cam.lookAt(p.x + sin * CAM_LOOK_AHEAD, CAM_LOOK_HEIGHT, p.z + cos * CAM_LOOK_AHEAD);
  }

  private updatePickups(dt: number) {
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      pk.spin += dt * 2.4;
      pk.mesh.rotation.set(pk.spin * 0.7, pk.spin, 0);
      pk.mesh.position.y = 0.9 + Math.sin(pk.spin * 1.6) * 0.12;

      if (pk.mesh.position.distanceTo(this.player.position) < 1.25) {
        pk.taken = true;
        pk.mesh.visible = false;
        this.player.give('stapler', 3);
        this.refreshSupplyHud();
        this.hud.say('+3 STAPLERS', 1);
        this.sparks.burst(pk.mesh.position, 12, 4);
      }
    }
  }

  private checkElevator() {
    if (this.state !== 'cleared') return;
    const open = Math.min(1, this.floor.doorsOpen + 0.02);
    this.floor.setDoors(open);
    if (open < 0.95) return;

    const p = this.player.position;
    if (Math.abs(p.x) < 2.0 && p.z < this.floor.elevator.z + 1.2) {
      this.floorNumber++;
      this.engine.punch(0.7, 0xffffff, 2.2);
      this.buildFloor(this.floorNumber);
      this.state = 'playing';
      this.hud.say(
        isBossFloor(this.floorNumber) ? 'PERFORMANCE REVIEW' : `FLOOR ${this.floorNumber}`,
        1.8,
      );
    }
  }

  private frame = () => {
    this.time.tick();
    const { dt, rawDt } = this.time;

    this.input.update(rawDt);
    const s = this.input.state;
    const playing = this.state === 'playing' || this.state === 'cleared';

    // Winding up a throw dilates time. Using rawDt for the camera below keeps
    // the view responsive while the world crawls, which is what makes the
    // slow-mo read as power rather than lag.
    this.time.setScale(playing && s.aiming && this.player.alive ? this.settings.slowmo : 1);

    if (playing) {
      screenToWorld(s.aimDir, this.camYaw, this.worldAim);
      this.updateMoveIntent(dt, s.move, s.aiming);

      this.player.update(
        dt,
        this.worldMove,
        s.aiming,
        s.aiming ? this.worldAim : null,
        this.floor.colliders,
        this.floor,
      );

      this.handleThrow();

      if (s.aiming && this.player.canThrow()) {
        this.arc.update(
          this.player.muzzle,
          this.worldAim,
          s.aimPower,
          this.player.supply,
          this.floor.colliders,
          bandForFloor(this.floorNumber).accent,
        );
      } else {
        this.arc.hide();
      }

      let incoming = 0;
      for (const e of this.enemies) {
        incoming += e.update(dt, this.player.position, this.enemies, this.floor.colliders, this.floor);
      }
      if (incoming > 0) this.player.damage(incoming);

      if (this.boss) {
        this.boss.update(dt, this.player.position, this.bossHooks, this.floor.colliders, this.floor);
        this.hud.setBoss(
          this.boss.name,
          this.boss.hp / this.boss.maxHp,
          this.boss.shielded && this.boss.alive,
        );
      }

      // One list so a thrown stapler can hit adds and the boss alike.
      const targets: HitTarget[] = this.boss ? [...this.enemies, this.boss] : this.enemies;
      this.projectiles.update(dt, this.floor.colliders, targets, (at, supply) => {
        this.sparks.burst(at, supply.impact > 0.2 ? 14 : 6, supply.impact > 0.2 ? 5 : 3);
        if (supply.impact > 0.2) this.camShake = Math.max(this.camShake, 0.2);
      });
      this.hazards.update(dt, this.floor.colliders, this.playerTargets, (at) => {
        this.sparks.burst(at, 5, 2.5);
      });

      this.enemies = this.enemies.filter((e) => {
        if (!e.removable) return true;
        e.root.removeFromParent();
        return false;
      });

      this.telegraphs.update(dt);
      this.updatePickups(dt);
      this.updateWaves(dt);
      this.checkElevator();
    }

    this.sparks.update(dt);
    if (this.state === 'title') this.updateAttract(rawDt);
    else this.updateCamera(rawDt);
    this.hud.update(rawDt);
    this.input.lateUpdate();
    this.engine.render(rawDt);

    requestAnimationFrame(this.frame);
  };

  /** Scene census, for eyeballing what actually got built. */
  stats() {
    let meshes = 0;
    this.engine.scene.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) meshes++;
    });
    return {
      state: this.state,
      movement: this.settings.movement,
      floor: this.floorNumber,
      meshes,
      colliders: this.floor.colliders.length,
      variant: this.floor.variant,
      pickups: this.pickups.length,
      enemies: this.enemies.length,
      boss: this.boss ? { hp: this.boss.hp, max: this.boss.maxHp, shielded: this.boss.shielded } : null,
      player: this.player.position.toArray().map((n) => +n.toFixed(1)),
    };
  }

  run() {
    requestAnimationFrame(this.frame);
  }
}

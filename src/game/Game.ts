import { Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { Engine } from '../core/Engine';
import { Input } from '../core/Input';
import { Time } from '../core/Time';
import { Hud } from '../ui/hud';
import { bandForFloor } from '../render/palette';
import { SHARED_BOX } from './models';
import { Floor } from './Floor';
import { Player, screenToWorld } from './Player';
import { Enemy, ENEMIES, type EnemyKind } from './Enemy';
import { AimArc, Projectiles, Sparks } from './Projectiles';

/** Draw-call budget: every humanoid is ~11 meshes, and phones are not kind. */
const MAX_ALIVE = 12;
const SPAWN_INTERVAL = 0.45;
const WAVES_PER_FLOOR = 3;
const SLOWMO = 0.3;

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

type State = 'title' | 'playing' | 'cleared' | 'dead';

interface Pickup {
  mesh: Mesh;
  taken: boolean;
  spin: number;
}

export class Game {
  private readonly engine: Engine;
  private readonly input: Input;
  private readonly time = new Time();
  private readonly hud: Hud;

  private readonly player = new Player();
  private readonly projectiles = new Projectiles();
  private readonly arc = new AimArc();
  private readonly sparks = new Sparks();
  private readonly pickupGroup = new Group();

  private floor!: Floor;
  private enemies: Enemy[] = [];
  private pickups: Pickup[] = [];

  private state: State = 'title';
  private floorNumber = 1;
  private waveIndex = 0;
  private spawnQueue: EnemyKind[] = [];
  private spawnTimer = 0;
  private waveBreak = 0;

  private camYaw = 0;
  private camShake = 0;
  private moveHeldFor = 0;

  private readonly worldMove = new Vector3();
  private readonly worldAim = new Vector3();

  /** `?debug=1` parks the camera above the floor to inspect the layout. */
  private readonly debugCam = new URLSearchParams(location.search).has('debug');

  constructor(canvas: HTMLCanvasElement, hudHost: HTMLElement) {
    this.engine = new Engine(canvas);
    this.input = new Input(canvas);
    this.hud = new Hud(hudHost);

    this.engine.scene.add(this.player.root);
    this.engine.scene.add(this.projectiles.group);
    this.engine.scene.add(this.arc.mesh);
    this.engine.scene.add(this.sparks.points);
    this.engine.scene.add(this.pickupGroup);

    this.hud.onSwap = () => {
      this.player.cycleSlot();
      this.refreshSupplyHud();
    };
    this.hud.onRestart = () => this.start();

    this.buildFloor(1);
    this.hud.showOverlay(
      'UPWARD&nbsp;MOBILITY',
      'LEFT THUMB — MOVE<br/>RIGHT THUMB — PULL BACK TO AIM, RELEASE TO THROW<br/><br/>TIME SLOWS WHILE YOU WIND UP.<br/>GET TO THE TOP.',
      'CLOCK IN',
    );
  }

  private start() {
    this.hud.hideOverlay();
    this.floorNumber = 1;
    this.player.health = this.player.maxHealth;
    this.player.alive = true;
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

    const palette = bandForFloor(n);
    this.floor = new Floor(n, palette);
    this.engine.scene.add(this.floor.group);
    this.engine.applyPalette(palette);
    this.floor.setDoors(0);

    this.player.spawnAt(this.floor.playerSpawn);
    this.player.yaw = Math.PI; // start facing up the room, toward the elevator
    this.camYaw = Math.PI;

    this.buildPickups(palette.accent);

    this.waveIndex = 0;
    this.spawnQueue = [];
    this.waveBreak = 1.4;
    this.hud.setFloor(n, palette.name);
    this.hud.setWave('');
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

  private spawnOne(kind: EnemyKind) {
    // Spawn out of the player's immediate space so nothing lands in their lap.
    const candidates = this.floor.spawnPoints
      .map((p) => ({ p, d: p.distanceTo(this.player.position) }))
      .filter((c) => c.d > 9)
      .sort((a, b) => a.d - b.d);
    const pick = candidates.length
      ? candidates[Math.floor(Math.random() * Math.min(5, candidates.length))].p
      : this.floor.spawnPoints[0];

    const e = new Enemy(ENEMIES[kind]);
    e.spawnAt(
      new Vector3(pick.x + (Math.random() - 0.5) * 3, 0, pick.z + (Math.random() - 0.5) * 3),
    );
    this.engine.scene.add(e.root);
    this.enemies.push(e);
    this.sparks.burst(new Vector3(e.position.x, 0.6, e.position.z), 6, 3);
  }

  private aliveCount() {
    return this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
  }

  private updateWaves(dt: number) {
    if (this.state !== 'playing') return;

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
      this.state = 'cleared';
      this.hud.setWave('FLOOR CLEARED');
      this.hud.say('ELEVATOR UNLOCKED', 2.4);
      this.engine.punch(0.3, 0xffffff, 3);
    } else {
      this.waveBreak = 2.2;
      this.hud.say(`WAVE ${this.waveIndex + 1}`, 1.2);
    }
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
  }

  private updateCamera(rawDt: number) {
    if (this.debugCam) {
      const cam = this.engine.camera;
      // Just under the ceiling at the back of the room: a full look down the
      // floor without the ceiling slab in the way.
      cam.position.set(0, 5.4, 21);
      cam.lookAt(0, 0.6, -10);
      return;
    }

    const s = this.input.state;

    let targetYaw = this.camYaw;
    let rate = 0;

    if (s.aiming) {
      // The camera points where you're about to throw. This is the only time
      // it moves quickly, which is what stops camera-relative input from
      // feeding back on itself and curving your movement.
      screenToWorld(s.aimDir, this.camYaw, this.worldAim);
      if (this.worldAim.lengthSq() > 0.01) {
        targetYaw = Math.atan2(this.worldAim.x, this.worldAim.z);
        rate = 11;
      }
      this.moveHeldFor = 0;
    } else if (this.worldMove.lengthSq() > 0.04) {
      this.moveHeldFor += rawDt;
      if (this.moveHeldFor > 0.55) {
        targetYaw = Math.atan2(this.worldMove.x, this.worldMove.z);
        rate = 1.1; // a slow drift home, not a whip
      }
    } else {
      this.moveHeldFor = 0;
    }

    if (rate > 0) {
      let delta = targetYaw - this.camYaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.camYaw += delta * Math.min(1, rate * rawDt);
    }

    const sin = Math.sin(this.camYaw);
    const cos = Math.cos(this.camYaw);
    const p = this.player.position;

    this.camShake = Math.max(0, this.camShake - rawDt * 1.6);
    const shake = this.camShake * this.camShake;

    const cam = this.engine.camera;
    cam.position.set(
      p.x - sin * CAM_DIST + (Math.random() - 0.5) * shake,
      CAM_HEIGHT + (Math.random() - 0.5) * shake,
      p.z - cos * CAM_DIST + (Math.random() - 0.5) * shake,
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
      this.hud.say(`FLOOR ${this.floorNumber}`, 1.6);
    }
  }

  private die() {
    this.state = 'dead';
    this.engine.punch(0.85, 0xc8402e, 1.6);
    this.time.setScale(1);
    this.hud.showOverlay(
      'PERFORMANCE&nbsp;MANAGED',
      `YOU REACHED FLOOR ${String(this.floorNumber).padStart(2, '0')}.<br/>YOUR BADGE HAS BEEN DEACTIVATED.`,
      'REAPPLY',
    );
  }

  private frame = () => {
    this.time.tick();
    const { dt, rawDt } = this.time;

    this.input.update();
    const s = this.input.state;
    const playing = this.state === 'playing' || this.state === 'cleared';

    // Winding up a throw dilates time. Using rawDt for the camera below keeps
    // the view responsive while the world crawls, which is what makes the
    // slow-mo read as power rather than lag.
    this.time.setScale(playing && s.aiming && this.player.alive ? SLOWMO : 1);

    if (playing) {
      screenToWorld(s.move, this.camYaw, this.worldMove);
      screenToWorld(s.aimDir, this.camYaw, this.worldAim);

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
      if (incoming > 0 && this.player.damage(incoming)) {
        this.engine.punch(0.45, 0xc8402e, 5);
        this.camShake = 0.5;
        this.hud.setHealth(this.player.health, this.player.maxHealth);
        if (!this.player.alive) this.die();
      }

      this.projectiles.update(dt, this.floor.colliders, this.enemies, (at, supply) => {
        this.sparks.burst(at, supply.impact > 0.2 ? 14 : 6, supply.impact > 0.2 ? 5 : 3);
        if (supply.impact > 0.2) this.camShake = Math.max(this.camShake, 0.2);
      });

      this.enemies = this.enemies.filter((e) => {
        if (!e.removable) return true;
        e.root.removeFromParent();
        return false;
      });

      this.updatePickups(dt);
      this.updateWaves(dt);
      this.checkElevator();
    }

    this.sparks.update(dt);
    this.updateCamera(rawDt);
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
      meshes,
      colliders: this.floor.colliders.length,
      floorChildren: this.floor.group.children.length,
      pickups: this.pickups.length,
      enemies: this.enemies.length,
      player: this.player.position.toArray().map((n) => +n.toFixed(1)),
      camera: this.engine.camera.position.toArray().map((n) => +n.toFixed(1)),
    };
  }

  run() {
    requestAnimationFrame(this.frame);
  }
}

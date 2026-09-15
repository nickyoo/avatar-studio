import { Box3, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { ps1Material } from '../render/ps1';
import type { FloorPalette } from '../render/palette';
import { SHARED_BOX, box } from './models';
import { makeBox } from './physics';

export const ROOM_W = 20;
export const ROOM_D = 46;
/**
 * Deliberately generous.
 *
 * Two reasons. A 66-degree FOV looking slightly down will always eat a third
 * of a portrait frame in ceiling unless there's real headroom above the
 * camera. And the combat is lob-based — low-power throws arc high, and they
 * need somewhere to arc to.
 */
export const CEILING = 7.5;

/** Window band: everything between the sill and the header. */
const GLASS_H = CEILING - 2.0;
const GLASS_Y = 1.0 + GLASS_H / 2;

/** Deterministic PRNG so floor N always generates the same office. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FloorVariant = 'office' | 'boardroom';

export class Floor {
  readonly variant: FloorVariant = 'office';
  readonly group = new Group();
  readonly colliders: Box3[] = [];
  readonly spawnPoints: Vector3[] = [];
  readonly supplyPoints: Vector3[] = [];
  // Far enough off the back wall that the chase camera has somewhere to sit;
  // any closer and the bounds clamp shoves it onto the player's shoulders.
  readonly playerSpawn = new Vector3(0, 0, ROOM_D / 2 - 11);
  readonly elevator = new Vector3(0, 0, -ROOM_D / 2 + 2.2);

  readonly minX = -ROOM_W / 2 + 1;
  readonly maxX = ROOM_W / 2 - 1;
  readonly minZ = -ROOM_D / 2 + 1;
  readonly maxZ = ROOM_D / 2 - 1;

  private readonly elevatorDoors: Mesh[] = [];
  private doorSlide = 0;

  constructor(floorNumber: number, p: FloorPalette, variant: FloorVariant = 'office') {
    const rng = mulberry32(floorNumber * 7919 + 13);
    this.variant = variant;

    const carpet = ps1Material(p.carpet);
    const wall = ps1Material(p.wall);
    const partition = ps1Material(p.partition);
    const desk = ps1Material(p.desk);
    const metal = ps1Material(0x3c3f42);
    const screen = new MeshBasicMaterial({ color: p.accent, fog: true });

    // Windows deliberately ignore fog so the skyline burns through the haze —
    // the player should never lose track of how far off the ground they are.
    const sky = new MeshBasicMaterial({ color: p.light, fog: false, side: DoubleSide });
    const panel = new MeshBasicMaterial({ color: p.light, fog: false });

    // --- shell ----------------------------------------------------------
    this.group.add(box(carpet, ROOM_W, 0.2, ROOM_D, 0, -0.1, 0));
    // The ceiling is lit from below by nothing, so without an emissive lift it
    // renders as a black slab across the top half of a portrait screen.
    const ceilingMat = ps1Material(p.wall);
    ceilingMat.emissive = new Color(p.light).multiplyScalar(0.3);
    this.group.add(box(ceilingMat, ROOM_W, 0.2, ROOM_D, 0, CEILING + 0.1, 0));

    const halfW = ROOM_W / 2;
    const halfD = ROOM_D / 2;

    // Side walls: solid sill, glass band, solid header. Reads as one long
    // window strip, which is the single most "skyscraper" shape there is.
    for (const side of [-1, 1]) {
      this.group.add(box(wall, 0.4, 1.0, ROOM_D, side * halfW, 0.5, 0));
      this.group.add(box(wall, 0.4, 1.0, ROOM_D, side * halfW, CEILING - 0.5, 0));
      const glass = new Mesh(new PlaneGeometry(ROOM_D, GLASS_H), sky);
      glass.rotation.y = (side * Math.PI) / 2;
      glass.position.set(side * (halfW - 0.05), GLASS_Y, 0);
      this.group.add(glass);
      // Mullions, so the window band doesn't read as one flat slab of light.
      for (let z = -halfD + 2; z < halfD; z += 4) {
        this.group.add(box(metal, 0.3, GLASS_H, 0.16, side * halfW, GLASS_Y, z));
      }
      this.colliders.push(makeBox(side * halfW, 2, 0, 0.6, 4, ROOM_D));
    }

    // Near wall (behind the player) and far wall (the elevator).
    this.group.add(box(wall, ROOM_W, CEILING, 0.4, 0, CEILING / 2, halfD));
    this.colliders.push(makeBox(0, 2, halfD, ROOM_W, 4, 0.6));

    const gap = 2.2;
    for (const side of [-1, 1]) {
      const w = halfW - gap;
      this.group.add(box(wall, w, CEILING, 0.4, side * (gap + w / 2), CEILING / 2, -halfD));
      this.colliders.push(makeBox(side * (gap + w / 2), 2, -halfD, w, 4, 0.6));
    }

    // --- elevator -------------------------------------------------------
    this.group.add(box(metal, gap * 2 + 0.8, CEILING, 0.3, 0, CEILING / 2, -halfD - 0.3));
    // Header above the lift doors, so the opening reads as a door and not a
    // hole punched in a very tall wall.
    this.group.add(box(wall, gap * 2 + 0.8, CEILING - 3.2, 0.36, 0, 3.2 + (CEILING - 3.2) / 2, -halfD + 0.1));
    this.group.add(box(ps1Material(p.accent), gap * 2 + 0.8, 0.22, 0.2, 0, 3.35, -halfD + 0.16));
    for (const side of [-1, 1]) {
      const door = box(ps1Material(0x8d9299), gap, 3.0, 0.16, (side * gap) / 2, 1.5, -halfD + 0.05);
      this.elevatorDoors.push(door);
      this.group.add(door);
    }

    // --- ceiling lights -------------------------------------------------
    for (let z = -halfD + 4; z < halfD - 2; z += 5.5) {
      for (const x of [-5.6, 0, 5.6]) {
        const light = new Mesh(new PlaneGeometry(1.6, 4.2), panel);
        light.rotation.x = Math.PI / 2;
        light.position.set(x, CEILING - 0.02, z);
        this.group.add(light);
      }
    }

    if (variant === 'boardroom') {
      this.buildBoardroom(p, { desk, metal, partition, screen });
    } else {
      // --- cubicle pods -------------------------------------------------
      const podX = [-4.0, 4.0];
      const podZ = [-13, -5, 3, 11];
      for (const px of podX) {
        for (const pz of podZ) {
          if (pz < -12 && Math.abs(px) < 3) continue; // keep the elevator lane clear
          this.buildPod(px, pz, rng, { partition, desk, metal, screen, accent: p.accent });
          this.spawnPoints.push(new Vector3(px, 0, pz));
        }
      }
    }

    // --- centre aisle furniture ----------------------------------------
    let flip = 1;
    if (variant === 'boardroom') flip = 0;
    for (let z = -halfD + 7; flip !== 0 && z < halfD - 7; z += 6.5) {
      const x = flip * 1.7;
      flip *= -1;
      if (rng() > 0.45) {
        // Copier. Waist-high, so it blocks a flat throw but not a lobbed one.
        this.group.add(box(metal, 1.15, 1.05, 0.85, x, 0.52, z));
        this.group.add(box(partition, 0.9, 0.1, 0.65, x, 1.08, z));
        this.colliders.push(makeBox(x, 0.52, z, 1.15, 1.05, 0.85));
      } else {
        // Water cooler. The only place on this floor anyone tells the truth.
        this.group.add(box(metal, 0.42, 1.0, 0.42, x, 0.5, z));
        this.group.add(box(new MeshBasicMaterial({ color: 0xa8d8e8 }), 0.34, 0.5, 0.34, x, 1.24, z));
        this.colliders.push(makeBox(x, 0.5, z, 0.42, 1.5, 0.42));
      }
    }

    // Supply trays scatter over the same anchors the spawner uses, so both
    // floor variants get them without either knowing about the other.
    for (let i = 0; i < 5 && this.spawnPoints.length; i++) {
      const anchor = this.spawnPoints[Math.floor(rng() * this.spawnPoints.length)];
      const pos = new Vector3(anchor.x + (rng() - 0.5) * 2.4, 0.9, anchor.z + (rng() - 0.5) * 2.4);
      pos.x = Math.max(this.minX, Math.min(this.maxX, pos.x));
      pos.z = Math.max(this.minZ, Math.min(this.maxZ, pos.z));
      if (this.supplyPoints.some((s) => s.distanceTo(pos) < 4)) continue;
      this.supplyPoints.push(pos);
    }
  }

  /**
   * The boss arena.
   *
   * One long table down the middle rather than a maze. It's waist-high, so a
   * flat throw clips it and a lobbed one clears it — which turns the wind-up
   * dial into a real decision instead of "always full power".
   */
  private buildBoardroom(
    p: FloorPalette,
    mats: {
      desk: ReturnType<typeof ps1Material>;
      metal: ReturnType<typeof ps1Material>;
      partition: ReturnType<typeof ps1Material>;
      screen: MeshBasicMaterial;
    },
  ) {
    const tableZ = -2;
    const tableLen = 11;

    this.group.add(box(mats.desk, 3.0, 0.12, tableLen, 0, 0.78, tableZ));
    this.group.add(box(mats.metal, 0.5, 0.74, tableLen - 2.4, 0, 0.38, tableZ));
    this.colliders.push(makeBox(0, 0.42, tableZ, 3.0, 0.84, tableLen));

    for (let i = 0; i < 6; i++) {
      const z = tableZ - tableLen / 2 + 1.2 + i * ((tableLen - 2.4) / 5);
      for (const sx of [-1, 1]) {
        const x = sx * 2.1;
        this.group.add(box(mats.partition, 0.55, 0.1, 0.55, x, 0.46, z));
        this.group.add(box(mats.partition, 0.55, 0.62, 0.12, x + sx * 0.22, 0.78, z));
        this.colliders.push(makeBox(x, 0.3, z, 0.6, 0.6, 0.6));
      }
    }

    // Presentation screen at the head of the table. Nobody is reading it.
    this.group.add(box(mats.metal, 4.6, 2.6, 0.2, 0, 2.4, -14.5));
    const slide = new Mesh(new PlaneGeometry(4.2, 2.2), mats.screen);
    slide.position.set(0, 2.4, -14.36);
    this.group.add(slide);

    // Credenzas along the flanks: cover, and something to break the silhouette.
    for (const sx of [-1, 1]) {
      for (const z of [-9, 4]) {
        this.group.add(box(mats.desk, 0.9, 1.0, 3.2, sx * 7.4, 0.5, z));
        this.colliders.push(makeBox(sx * 7.4, 0.5, z, 0.9, 1.0, 3.2));
      }
    }

    void p;

    for (const sx of [-1, 1]) {
      for (const z of [-11, -4, 3, 10]) this.spawnPoints.push(new Vector3(sx * 6.2, 0, z));
    }
  }

  private buildPod(
    px: number,
    pz: number,
    rng: () => number,
    mats: {
      partition: ReturnType<typeof ps1Material>;
      desk: ReturnType<typeof ps1Material>;
      metal: ReturnType<typeof ps1Material>;
      screen: MeshBasicMaterial;
      accent: number;
    },
  ) {
    const H = 1.45;
    const W = 3.8;

    // The plus-shaped partition. Four workers, no privacy, one shared sigh.
    this.group.add(box(mats.partition, W, H, 0.16, px, H / 2, pz));
    this.group.add(box(mats.partition, 0.16, H, W, px, H / 2, pz));
    this.colliders.push(makeBox(px, H / 2, pz, W, H, 0.16));
    this.colliders.push(makeBox(px, H / 2, pz, 0.16, H, W));

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const dx = px + sx * 0.95;
        const dz = pz + sz * 1.3;
        this.group.add(box(mats.desk, 1.6, 0.08, 1.0, dx, 0.74, dz));
        this.group.add(box(mats.desk, 1.5, 0.62, 0.08, dx, 0.4, dz + sz * 0.45));
        this.colliders.push(makeBox(dx, 0.4, dz, 1.6, 0.82, 1.0));

        if (rng() > 0.25) {
          this.group.add(box(mats.metal, 0.7, 0.44, 0.06, dx, 1.05, dz - sz * 0.35));
          const scr = new Mesh(new PlaneGeometry(0.6, 0.36), mats.screen);
          scr.position.set(dx, 1.05, dz - sz * 0.35 + sz * 0.04);
          scr.rotation.y = sz > 0 ? 0 : Math.PI;
          this.group.add(scr);
        }
        if (rng() > 0.6) {
          this.group.add(box(mats.metal, 0.22, 0.28, 0.22, dx + 0.58, 0.92, dz));
        }
      }
    }
  }

  /** 0 = shut, 1 = fully open. Driven by the game when a floor is cleared. */
  setDoors(open: number) {
    this.doorSlide = open;
    const slide = open * 2.1;
    this.elevatorDoors[0].position.x = -1.1 - slide;
    this.elevatorDoors[1].position.x = 1.1 + slide;
  }

  get doorsOpen() {
    return this.doorSlide;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        // SHARED_BOX outlives every floor; disposing it would break the next one.
        if (m.geometry !== SHARED_BOX) m.geometry.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat.dispose();
      }
    });
    this.group.removeFromParent();
  }
}

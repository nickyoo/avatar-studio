import { BoxGeometry, Group, Mesh, type Material, type MeshLambertMaterial, Object3D } from 'three';
import { ps1Material } from '../render/ps1';

/**
 * Everything in this game is boxes.
 *
 * That's not a shortcut — flat-shaded boxes are what makes the vertex-snap
 * wobble legible. Curved low-poly geometry just looks like a mistake once it
 * starts swimming; hard edges look intentional.
 */
export const SHARED_BOX = new BoxGeometry(1, 1, 1);

/** Shoes. Hoisted so we aren't allocating a material per leg per enemy. */
const SHOE = ps1Material(0x1c1a17);

export function box(
  material: Material,
  w: number,
  h: number,
  d: number,
  x = 0,
  y = 0,
  z = 0,
): Mesh {
  const m = new Mesh(SHARED_BOX, material);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  return m;
}

export interface Humanoid {
  root: Group;
  torso: Object3D;
  head: Object3D;
  armL: Object3D;
  armR: Object3D;
  legL: Object3D;
  legR: Object3D;
}

export interface HumanoidColors {
  skin: number;
  shirt: number;
  trousers: number;
  hair: number;
}

export interface HumanoidMaterials {
  skin: MeshLambertMaterial;
  shirt: MeshLambertMaterial;
  trousers: MeshLambertMaterial;
  hair: MeshLambertMaterial;
}

const materialCache = new Map<string, HumanoidMaterials>();

/**
 * Materials are cached per colour scheme, not per body.
 *
 * Every enemy of a type shares one set. Thirty drones allocating four
 * materials each is 120 uniform blocks the GPU has to churn through for no
 * visual difference whatsoever.
 */
export function humanoidMaterials(c: HumanoidColors): HumanoidMaterials {
  const key = `${c.skin}|${c.shirt}|${c.trousers}|${c.hair}`;
  let set = materialCache.get(key);
  if (!set) {
    set = {
      skin: ps1Material(c.skin),
      shirt: ps1Material(c.shirt),
      trousers: ps1Material(c.trousers),
      hair: ps1Material(c.hair),
    };
    materialCache.set(key, set);
  }
  return set;
}

/**
 * A person, assembled out of seven boxes.
 *
 * Limbs are parented to pivots at the shoulder and hip so a walk cycle is two
 * lines of sin() rather than a skeleton and an animation clip — which keeps
 * every enemy under one draw call's worth of thinking and means we can have
 * thirty of them on screen on a phone.
 */
export function humanoid(colors: HumanoidColors, scale = 1): Humanoid {
  const { skin, shirt, trousers, hair } = humanoidMaterials(colors);

  const root = new Group();
  root.scale.setScalar(scale);

  const torso = box(shirt, 0.62, 0.78, 0.34, 0, 1.12, 0);
  root.add(torso);

  const head = new Group();
  head.position.set(0, 1.62, 0);
  head.add(box(skin, 0.36, 0.38, 0.34));
  head.add(box(hair, 0.4, 0.12, 0.38, 0, 0.19, -0.01));
  root.add(head);

  const mkArm = (side: number) => {
    const pivot = new Group();
    pivot.position.set(side * 0.4, 1.46, 0);
    // Geometry hangs *below* the pivot so rotating the pivot swings the arm.
    pivot.add(box(shirt, 0.17, 0.42, 0.17, 0, -0.21, 0));
    pivot.add(box(skin, 0.15, 0.3, 0.15, 0, -0.56, 0));
    return pivot;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);
  root.add(armL, armR);

  const mkLeg = (side: number) => {
    const pivot = new Group();
    pivot.position.set(side * 0.16, 0.74, 0);
    pivot.add(box(trousers, 0.22, 0.74, 0.22, 0, -0.37, 0));
    pivot.add(box(SHOE, 0.24, 0.12, 0.34, 0, -0.78, 0.05));
    return pivot;
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);
  root.add(legL, legR);

  return { root, torso, head, armL, armR, legL, legR };
}

/**
 * Drive a humanoid's limbs. `phase` advances with distance travelled.
 *
 * Pass `poseArms: false` when the caller is posing the arms itself — an attack
 * wind-up, a throw follow-through — otherwise the walk cycle overwrites it and
 * the telegraph silently never plays.
 */
export function walkCycle(h: Humanoid, phase: number, amplitude: number, poseArms = true) {
  const s = Math.sin(phase) * amplitude;
  const c = Math.cos(phase) * amplitude;
  h.legL.rotation.x = s;
  h.legR.rotation.x = -s;
  if (poseArms) {
    h.armL.rotation.x = -s * 0.7;
    h.armR.rotation.x = s * 0.7;
  }
  h.torso.position.y = 1.12 + Math.abs(c) * 0.04;
}

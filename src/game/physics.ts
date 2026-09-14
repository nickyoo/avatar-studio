import { Box3, Vector3 } from 'three';

const tmp = new Vector3();

/**
 * Push a vertical cylinder out of a list of axis-aligned boxes.
 *
 * Resolving on the single shallowest axis (rather than both at once) is what
 * makes sliding along a cubicle wall feel right instead of sticky: you keep
 * the component of your velocity that runs parallel to the surface.
 */
export function resolveCircle(pos: Vector3, radius: number, boxes: Box3[]): boolean {
  let hit = false;
  for (const b of boxes) {
    if (pos.y > b.max.y || pos.y + 1.7 < b.min.y) continue;

    const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
    const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const distSq = dx * dx + dz * dz;
    if (distSq >= radius * radius) continue;

    hit = true;
    if (distSq > 1e-6) {
      const dist = Math.sqrt(distSq);
      pos.x += (dx / dist) * (radius - dist);
      pos.z += (dz / dist) * (radius - dist);
    } else {
      // Centre is inside the box: eject along whichever face is nearest.
      const toMinX = pos.x - b.min.x;
      const toMaxX = b.max.x - pos.x;
      const toMinZ = pos.z - b.min.z;
      const toMaxZ = b.max.z - pos.z;
      const m = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
      if (m === toMinX) pos.x = b.min.x - radius;
      else if (m === toMaxX) pos.x = b.max.x + radius;
      else if (m === toMinZ) pos.z = b.min.z - radius;
      else pos.z = b.max.z + radius;
    }
  }
  return hit;
}

/** True if a point is inside any box. Used for projectile impacts. */
export function pointInBoxes(p: Vector3, boxes: Box3[]): Box3 | null {
  for (const b of boxes) if (b.containsPoint(p)) return b;
  return null;
}

/**
 * Does the segment a->b reach `target` within `radius`?
 *
 * Projectiles move fast enough to skip clean through an enemy in one frame at
 * 60fps, so hit tests have to be swept rather than point-in-sphere.
 */
export function segmentHitsSphere(
  a: Vector3,
  b: Vector3,
  target: Vector3,
  radius: number,
): boolean {
  tmp.subVectors(b, a);
  const lenSq = tmp.lengthSq();
  if (lenSq < 1e-8) return a.distanceToSquared(target) <= radius * radius;

  let t = ((target.x - a.x) * tmp.x + (target.y - a.y) * tmp.y + (target.z - a.z) * tmp.z) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const px = a.x + tmp.x * t;
  const py = a.y + tmp.y * t;
  const pz = a.z + tmp.z * t;
  const dx = px - target.x;
  const dy = py - target.y;
  const dz = pz - target.z;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

export function makeBox(
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  d: number,
): Box3 {
  return new Box3(
    new Vector3(cx - w / 2, cy - h / 2, cz - d / 2),
    new Vector3(cx + w / 2, cy + h / 2, cz + d / 2),
  );
}

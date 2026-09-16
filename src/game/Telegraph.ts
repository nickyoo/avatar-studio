import { CircleGeometry, Group, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three';

const POOL = 10;

/**
 * Ground markers that warn before something lands.
 *
 * The language is deliberately literal: a static outline shows you the blast
 * footprint, and a disc fills it like a progress bar. You can read both the
 * "where" and the "when" from one glance, which matters when the thing you're
 * reading is two inches tall on a phone.
 */
export class Telegraphs {
  readonly group = new Group();

  private readonly pool: Array<{
    ring: Mesh;
    fill: Mesh;
    radius: number;
    elapsed: number;
    duration: number;
    active: boolean;
  }> = [];

  constructor() {
    const ringGeo = new RingGeometry(0.92, 1, 28);
    const fillGeo = new CircleGeometry(1, 28);

    for (let i = 0; i < POOL; i++) {
      const outline = new MeshBasicMaterial({
        color: 0xff5a3c,
        fog: false,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      const filling = new MeshBasicMaterial({
        color: 0xff5a3c,
        fog: false,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      });

      const ring = new Mesh(ringGeo, outline);
      const fill = new Mesh(fillGeo, filling);
      for (const m of [ring, fill]) {
        m.rotation.x = -Math.PI / 2;
        m.visible = false;
        // Sit just above the carpet and draw last, so the marker never
        // z-fights with the floor it's painted on.
        m.renderOrder = 2;
        this.group.add(m);
      }
      this.pool.push({ ring, fill, radius: 1, elapsed: 0, duration: 1, active: false });
    }
  }

  add(at: Vector3, radius: number, duration: number) {
    const t = this.pool.find((x) => !x.active);
    if (!t) return;
    t.active = true;
    t.radius = radius;
    t.elapsed = 0;
    t.duration = duration;
    t.ring.position.set(at.x, 0.04, at.z);
    t.fill.position.set(at.x, 0.05, at.z);
    t.ring.scale.setScalar(radius);
    t.fill.scale.setScalar(0.001);
    t.ring.visible = true;
    t.fill.visible = true;
  }

  update(dt: number) {
    for (const t of this.pool) {
      if (!t.active) continue;
      t.elapsed += dt;
      const p = Math.min(1, t.elapsed / t.duration);
      t.fill.scale.setScalar(Math.max(0.001, p * t.radius));
      // Flash hard in the last beat: the moment to actually be elsewhere.
      const urgent = p > 0.8 && Math.floor(t.elapsed * 18) % 2 === 0;
      (t.ring.material as MeshBasicMaterial).opacity = urgent ? 1 : 0.9;
      if (p >= 1) {
        t.active = false;
        t.ring.visible = false;
        t.fill.visible = false;
      }
    }
  }

  clear() {
    for (const t of this.pool) {
      t.active = false;
      t.ring.visible = false;
      t.fill.visible = false;
    }
  }
}

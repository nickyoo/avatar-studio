/**
 * Global clock with a scalable timescale.
 *
 * `dt` is what gameplay reads: it already has the slow-motion factor baked in.
 * `rawDt` ignores the timescale and is what UI, camera smoothing and the
 * slow-mo blend itself should use, so the world crawls but the camera doesn't.
 */
export class Time {
  /** Seconds since the last frame, scaled by the current timescale. */
  dt = 0;
  /** Seconds since the last frame, unscaled. */
  rawDt = 0;
  /** Seconds since start, scaled. Drives shader animation. */
  elapsed = 0;

  private scale = 1;
  private targetScale = 1;
  private last = performance.now() / 1000;

  /** Slow-mo blend speed, in scale-units per real second. */
  blend = 6;

  private freezeT = 0;

  /**
   * Hard-stop the world for a moment.
   *
   * Hit-stop: the cheapest and most effective game-feel trick there is. A
   * kill lands harder when the whole scene locks for ~60ms before resuming.
   * Deliberately bypasses the blend rather than driving the scale to zero, so
   * play resumes crisply instead of easing back in.
   */
  freeze(seconds: number) {
    this.freezeT = Math.max(this.freezeT, seconds);
  }

  /** Request a timescale. 1 = normal, 0.25 = the throw wind-up. */
  setScale(value: number) {
    this.targetScale = value;
  }

  get timeScale() {
    return this.scale;
  }

  tick() {
    const now = performance.now() / 1000;
    // Clamp so an alt-tab or a GC pause can't teleport anything through a wall.
    this.rawDt = Math.min(now - this.last, 1 / 20);
    this.last = now;

    if (this.freezeT > 0) {
      this.freezeT -= this.rawDt;
      // rawDt keeps flowing so the camera, HUD and renderer stay alive.
      this.dt = 0;
      return;
    }

    const step = this.blend * this.rawDt;
    this.scale += Math.max(-step, Math.min(step, this.targetScale - this.scale));

    this.dt = this.rawDt * this.scale;
    this.elapsed += this.dt;
  }
}

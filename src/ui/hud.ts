/**
 * The HUD is plain DOM on top of the canvas.
 *
 * Rendering it in three would mean fighting the 400px internal framebuffer for
 * text legibility. Keeping it in DOM means it stays crisp at device resolution
 * while the game itself stays gloriously chunky.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly floorLabel: HTMLElement;
  private readonly bandLabel: HTMLElement;
  private readonly waveLabel: HTMLElement;
  private readonly supplyName: HTMLElement;
  private readonly supplyCount: HTMLElement;
  private readonly swapBtn: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly overlay: HTMLElement;

  onSwap: () => void = () => {};
  onRestart: () => void = () => {};

  private toastTimer = 0;

  constructor(host: HTMLElement) {
    host.innerHTML = `
      <div class="hud-top">
        <div class="floor-block">
          <div class="floor-num" data-floor>01</div>
          <div class="floor-band" data-band>THE FLOOR</div>
        </div>
        <div class="wave" data-wave></div>
      </div>
      <div class="health"><div class="health-fill" data-health></div></div>
      <button class="supply" data-swap>
        <span class="supply-name" data-supply>PAPERCLIP</span>
        <span class="supply-count" data-count>&infin;</span>
      </button>
      <div class="toast" data-toast></div>
      <div class="overlay" data-overlay hidden></div>
    `;
    this.root = host;
    const q = (sel: string) => host.querySelector(sel) as HTMLElement;
    this.healthFill = q('[data-health]');
    this.floorLabel = q('[data-floor]');
    this.bandLabel = q('[data-band]');
    this.waveLabel = q('[data-wave]');
    this.supplyName = q('[data-supply]');
    this.supplyCount = q('[data-count]');
    this.swapBtn = q('[data-swap]');
    this.toast = q('[data-toast]');
    this.overlay = q('[data-overlay]');

    // pointerdown, not click: on touch, click fires ~300ms late and the swap
    // needs to feel instant mid-fight.
    this.swapBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.onSwap();
    });
  }

  setHealth(value: number, max: number) {
    const pct = Math.max(0, value / max);
    this.healthFill.style.transform = `scaleX(${pct})`;
    this.root.classList.toggle('critical', pct <= 0.3);
  }

  setFloor(n: number, band: string) {
    this.floorLabel.textContent = String(n).padStart(2, '0');
    this.bandLabel.textContent = band;
  }

  setWave(text: string) {
    this.waveLabel.textContent = text;
  }

  setSupply(name: string, count: number) {
    this.supplyName.textContent = name;
    this.supplyCount.innerHTML = count === Infinity ? '&infin;' : String(count);
  }

  say(text: string, seconds = 2) {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastTimer = seconds;
  }

  update(rawDt: number) {
    if (this.toastTimer > 0) {
      this.toastTimer -= rawDt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
  }

  showOverlay(title: string, detail: string, button: string) {
    this.overlay.innerHTML = `
      <div class="overlay-card">
        <h1>${title}</h1>
        <p>${detail}</p>
        <button data-restart>${button}</button>
      </div>`;
    this.overlay.hidden = false;
    const btn = this.overlay.querySelector('[data-restart]') as HTMLElement;
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.onRestart();
    });
  }

  hideOverlay() {
    this.overlay.hidden = true;
  }
}

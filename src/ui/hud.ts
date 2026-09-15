import { LIMITS, type Settings } from '../core/settings';

/**
 * The HUD and every menu screen, as plain DOM on top of the canvas.
 *
 * Rendering this in three would mean fighting a 400px internal framebuffer for
 * text legibility. Keeping it in DOM means the type stays crisp at device
 * resolution while the game itself stays gloriously chunky — and the menus sit
 * over a live render of the world rather than a flat colour.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly chrome: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly floorLabel: HTMLElement;
  private readonly bandLabel: HTMLElement;
  private readonly waveLabel: HTMLElement;
  private readonly supplyName: HTMLElement;
  private readonly supplyCount: HTMLElement;
  private readonly swapBtn: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly screen: HTMLElement;
  private readonly bossBar: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossName: HTMLElement;

  onStart: () => void = () => {};
  onRestart: () => void = () => {};
  onMenu: () => void = () => {};
  onSwap: () => void = () => {};
  onSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void = () => {};

  private toastTimer = 0;

  constructor(host: HTMLElement) {
    host.innerHTML = `
      <div class="chrome">
        <div class="hud-top">
          <div class="floor-block">
            <div class="floor-num" data-floor>01</div>
            <div class="floor-band" data-band>THE FLOOR</div>
          </div>
          <div class="wave" data-wave></div>
        </div>
        <div class="health"><div class="health-fill" data-health></div></div>
        <div class="boss" data-boss hidden>
          <div class="boss-name" data-boss-name></div>
          <div class="boss-track"><div class="boss-fill" data-boss-fill></div></div>
        </div>
        <button class="supply" data-swap>
          <span class="supply-name" data-supply>PAPERCLIP</span>
          <span class="supply-count" data-count>&infin;</span>
        </button>
      </div>
      <div class="toast" data-toast></div>
      <div class="screen" data-screen hidden></div>
    `;
    this.root = host;
    const q = (sel: string) => host.querySelector(sel) as HTMLElement;
    this.chrome = q('.chrome');
    this.healthFill = q('[data-health]');
    this.floorLabel = q('[data-floor]');
    this.bandLabel = q('[data-band]');
    this.waveLabel = q('[data-wave]');
    this.supplyName = q('[data-supply]');
    this.supplyCount = q('[data-count]');
    this.swapBtn = q('[data-swap]');
    this.toast = q('[data-toast]');
    this.screen = q('[data-screen]');
    this.bossBar = q('[data-boss]');
    this.bossFill = q('[data-boss-fill]');
    this.bossName = q('[data-boss-name]');

    // pointerdown rather than click: on touch, click fires ~300ms late and a
    // mid-fight supply swap needs to feel instant.
    this.swapBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.onSwap();
    });

    this.screen.addEventListener('pointerdown', (e) => {
      const action = (e.target as HTMLElement).closest('[data-action]');
      if (!action) return;
      e.stopPropagation();
      e.preventDefault();
      switch (action.getAttribute('data-action')) {
        case 'start':
          this.onStart();
          break;
        case 'restart':
          this.onRestart();
          break;
        case 'menu':
          this.onMenu();
          break;
        case 'settings':
          this.showSettings(this.lastSettings!);
          break;
        case 'hand':
          this.onSetting('throwHand', action.getAttribute('data-value') as 'left' | 'right');
          this.showSettings(this.lastSettings!);
          break;
        case 'back':
          this.showTitle(this.lastSettings!);
          break;
      }
    });

    this.screen.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.type !== 'range') return;
      const key = el.getAttribute('data-key') as 'pullRadius' | 'slowmo';
      this.onSetting(key, Number(el.value));
      const readout = this.screen.querySelector(`[data-readout="${key}"]`);
      if (readout) readout.textContent = formatSetting(key, Number(el.value));
    });
  }

  private lastSettings: Settings | null = null;

  // --- in-game chrome ---------------------------------------------------

  setChromeVisible(visible: boolean) {
    this.chrome.hidden = !visible;
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

  /** Pass null to hide the boss bar. */
  setBoss(name: string | null, fraction = 0, shielded = false) {
    if (!name) {
      this.bossBar.hidden = true;
      return;
    }
    this.bossBar.hidden = false;
    this.bossName.textContent = shielded ? `${name} — PRESENTING` : name;
    this.bossFill.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
    this.bossBar.classList.toggle('shielded', shielded);
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

  // --- screens ----------------------------------------------------------

  showTitle(settings: Settings) {
    this.lastSettings = settings;
    const best = settings.bestFloor
      ? `<div class="best">BEST &mdash; FLOOR ${String(settings.bestFloor).padStart(2, '0')}</div>`
      : '';
    this.screen.className = 'screen title';
    this.screen.innerHTML = `
      <div class="card">
        <div class="eyebrow">A DUNGEON CRAWLER ABOUT THE CORPORATE LADDER</div>
        <h1>UPWARD<br/>MOBILITY</h1>
        <div class="actions">
          <button class="primary" data-action="start">CLOCK IN</button>
          <button data-action="settings">SETTINGS</button>
        </div>
        ${best}
        <div class="hint">
          ${settings.throwHand === 'right' ? 'LEFT' : 'RIGHT'} THUMB MOVES &middot;
          ${settings.throwHand === 'right' ? 'RIGHT' : 'LEFT'} THUMB PULLS BACK TO THROW
        </div>
      </div>`;
    this.screen.hidden = false;
  }

  showSettings(settings: Settings) {
    this.lastSettings = settings;
    this.screen.className = 'screen settings';
    this.screen.innerHTML = `
      <div class="card">
        <h2>SETTINGS</h2>

        <div class="row">
          <div class="row-label">THROWING HAND</div>
          <div class="segmented">
            <button data-action="hand" data-value="left"
              class="${settings.throwHand === 'left' ? 'on' : ''}">LEFT</button>
            <button data-action="hand" data-value="right"
              class="${settings.throwHand === 'right' ? 'on' : ''}">RIGHT</button>
          </div>
        </div>

        ${slider('THUMB REACH', 'pullRadius', settings.pullRadius, LIMITS.pullRadius)}
        <div class="note">How far you pull back for a full-power throw. Shorter is
          faster; longer is finer control.</div>

        ${slider('TIME DILATION', 'slowmo', settings.slowmo, LIMITS.slowmo)}
        <div class="note">How much the world slows while you wind up. 100% turns
          it off entirely.</div>

        <div class="actions">
          <button class="primary" data-action="back">BACK</button>
        </div>
      </div>`;
    this.screen.hidden = false;
  }

  showGameOver(floor: number, settings: Settings, isBest: boolean) {
    this.lastSettings = settings;
    this.screen.className = 'screen over';
    this.screen.innerHTML = `
      <div class="card">
        <h1>PERFORMANCE<br/>MANAGED</h1>
        <p>
          YOU REACHED FLOOR ${String(floor).padStart(2, '0')}.<br/>
          YOUR BADGE HAS BEEN DEACTIVATED.
        </p>
        ${
          isBest
            ? '<div class="best new">A NEW PERSONAL BEST</div>'
            : `<div class="best">BEST &mdash; FLOOR ${String(settings.bestFloor).padStart(2, '0')}</div>`
        }
        <div class="actions">
          <button class="primary" data-action="restart">REAPPLY</button>
          <button data-action="menu">MAIN MENU</button>
        </div>
      </div>`;
    this.screen.hidden = false;
  }

  hideScreen() {
    this.screen.hidden = true;
  }
}

function formatSetting(key: 'pullRadius' | 'slowmo', value: number) {
  return key === 'slowmo' ? `${Math.round(value * 100)}%` : `${Math.round(value)}px`;
}

function slider(
  label: string,
  key: 'pullRadius' | 'slowmo',
  value: number,
  limits: { min: number; max: number; step: number },
) {
  return `
    <div class="row">
      <div class="row-label">${label}</div>
      <div class="readout" data-readout="${key}">${formatSetting(key, value)}</div>
    </div>
    <input type="range" data-key="${key}"
      min="${limits.min}" max="${limits.max}" step="${limits.step}" value="${value}" />`;
}

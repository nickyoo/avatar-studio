import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { COMPOSITE_FRAG, COMPOSITE_VERT } from '../render/ps1';
import { HIGHLIGHT_TINT, SHADOW_TINT, type FloorPalette } from '../render/palette';

/**
 * Longest edge of the internal framebuffer, in pixels.
 *
 * Everything is rendered here and then blown up with a nearest-neighbour
 * filter, which is both the entire retro look and the reason this runs at
 * 60fps on a phone: we're shading roughly 75k pixels a frame instead of 3M.
 */
const MAX_INTERNAL_DIM = 400;

export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly hemi: HemisphereLight;
  readonly sun: DirectionalLight;
  readonly fog: Fog;

  private readonly target: WebGLRenderTarget;
  private readonly compositeScene = new Scene();
  private readonly compositeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly composite: ShaderMaterial;

  /** Screen size in CSS pixels. */
  readonly size = new Vector2(1, 1);

  private flash = 0;
  private flashDecay = 6;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false, // antialiasing would fight the whole aesthetic
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;

    // 66 vertical. On a 9:19.5 phone that still only buys ~33 degrees
    // horizontal — a tall viewport spends almost all its FOV budget on height,
    // which is why the level below is a corridor and not a hall.
    this.camera = new PerspectiveCamera(66, 1, 0.1, 120);

    this.fog = new Fog(0x3a3c34, 14, 58);
    this.scene.fog = this.fog;
    this.scene.background = new Color(0x3a3c34);

    // three has used physically-correct lighting since r155, where the BRDF
    // divides by PI. Intensities that looked right under the old model come
    // out roughly PI times too dark, hence the otherwise odd-looking numbers.
    this.hemi = new HemisphereLight(0xdfe6c8, 0x2b2e28, 4.6);
    this.scene.add(this.hemi);

    this.sun = new DirectionalLight(0xfff4d6, 2.7);
    this.sun.position.set(-6, 14, 5);
    this.scene.add(this.sun);

    this.target = new WebGLRenderTarget(1, 1, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    // Let three do the linear -> sRGB conversion on the way *into* the target,
    // so the dither and quantise below run in perceptual space where a small
    // number of levels actually looks like a small number of levels.
    this.target.texture.colorSpace = SRGBColorSpace;

    this.composite = new ShaderMaterial({
      vertexShader: COMPOSITE_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uResolution: { value: new Vector2(1, 1) },
        uLevels: { value: 14 },
        uShadowTint: { value: SHADOW_TINT.clone() },
        uHighlightTint: { value: HIGHLIGHT_TINT.clone() },
        uGrade: { value: 0 },
        uVignette: { value: 0.42 },
        uFlash: { value: 0 },
        uFlashColor: { value: new Color(1, 1, 1) },
      },
    });
    this.compositeScene.add(new Mesh(new PlaneGeometry(2, 2), this.composite));

    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
  }

  /** Recolour the world for a floor band. */
  applyPalette(p: FloorPalette) {
    this.fog.color.setHex(p.fog);
    (this.scene.background as Color).setHex(p.fog);
    this.hemi.color.setHex(p.light);
    this.hemi.groundColor.setHex(p.ambient);
    this.composite.uniforms.uGrade.value = p.grade;
  }

  /** Punch the screen. Used for hits, throws landing and taking damage. */
  punch(strength = 0.55, color = 0xffffff, decay = 6) {
    this.flash = Math.max(this.flash, strength);
    this.flashDecay = decay;
    (this.composite.uniforms.uFlashColor.value as Color).setHex(color);
  }

  private resize = () => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.size.set(w, h);

    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    const scale = Math.min(1, MAX_INTERNAL_DIM / Math.max(w, h));
    const iw = Math.max(1, Math.round(w * scale));
    const ih = Math.max(1, Math.round(h * scale));
    this.target.setSize(iw, ih);
    (this.composite.uniforms.uResolution.value as Vector2).set(iw, ih);
  };

  render(rawDt: number) {
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - this.flashDecay * rawDt);
    }
    this.composite.uniforms.uFlash.value = this.flash;

    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    this.renderer.setRenderTarget(null);
    this.renderer.render(this.compositeScene, this.compositeCamera);
  }
}

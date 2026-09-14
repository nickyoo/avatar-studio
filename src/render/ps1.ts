import {
  Color,
  MeshLambertMaterial,
  type MeshLambertMaterialParameters,
  type WebGLProgramParametersWithUniforms,
} from 'three';

/**
 * Size of the virtual vertex grid, in "pixels" across clip space.
 *
 * The PlayStation had no floating-point rasteriser, so vertices snapped to a
 * fixed grid and geometry visibly swam as the camera moved. Lower = more
 * wobble. ~92 is the sweet spot: obviously retro, still readable on a phone.
 */
const VERTEX_GRID = 92;

const JITTER_CHUNK = /* glsl */ `
#include <project_vertex>
{
  vec4 ps1 = gl_Position;
  ps1.xyz /= ps1.w;
  ps1.xy = floor(ps1.xy * ${VERTEX_GRID.toFixed(1)}) / ${VERTEX_GRID.toFixed(1)};
  ps1.xyz *= ps1.w;
  gl_Position = ps1;
}
`;

function injectVertexSnap(shader: WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', JITTER_CHUNK);
}

/**
 * The one material every piece of world geometry uses.
 *
 * Flat shading + Lambert is deliberately the cheapest lit path three offers,
 * which is what buys us headroom on a mid-tier Android phone. All of the
 * "look" is in the vertex snap here and the dither pass in Engine.
 */
export function ps1Material(
  color: Color | number | string,
  params: MeshLambertMaterialParameters = {},
): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ color, flatShading: true, ...params });
  mat.onBeforeCompile = injectVertexSnap;
  // Without this, three reuses one compiled program across every material that
  // shares defines and our injected chunk silently goes missing on some of them.
  mat.customProgramCacheKey = () => 'ps1-snap';
  return mat;
}

export const COMPOSITE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Ordered-dither + quantise + altitude grade.
 *
 * Quantising to a handful of levels per channel is what makes the image read
 * as 90s hardware. Dithering *before* the quantise is what stops that from
 * turning every soft gradient into ugly banding — the Bayer pattern trades
 * banding for a stable grain, which is exactly the trade the PS1 made.
 */
export const COMPOSITE_FRAG = /* glsl */ `
precision mediump float;

uniform sampler2D tDiffuse;
uniform vec2  uResolution;
uniform float uLevels;
uniform vec3  uShadowTint;
uniform vec3  uHighlightTint;
uniform float uGrade;      // 0 = ground floor, 1 = penthouse
uniform float uVignette;
uniform float uFlash;      // white-out on impact / damage
uniform vec3  uFlashColor;

varying vec2 vUv;

float bayer2(vec2 a) {
  a = floor(a);
  return fract(dot(a, vec2(0.5, a.y * 0.75)));
}
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;

  // Altitude grade: fluorescent beige at the bottom, gilded warmth at the top.
  vec3 tint = mix(uShadowTint, uHighlightTint, uGrade);
  c *= tint;

  // Damage / impact flash, applied before quantise so it dithers too.
  c = mix(c, uFlashColor, uFlash);

  // Dither then quantise.
  float d = (bayer4(gl_FragCoord.xy) - 0.5) * 0.9;
  c += d / uLevels;
  c = floor(c * uLevels + 0.5) / uLevels;

  // Cheap CRT-ish falloff. Subtle enough to survive on an OLED phone.
  vec2 v = vUv - 0.5;
  float vig = 1.0 - dot(v, v) * uVignette;
  c *= vig;

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

# UPWARD MOBILITY — orientation for Claude Code

Read this first. It routes you to the right place rather than repeating it.

## What this repo is

A vertical-screen **mobile** dungeon crawler where the dungeon is a corporate
skyscraper. three.js + TypeScript through Vite. No framework, no state library,
no test runner.

- `README.md` — **the real documentation**, and it is a design document as much
  as a technical one. It explains why the core verb is throwing, why the floor
  is a streamed quota rather than waves, what "corporate PS1" means, and what
  every setting exists for. Read it before changing gameplay: most obvious
  "improvements" are already argued through there as deliberate calls, several
  of them reversals of an earlier decision.
- `src/core/Engine.ts` — renderer, the low-res target, the composite pass.
- `src/render/ps1.ts` + `palette.ts` — the look, and the progress system.
- `src/game/Game.ts` — the loop and most tuning constants.
- README's "Tuning knobs" table maps every knob to its file. Use it instead of
  grepping.

## Commands

```bash
npm run dev     # then open the Network URL on your phone, same wifi
npm run build   # tsc --noEmit && vite build
```

`npm run build` typechecks, so it is the closest thing to a gate. **There is no
lint step and no tests** — which means the burden of proof is on you: this is a
game whose feel cannot be verified from a desk, so see "Verifying" below.

Debug affordances: `?debug=1` parks the camera at the back of the floor;
`window.game` is live in the console and `game.stats()` gives a scene census.

## The constraint everything serves: a phone, in portrait, in two minutes

Almost every non-obvious decision here follows from that, and reversing one
usually breaks something further away than it looks:

- **Render at ~400px maximum internal dimension**, upscale nearest-neighbour.
  This is the art direction *and* the performance budget — ~75k pixels a frame
  instead of ~3M is what holds framerate on a mid-tier Android. Raising
  `MAX_INTERNAL_DIM` in `core/Engine.ts` costs both at once.
- **The HUD is plain DOM over the canvas**, deliberately. Rendering text into a
  400px framebuffer means fighting it for legibility. Don't move it into three.
- **Colour is the progress bar.** `BANDS` in `render/palette.ts`, five floors
  per band. This system already shipped switched off once — the thresholds were
  15/40/75 floors, so a realistic mobile session never left band one. If you
  touch band thresholds, check them against a two-minute session, not a long
  one.
- **A floor is a streamed kill quota, not waves.** Waves cost ~6s of dead air
  per floor. That's survivable on a couch and intolerable here.
- **Settings are for things that differ between people holding a phone** —
  handedness, thumb reach, tolerance for slow-motion — not a wall of options.
  Adding one needs that justification.
- **`localStorage` is guarded and must stay guarded.** It throws outright in
  some privacy modes. The game has to come up happy on defaults; a settings
  read must never be able to prevent boot.

## Efficiency

- **Nothing allocates per frame.** Hoist scratch `Vector3`/`Matrix4`/`Quaternion`
  objects outside the loop and reuse them. A `new` inside a per-frame or
  per-entity loop is the regression to watch for, not a style nit.
- **Dispose what you construct.** three.js does not free GPU buffers on GC.
  Any `BufferGeometry`, `Texture` or `Material` you create imperatively needs a
  matching `.dispose()` when it stops being referenced. Long-lived geometry
  that gets mutated in place should be created once and reused, not recreated.
- **Share geometry and materials across instances.** Flat-shaded low-poly is
  cheap only if you are not paying per-entity for it.
- **Prefer a number over an asset.** The whole look is procedural so it can be
  retuned by changing a constant.

## Security

The surface is small — a static client, no server, no accounts, no personal
data — so the rules are short and absolute:

- **Everything in `src/` ships to the browser.** There is no server to hide
  anything behind, so there are no secrets, API keys or tokens in this repo,
  and there is nowhere to put one.
- **`localStorage` holds only this game's own settings.** Never put anything
  there you would not want a shared browser to keep.
- **Anything parsed from `localStorage` or a URL param is untrusted input.**
  `?debug=1` is read from a URL an attacker can hand a player; treat new params
  the same way, and validate rather than assume shape.

## Verifying

`npm run build` typechecks and that is all the automation there is. For anything
touching feel, movement, or the render pipeline, the honest bar is **run it on a
phone.** A change that typechecks and looks right in a desktop browser window is
not verified — portrait viewport, thumb reach and framerate on a real device are
the actual requirements, and none of them are observable from a desk. Say so
plainly when you have not been able to check.

## Commit style

Plain language, imperative, naming the actual behaviour and ideally why — e.g.
`Fix camera yaw runaway that made aiming feel fidgety`, or
`Retune scene and pace for mobile; drop the VR constraint`. Earlier history used
conventional-commits prefixes; the recent, preferred voice does not.

# UPWARD MOBILITY

A vertical-screen mobile dungeon crawler where the dungeon is a corporate
skyscraper and the dungeon crawl is your career. You start on the open-plan
floor throwing paperclips. You are trying to reach the top.

Built in three.js. Mobile-first, and no longer pretending otherwise.

---

## The one design decision everything else hangs off

**The core verb is throwing, not shooting.**

This was originally chosen so the mechanic would port to VR unchanged. That
constraint has since been dropped — the game is a mobile game — so the honest
position is that the original justification no longer applies and the verb has
to stand on its own. It does, comfortably:

The obvious alternative is the Archero/Survivor formula — drag to move,
auto-fire at the nearest enemy when you stop. It is proven and frictionless,
and it is also a game where you never make a decision with your hands. Pull
back, watch the arc, pick your moment, release: that is a decision, made
several times a second, and it is what the whole loop is built on.

It also fits the fiction. You are not a soldier with a gun. You are a guy in a
cubicle throwing office supplies. The weakness *is* the joke.

The input layer is still abstracted behind `InputState` — not for a headset
now, but because it is simply the right seam. It is what made adding a second
movement scheme a change to one function instead of a change to the game.

## Pace

A floor is a **kill quota, streamed in from ahead of you** — not a set of waves
you stand and clear.

Waves cost roughly six seconds of dead air per floor: an opening pause, a gap
between each wave, then waiting on the last straggler to wander over. That is
survivable on a couch and intolerable in a two-minute session, and it was
actively broken by auto-advance, which walks you to the lift and leaves you
jogging at a shut door. The first enemy now reaches you 0.4s into a floor.

Spawning *in front of you* matters more than it sounds. It means pressure
always arrives from the direction you are already travelling, so advancing is
the decision that costs something rather than a free ride to the lift.

Kills land with **hit-stop** — the world hard-stops for ~55ms before resuming.
It is the cheapest game-feel trick there is and it was the main thing VR was
costing us, since locking the frame is exactly what you must never do in a
headset. `Time.freeze()` bypasses the slow-mo blend so play resumes crisply
rather than easing back in.

### Time dilation on wind-up

Pulling back slows the world to 30%. This does three jobs at once: it solves
the two-thumb problem (you can stop moving to aim without instantly dying), it
makes each throw feel deliberate and heavy instead of spammy, and it reads
instantly in a six-second clip. In VR you dial the factor toward 1 and the
mechanic is otherwise unchanged.

---

## Running it

```bash
npm install
npm run dev     # then open the Network URL on your phone, same wifi
npm run build
```

- `?debug=1` parks the camera at the back of the floor to inspect the layout.
- `window.game` is exposed in the console; `game.stats()` gives a scene census.

**Controls** — one half of the screen drives, the other pulls back and
releases to throw. Which half is which is a setting. Tap the supply chip to
swap ordnance. On desktop: WASD drives, drag the mouse to throw.

### Two movement schemes

**AUTO** (default) walks you forward on your own. That thumb stops being a
direction and becomes a steering wheel: X turns, Y is a throttle that only
ever slows you down. Winding up plants your feet, so throwing is a decision to
stand still rather than something you drift through.

It's the mechanic the theme was asking for — the ladder moves you along
whether you like it or not — and it collapses two continuous jobs into one.
Steering is deliberately **locked during a wind-up**: the body turns to face
the throw, so a heading change would be invisible until you released, and
input you can't see the result of is input you can't learn.

**STICK** is the original free two-axis stick.

### Settings, and why these three

Settings exist for things that genuinely differ between people holding a
phone, not as a wall of options:

- **Movement.** AUTO advance versus the free STICK. Switchable mid-run,
  because which one feels better is not decidable from a desk.
- **Throwing hand.** A two-thumb game with a hardcoded throwing hand is
  quietly unplayable for a left-hander. This swaps which half does what.
- **Thumb reach.** Pixels of pull-back for a full-power throw. Hands are not
  a standard size, and neither are phones.
- **Time dilation.** How far the world slows during a wind-up, up to and
  including off. Some people read slow-motion as power and some read it as lag.
- **Camera turn.** How far the camera swings to face a throw once you release.
  LOCKED pins it forward for the whole run.
- **Screen shake.** Impact kick, down to off.

They persist to `localStorage`, guarded — it throws outright in some privacy
modes, and the game has to be happy with defaults.

---

## Art direction: "corporate PS1"

Flat-shaded low-poly, rendered at a maximum internal dimension of **400px** and
upscaled with a nearest-neighbour filter. Three things do the heavy lifting:

| Effect | Where | Why |
|---|---|---|
| Vertex snapping | `render/ps1.ts` | The PS1 had no floating-point rasteriser, so geometry visibly swam. Hard-edged boxes make the wobble read as intentional. |
| Ordered dither + quantise | `COMPOSITE_FRAG` | Dithering *before* quantising trades banding for stable grain — exactly the trade the hardware made. |
| Altitude colour grade | `render/palette.ts` | Colour is the progress bar. |

That last one is the system worth protecting. Fluorescent beige and grey on the
ground floors; by the penthouse everything is gold, marble and warm light. A
player should be able to screenshot any frame and guess roughly how high they
are without reading the HUD. Bands are defined in `BANDS` and selected by
`bandForFloor()`.

**Five floors per band**, so each band ends on a boss and a decent run climbs
through two or three of them. The thresholds were originally 15/40/75 floors,
which meant a realistic mobile session never left band one and the entire
colour-as-progress system was invisible in practice — a good idea that shipped
switched off.

Rendering ~75k pixels a frame instead of 3M is also why this holds framerate on
a mid-tier Android.

---

## Designing for a portrait viewport

The single biggest lesson from building this: **a tall screen starves your
horizontal FOV.** At 66° vertical on a 9:19.5 phone you get roughly 33°
horizontal. The first version of this floor was 34 units wide and you could
never see more than about 10 of them.

So the level is a corridor, not a hall: 20 wide, 46 deep, cubicle pods pulled in
to ±4.0 with cover props down the centre aisle. The camera is pitched *down*
about 17°, because a portrait viewport wants depth, not headroom — the tall
screen fills with the floor you're about to fight across, and the ceiling and
glowing window band become a bright strip along the top.

Ceiling height is 7.5 for the same reason, and because lob arcs need somewhere
to go. ### The camera model, and the bug that forced it

The camera **never rotates while you are winding up a throw**, and movement
never rotates it at all. It turns only after you release, easing toward a
stored absolute yaw.

That shape is not a style choice, it's the fix for a real bug. The camera used
to chase the aim direction every frame. But a screen-relative aim resolves to
`camYaw + thumbAngle`, so the target was defined relative to the camera's own
current yaw — and it ran away from the camera at exactly the rate the camera
chased it. It never converged. Measured: a completely motionless thumb held
off-axis spun the camera **702 degrees in three seconds**.

The general lesson is worth keeping: *never derive a camera's target from a
quantity that is itself derived from the camera.* Movement recentering had the
same defect in slower form — holding "right" made you orbit forever — which is
why movement no longer turns the camera either.

Under AUTO the camera *does* follow your heading continuously, and that is
safe for the same reason the old version wasn't: the heading is an integrated
world angle owned by the player, not a quantity derived from `camYaw`. It
converges. Measured gap between camera and heading after settling: 0.0 deg.

Aiming is also low-pass filtered (`AIM_TAU` in `core/Input.ts`) before the game
ever sees it. A thumb on glass is never still, and the release latches the
filtered value, so what the arc showed you is exactly what you throw.

Camera constants live at the top of `game/Game.ts`. They are the first thing to
tune with actual thumbs on actual glass.

---

## Layout

```
src/
  core/      Engine (renderer, low-res target, composite), Input, Time
  render/    PS1 material + composite shader, altitude palette
  game/      Game loop, Floor generator, Player, Enemy, Projectiles, physics
  ui/        DOM HUD and styles
```

The HUD is plain DOM over the canvas — rendering it in three would mean
fighting a 400px framebuffer for text legibility. This way the game stays
chunky and the type stays crisp.

---

## Tuning knobs

| What | Where |
|---|---|
| Throw arcs, damage, cooldowns, ammo | `game/supplies.ts` |
| Camera distance / height / pitch | `CAM_*` in `game/Game.ts` |
| Slow-mo strength | `SLOWMO` in `game/Game.ts` |
| Floor quota and spawn rate | `floorQuota()` / `spawnInterval()` in `game/Game.ts` |
| Hit-stop duration | `onKill()` in `game/Game.ts` |
| Enemy stats and telegraph timing | `ENEMIES` in `game/Enemy.ts` |
| Retro intensity | `VERTEX_GRID` in `render/ps1.ts`, `MAX_INTERNAL_DIM` in `core/Engine.ts`, `uLevels` |
| Floor colour bands | `BANDS` in `render/palette.ts` |

---

## Where this is going

The ladder, sketched:

| Rank | Floors | Arsenal |
|---|---|---|
| Intern | 1–5 | Paperclip, rubber band, binder clip |
| Associate | 6–15 | Stapler, three-hole punch (shotgun), red Swingline |
| Manager | 16–30 | Tape gun (slow), scalding coffee (DoT), keyboard (melee sweep) |
| Director | 31–50 | Laser pointer, projector (blinding cone of slides), **Reply All** (chain lightning) |
| VP | 51–70 | The Shredder, NDA (silences boss mechanics), **PIP** (marks an enemy to die in 10s) |
| C-Suite | 71–90 | Stock Buyback Cannon (spends your gold as ammo), Golden Parachute |
| The Top | 100 | **The Pen.** |

The Pen is the payoff. One signature and a thing ceases to exist — because at
the top of the ladder you don't fight, you *decide*. The power fantasy stops
being violence and becomes authority.

Bosses drawn from the same well: **The Quick Sync** (a meeting that spawns more
meetings), **The Micromanager** (mirrors your movement; damage scales with how
long he's been watching), **HR Business Partner** (doesn't attack — documents;
fills a case file and when it's full you're performed out), **Circle Back**
(teleports to where it just was), **Chad from Sales**.

### Built

**THE QUICK SYNC** (every 5th floor) — a meeting that could have been an
email. Every ability is the same joke told mechanically:

- **QUICK SYNC?** books time in your calendar whether you're free or not — a
  telegraphed AoE under wherever you happen to be standing, which detonates
  and spawns attendees. Standing still is the mistake.
- **AGENDA** forwards you a fan of three memos. The middle one punishes
  standing still, the outer two punish lazy strafing.
- **LET'S TAKE THIS OFFLINE** (at 70% and 35% health) goes invulnerable behind
  a ring of attendees you have to clear before anyone can get back to the
  point. The health bar turns blue rather than just freezing, so it never
  looks like your hits aren't registering.
- **CIRCLING BACK** (below 50%) rewinds it to roughly where it stood four
  seconds ago, invalidating whatever lead you were aiming.

Boss floors swap the cubicle farm for a boardroom. The conference table is
waist-high on purpose: a flat throw clips it, a lobbed one clears it, which
turns the wind-up dial into a real decision instead of "always full power".

### Near-term

- [ ] Ranged enemy ("just a quick question") to pressure the wind-up
- [ ] Audio: fluorescent hum, keyboard clatter, the stapler *chunk*
- [ ] Merge static floor geometry — currently ~320 draw calls, which is the
      real mobile ceiling before enemy count is
- [ ] More floor archetypes — server room, break room, executive corridor

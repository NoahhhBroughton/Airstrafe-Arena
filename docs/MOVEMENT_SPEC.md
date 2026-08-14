# Movement Spec

This documents the movement model to implement, based on the publicly documented mechanics behind
Source engine / Quake-family movement (the underlying math has been reverse-engineered and written
about extensively by the speedrunning/surf community — nothing here is Valve's proprietary source
code, it's the well-known algorithmic shape of the mechanic).

All movement runs at a **fixed tick rate** (e.g. 64Hz — `TICK_DT = 1/64`). Never integrate movement
against a variable render-frame delta; render interpolates between simulated ticks instead.

## Core state per player, per tick

- `position: Vec3`
- `velocity: Vec3`
- `wishDir: Vec3` — normalized direction from current input (WASD relative to view yaw), zero
  vector if no input
- `onGround: boolean` — from a downward shape cast against world collision each tick
- `viewYaw`, `viewPitch` — camera orientation, updated from mouse input, not clamped on yaw

## Ground movement

```
function groundAccelerate(vel, wishDir, wishSpeed, accel, dt):
    currentSpeed = dot(vel, wishDir)
    addSpeed = wishSpeed - currentSpeed
    if addSpeed <= 0: return vel
    accelSpeed = min(accel * wishSpeed * dt, addSpeed)
    return vel + wishDir * accelSpeed
```

Apply **friction** before accelerate, only when grounded:

```
function applyFriction(vel, friction, stopSpeed, dt):
    speed = length(vel)
    if speed < EPSILON: return vel
    control = speed < stopSpeed ? stopSpeed : speed
    drop = control * friction * dt
    newSpeed = max(speed - drop, 0)
    return vel * (newSpeed / speed)
```

Order each tick while grounded: `applyFriction` → `groundAccelerate`.

## Air movement (this is what makes bhop/strafing work)

Air acceleration uses the same `accelerate` shape but with a **much lower speed cap per axis
relative to wishDir**, which is what allows strafing to add speed beyond max ground speed when the
player alternates A/D + mouse yaw in sync:

```
function airAccelerate(vel, wishDir, wishSpeed, airAccel, dt):
    currentSpeed = dot(vel, wishDir)
    addSpeed = wishSpeed - currentSpeed
    if addSpeed <= 0: return vel
    accelSpeed = min(airAccel * wishSpeed * dt, addSpeed)
    return vel + wishDir * accelSpeed
```

Key: `wishSpeed` while airborne should be clamped low (e.g. ~30 units/s equivalent) even though
the player's actual velocity can be much higher — this is *why* strafing compounds speed instead
of just capping it like ground movement does. No friction is applied in air.

### Air acceleration is not a linear dial

`accelSpeed = min(airAccel * wishSpeed * dt, addSpeed)`, and `addSpeed` can never exceed
`wishSpeed`. So once `airAccel >= 1/dt` — 64 at our tick rate — the first term stops binding and
**every larger value behaves identically**. `sv_airaccelerate 100` and `1000` are the same
setting here; they differ in Source only because servers run different tick rates.

Below that line it is a real dial, and Source's default of 10 sits well below it: a tick could
only steer `10 * 30 * dt` = 4.7 u/s, which feels like being unable to turn in the air at all.
That is why surf and bhop servers raise it as the first thing they configure, and why this
project ships 1000 — the familiar bhop-server number, chosen for recognisability and for staying
correct if `TICK_RATE` ever rises, not because it differs from 100 today.

The consequence worth internalising: **`AIR_WISH_SPEED_CAP` is the real air-control knob**, not
`AIR_ACCEL`. Once acceleration is saturated, the cap alone decides how much velocity a tick can
add along `wishDir`, and therefore both how fast strafing compounds and how wide the range of
mouse turn rates that gain speed at all. At 75 rather than Source's ~30, strafing is
substantially more forgiving and builds speed faster; that is a deliberate departure from CS
feel, decided by playtest.

Do not clamp total velocity magnitude while airborne except at a sane upper bound for anti-cheat /
physics stability (e.g. a generous cap far above normal bhop speeds, just to prevent runaway
float errors).

## Jump

- On ground + jump input: set vertical velocity to a fixed jump impulse, do not preserve/reset
  horizontal velocity. Horizontal momentum carrying into a jump is what makes bhop chains work —
  never zero it on landing/jumping.
- **Auto-bhop is on by default** (`AUTO_BHOP_ENABLED = true`, Source's `sv_autobunnyhopping`):
  holding jump keeps you hopping. This reverses the original draft of this spec, which called
  for a fresh press per jump — that is not how surf and bhop servers play, which is the
  reference feel this project is chasing. It remains a per-player flag (`MoveOptions.autoBhop`)
  so a game mode can demand manual timing.
- Friction is skipped on the tick you jump, because the jump sets `onGround` false before the
  ground branch runs. That is deliberate and load-bearing: it is what lets a well-timed hop keep
  all its speed while a late one gets scrubbed.

## Landing

- On landing (transition airborne → grounded), do **not** reset velocity. Friction on the next
  grounded tick will naturally bleed excess speed if the player doesn't jump again — this is what
  makes "perfect bhop" (jumping the instant you land) preserve speed while mistimed landings lose
  it.
- Vertical velocity is *projected onto the ground plane*, not zeroed — see "Ramp slide" below.
  On level ground the two are identical; on a slope, only one of them pays out speed.

## Ramp slide (landing on a descending slope)

Landing is not just "stop falling." When the player contacts a surface, velocity is **projected
onto that surface's plane** — the same `clipVelocity` used for surf, applied to walkable ground:

```
velocity = clipVelocity(velocity, groundNormal)
```

On level ground the normal is straight up, so this removes exactly `velocity.y` and is
indistinguishable from zeroing it. On a slope it is not, and the difference is the whole
mechanic: the downward component gets redirected *along* the ramp, so you leave faster than you
arrived. Dropping onto a 20° descending ramp at 320 u/s horizontal with a −675 u/s fall exits at
about 504 u/s horizontal.

This is why bhopping down a slope should *gain* speed rather than lose it, and it is why the
implementation must never write `velocity.y = 0` on landing — doing so silently discards the
conversion and leaves only whatever horizontal speed already existed.

The same projection is applied on the tick's initial ground check, not just on impact, so a
player already sliding along a slope keeps their descent instead of having it flattened every
tick. When velocity is already tangent to the surface, the projection is a no-op — so the boost
naturally only pays out on actual impacts.

### Staying attached to descending ground

Movement is integrated horizontally, so on a descending surface the ground falls away by
`speed * dt * tan(angle)` each tick. Past `GROUND_CHECK_DIST` that reads as *airborne*, which
costs friction and ground acceleration, and — because jumping requires `onGround` — silently
kills auto-bhop the moment the player points downhill. After moving, if the player was grounded,
did not jump, and is not rising, probe again as far as `STEP_HEIGHT` to reattach. This is
Source's step-down, and it is what keeps you glued to slopes and stairs.

## Crouch

| Constant | Value | Notes |
|---|---|---|
| `PLAYER_DUCK_HEIGHT` | 54 | Ducked hull, matching CS's 54 of 72 |
| `PLAYER_DUCK_EYE_HEIGHT` | 46 | |
| `DUCK_HEIGHT_GAIN` | 18 | `PLAYER_HEIGHT - PLAYER_DUCK_HEIGHT`; also equals `STEP_HEIGHT` |
| `DUCK_TRANSITION_TIME` | 0.2s | Ground only — airborne ducking is instant |
| `DUCK_SPEED_SCALE` | 1/3 | Ducked ground speed, as a fraction of `MAX_GROUND_SPEED` |

`duck` is a continuous 0…1 on the player state, not a boolean, so the hull can animate and the
camera can follow it without teleporting.

**The asymmetry is the mechanic.** On the ground, the hull shrinks downward from the head and
the feet stay planted. In the air it is the reverse: the head holds its arc and the *feet snap
up* to meet it, so `position.y` (which is the feet) rises by `DUCK_HEIGHT_GAIN`. That is the
crouch-jump — it clears 18 units more than a plain jump. It is instant rather than easing over
`DUCK_TRANSITION_TIME`, because the timing window for tucking your legs mid-jump is what makes
it a skill rather than a free bonus.

Standing back up must check for room, or the player grows into whatever they crouched under: on
the ground, sweep the ducked hull upward by the height difference; in the air, sweep it *down*
by the same amount, since that is where the feet are about to go.

Ducking scales ground speed only. Applying it airborne would make a crouch-jump cost air
control, turning a movement technique into a penalty.

## Surf

Surf ramps are just world geometry (angled collision planes) — no special-cased "surf mode."
The mechanic emerges from:

1. Player is airborne against an angled surface (shape cast detects a near-contact, but the
   surface normal's angle vs. up is too steep to count as "ground" for friction/accelerate
   purposes — define a `groundNormalMinY` threshold, e.g. surfaces with normal.y below ~0.7 are
   "not ground").
2. Velocity is clipped against the surface plane each tick (standard "slide along surface" vector
   projection) rather than zeroed on contact.
3. Air acceleration (above) still applies while sliding, which is what lets the player gain speed
   down a surf ramp by strafing into it.

```
function clipVelocity(vel, normal, overbounce = 1.0):
    backoff = dot(vel, normal) * overbounce
    return vel - normal * backoff
```

## Tuning constants (starting points — expect to iterate)

| Constant | Starting value | Notes |
|---|---|---|
| `GROUND_ACCEL` | 10 | |
| `AIR_ACCEL` | **1000** | Source's `sv_airaccelerate`. See "Air acceleration is not a linear dial" below |
| `AIR_WISH_SPEED_CAP` | **75** units/s | The real air-control dial. Well above Source's ~30 — see below |
| `MAX_GROUND_SPEED` | ~320 units/s | CS-like walk/run speed reference |
| `FRICTION` | 4 | |
| `STOP_SPEED` | 100 | Below this, friction stopping power doesn't scale down further |
| `JUMP_IMPULSE` | **382** | Apex is `impulse^2 / 2g` = 91 units, twice Source's ~45 |
| `GRAVITY` | 800 units/s² | |
| `GROUND_NORMAL_MIN_Y` | 0.7 | cos of ~45°; surfaces steeper than this are "surf," not "ground" |

Units above follow Source-convention relative scaling (not meters) — pick a concrete unit system
early (recommend: 1 unit ≈ 1 inch, matching Source, since most public tuning references use it)
and keep world geometry scaled consistently to it.

**Unit system: settled.** 1 unit ≈ 1 inch, Y-up (Three.js convention, *not* Source's Z-up — so
a surface normal's "up" component is `normal.y` here). `JUMP_IMPULSE` 270 against `GRAVITY` 800
gives a jump apex of 270²/1600 ≈ 45.6 units, matching the target above.

### Collision shape and integration

| Constant | Value | Notes |
|---|---|---|
| `PLAYER_HEIGHT` / `PLAYER_RADIUS` | 72 / 16 | Capsule, roughly Source's 32×32×72 hull |
| `PLAYER_EYE_HEIGHT` | 64 | Camera height above the feet |
| `STEP_HEIGHT` | 18 | Max ledge walked over without jumping (Source uses 18) |
| `SKIN_WIDTH` | 0.1 | Gap kept between capsule and geometry on every cast |
| `GROUND_CHECK_DIST` | 2 | How far below the feet the ground probe looks |
| `MAX_MOVE_ITERATIONS` | 4 | Slide iterations per tick (Quake used 4) |
| `MAX_CLIP_PLANES` | 5 | Distinct surfaces clipped against in one tick |
| `MAX_VELOCITY` | 3500 | Sanity ceiling only — see "Air movement" above |

Player **position is the feet** (bottom of the capsule), not its center. Collision uses capsule
shape casts rather than an AABB: an AABB's corners catch on the seams between ramp brushes,
which a surf ramp is made of.

### Two things that are not obvious but are load-bearing

Both were found by the player getting stuck rather than by reading the formulas, and both will
silently reappear if the collision layer is ever rewritten:

1. **Multi-plane clipping.** Clipping velocity against one surface at a time is not enough. In a
   corner, sliding along plane A drives into plane B, whose clip drives back into A, and the
   player jitters in place. Clip against the *set* of planes touched this tick, keeping the first
   result that violates none of the others; with exactly two planes and no single-plane solution,
   project onto their crease. Two contacts with the same normal must not both be recorded — a
   duplicated plane "violates" itself and collapses the crease to a zero vector, which reads
   in-game as the player stopping dead partway down a ramp.

2. **The ground probe needs clearance on two axes.** It is swept from `GROUND_PROBE_LIFT` (1)
   above the feet with the capsule narrowed by `GROUND_PROBE_SHRINK` (2). Without the lift, a
   player resting on the floor starts the cast already inside contact range and the shape cast
   degenerates, returning an arbitrary normal instead of the floor's. Without the shrink, a
   player pressed against a wall catches the wall's bottom corner first and gets a ~45° normal,
   reads as airborne, and cannot jump — which breaks bhopping any tight course.

## Mouse input

Air strafing is a mouse technique before it is a movement technique — the speed you gain is set
by how closely your turn rate tracks the optimum. So view input is part of this spec, not a
separate UI concern.

Sensitivity uses Source's formula exactly: `degrees = m_yaw * sensitivity * rawCounts`, with
`m_yaw` defaulting to 0.022. Sensitivity 1 here therefore turns the same arc as sensitivity 1 in
CS — **but only if the deltas are raw**. Pointer lock's `movementX` is normally the *accelerated*
cursor delta, so a fast flick covers more angle than the same distance moved slowly, and no
single sensitivity number can match Source because the relationship isn't linear. The client
requests `requestPointerLock({ unadjustedMovement: true })` to bypass the OS acceleration curve,
and falls back to an ordinary lock if the browser refuses. The settings screen reports which one
you actually got, because it decides whether the number means anything.

For reference, the optimal turn rate while strafing is roughly
`accelSpeed / speed` radians per tick — about 54°/s at 320 u/s with the default constants, and it
*falls* as you speed up. This is why bhop chains need progressively gentler mouse movement.

## Testing movement in isolation

Because `groundAccelerate`, `airAccelerate`, `applyFriction`, and `clipVelocity` are pure
functions in `packages/shared`, write unit tests for them directly (fixed input velocity + wishDir
→ expected output) before ever touching a renderer. This is the fastest way to verify tuning
changes don't break invariants (e.g. "strafing at a fixed optimal angle increases speed each
tick while airborne").

The whole per-tick step is testable the same way. `movePlayer` takes a `CollisionWorld`
interface — two methods' worth of shape casting — rather than a physics engine, so tests drive
it against hand-written worlds (an infinite plane at a given tilt, an empty void, a spy that
records what was cast) with no Rapier or WASM involved. Keep it that way: the moment movement
imports a physics engine directly, it stops being testable and stops being shareable with the
server.

A note on what a test can and cannot show here. On a surf ramp, gravity's pull along the slope
is ~655 u/s² against a 30 u/s air-speed cap, so total speed is useless for detecting whether air
control is working — it's swamped. Pick an axis the forces don't touch: a ramp tilted about Z has
a normal with no Z component, and gravity has none either, so *all* change in `velocity.z` is
airAccelerate's doing and can be asserted exactly.

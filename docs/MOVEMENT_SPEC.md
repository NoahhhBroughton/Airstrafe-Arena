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

Do not clamp total velocity magnitude while airborne except at a sane upper bound for anti-cheat /
physics stability (e.g. a generous cap far above normal bhop speeds, just to prevent runaway
float errors).

## Jump

- On ground + jump input: set vertical velocity to a fixed jump impulse, do not preserve/reset
  horizontal velocity. Horizontal momentum carrying into a jump is what makes bhop chains work —
  never zero it on landing/jumping.
- No auto-bhop by default (require a fresh press per jump) — but keep this as a named constant/
  config flag, since some servers/game modes may want to toggle it.

## Landing

- On landing (transition airborne → grounded), do **not** reset velocity. Friction on the next
  grounded tick will naturally bleed excess speed if the player doesn't jump again — this is what
  makes "perfect bhop" (jumping the instant you land) preserve speed while mistimed landings lose
  it.

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
| `AIR_ACCEL` | 10 | Same accel constant as ground; the airborne `wishSpeed` cap is what differs |
| `AIR_WISH_SPEED_CAP` | ~30 units/s | Low cap is what makes strafing compound speed |
| `MAX_GROUND_SPEED` | ~320 units/s | CS-like walk/run speed reference |
| `FRICTION` | 4 | |
| `STOP_SPEED` | 100 | Below this, friction stopping power doesn't scale down further |
| `JUMP_IMPULSE` | tuned to reach a specific jump height, e.g. ~45 units | |
| `GRAVITY` | 800 units/s² | |
| `GROUND_NORMAL_MIN_Y` | 0.7 | cos of ~45°; surfaces steeper than this are "surf," not "ground" |

Units above follow Source-convention relative scaling (not meters) — pick a concrete unit system
early (recommend: 1 unit ≈ 1 inch, matching Source, since most public tuning references use it)
and keep world geometry scaled consistently to it.

## Testing movement in isolation

Because `groundAccelerate`, `airAccelerate`, `applyFriction`, and `clipVelocity` are pure
functions in `packages/shared`, write unit tests for them directly (fixed input velocity + wishDir
→ expected output) before ever touching a renderer. This is the fastest way to verify tuning
changes don't break invariants (e.g. "strafing at a fixed optimal angle increases speed each
tick while airborne").

// Movement tuning constants. See docs/MOVEMENT_SPEC.md for the reasoning behind each value.
// Units follow Source-convention scaling (roughly 1 unit ~= 1 inch). Keep world geometry
// scaled consistently to this so the constants below stay meaningful.

export const TICK_RATE = 64;
export const TICK_DT = 1 / TICK_RATE;

export const GROUND_ACCEL = 10;

/**
 * Air acceleration - Source's `sv_airaccelerate`.
 *
 * Source ships 10, and surf/bhop servers raise it as the first thing they do: combat surf runs
 * ~100, bhop servers ~1000. At 10 a tick can only steer AIR_ACCEL * AIR_WISH_SPEED_CAP * dt =
 * 4.7 u/s, so mid-air turning is sluggish and strafing barely compounds - which is exactly what
 * "can't properly turn in the air" feels like.
 *
 * There is a ceiling worth knowing about. accelSpeed is min(accel * wishSpeed * dt, addSpeed),
 * and addSpeed can never exceed wishSpeed, so once accel >= 1/dt (64 at our tick rate) the
 * first term stops binding and every larger value behaves identically. 1000 is far past that
 * line - it is the familiar bhop-server number rather than a distinct feel from, say, 100, and
 * it stays correct if TICK_RATE ever rises. Below 64 it is a real dial. This also means the
 * meaningful knob for air control is AIR_WISH_SPEED_CAP, not this.
 */
export const AIR_ACCEL = 1000;

/**
 * Airborne wishSpeed ceiling - the actual air-control dial, given AIR_ACCEL is saturated.
 * Each tick can add up to (this - dot(velocity, wishDir)) along wishDir, so raising it both
 * speeds up how fast strafing compounds and widens the range of mouse turn rates that gain
 * speed at all. 75 is well above Source's ~30; it trades some of the precision-timing
 * character for a much more forgiving strafe.
 */
export const AIR_WISH_SPEED_CAP = 75;
export const MAX_GROUND_SPEED = 320;
export const FRICTION = 4;
export const STOP_SPEED = 100;
/**
 * Apex height is JUMP_IMPULSE^2 / (2 * GRAVITY), so height scales with the *square* of this -
 * tripling the jump means multiplying the impulse by sqrt(3), not by 3.
 *
 * 468 gives 468^2 / 1600 = 137 units, three times Source's ~45. Airtime roughly doubles too
 * (2 * v / g, so 1.17s against 0.68s), which is worth knowing when tuning course spacing: a
 * jump now covers about 375 units of ground at walk speed rather than 216.
 */
export const JUMP_IMPULSE = 468;
export const GRAVITY = 800;

// cos of ~45 degrees. Surfaces with a normal.y below this are treated as "surf," not "ground" -
// they don't get friction/ground-accelerate, and velocity is clipped along them instead.
export const GROUND_NORMAL_MIN_Y = 0.7;

/**
 * Hold jump to keep bhopping, instead of needing a fresh press per jump - Source's
 * `sv_autobunnyhopping`. On, because that is what surf and bhop servers run and what chaining
 * jumps is expected to feel like. Still a flag, not a hard rule: a game mode that wants manual
 * jump timing can turn it off per-player (see MoveOptions).
 */
export const AUTO_BHOP_ENABLED = true;

// --- Player collision shape -------------------------------------------------------------

// Capsule roughly matching Source's 32x32x72 player hull. A capsule rather than an AABB
// because shape-casting a capsule against angled geometry produces clean slide normals, which
// is what surf depends on - an AABB's corners catch on ramp seams.
export const PLAYER_RADIUS = 16;
export const PLAYER_HEIGHT = 72;
/** Camera height above the player's feet. Source uses 64 of a 72-unit hull. */
export const PLAYER_EYE_HEIGHT = 64;

// --- Collision / integration ------------------------------------------------------------

/** Max height the player is teleported up over when walking into a small ledge (Source: 18). */
export const STEP_HEIGHT = 18;

/** How far below the feet to look for ground each tick. Small, or we snap to distant floors. */
export const GROUND_CHECK_DIST = 2;

/**
 * Radius reduction applied to the downward ground probe only. Keeps the probe from clipping the
 * bottom edge of a wall the player is pressed against - see CollisionWorld.castPlayer. The cost
 * is that ground state persists for the last couple of units past a ledge lip, which on a
 * 16-unit radius is imperceptible.
 */
export const GROUND_PROBE_SHRINK = 2;

/**
 * Height the ground probe starts above the feet, subtracted back out of the result.
 *
 * A player resting on the floor sits within SKIN_WIDTH of it, so a probe starting at the feet
 * begins already inside contact range and the shape cast degenerates: it returns a zero-length
 * hit whose normal points at whatever feature it happened to resolve, often a nearby wall's
 * corner rather than the floor. Starting the sweep clear of the surface makes the result a real
 * measurement instead.
 */
export const GROUND_PROBE_LIFT = 1;

/**
 * Gap the movement code keeps between the player capsule and world geometry.
 *
 * Shape casts themselves report *exact* contact; this gap is maintained by movement, which
 * backs off along the surface normal after every impact and rests the feet this far above the
 * floor. The two must not be the same quantity. When casts instead treated "within SKIN_WIDTH"
 * as a hit, a player standing on the floor sat exactly on that threshold, so each horizontal
 * sweep resolved arbitrarily to hit or miss - and the hits carried a meaningless normal (near
 * horizontal, on flat ground). Clipping velocity against those bogus normals fed upward and
 * sideways speed in a little at a time until the player launched off level ground.
 */
export const SKIN_WIDTH = 0.1;

/** Slide iterations per tick. Quake used 4; enough to resolve a floor+wall+wall corner. */
export const MAX_MOVE_ITERATIONS = 4;

/** Distinct surfaces the velocity can be clipped against in one tick before we give up. */
export const MAX_CLIP_PLANES = 5;

/**
 * Absolute speed ceiling. Not a gameplay cap - normal bhop chains stay far below this. It only
 * exists so a physics glitch or a hostile client can't produce a velocity that overflows into
 * float garbage and desyncs prediction. See MOVEMENT_SPEC.md "Air movement".
 */
export const MAX_VELOCITY = 3500;

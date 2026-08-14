// The authoritative player movement step: (state, input, world) -> state.
//
// This function is the reason packages/shared exists. The client runs it for prediction and the
// server runs it for authority, and reconciliation replay (docs/ARCHITECTURE.md) only converges
// if both sides get bit-identical results. So: no randomness, no wall-clock time, no reads of
// anything outside the arguments. Everything it needs about the world arrives through the
// CollisionWorld interface.

import { vec3, type Vec3 } from "./vec3.js";
import type { CollisionWorld } from "./collision.js";
import {
  applyFriction,
  groundAccelerate,
  airAccelerate,
  airWishSpeed,
  clipVelocityAgainstPlanes,
  PARALLEL_PLANE_DOT,
} from "./movement.js";
import {
  AUTO_BHOP_ENABLED,
  GRAVITY,
  GROUND_CHECK_DIST,
  GROUND_NORMAL_MIN_Y,
  GROUND_PROBE_LIFT,
  GROUND_PROBE_SHRINK,
  JUMP_IMPULSE,
  MAX_CLIP_PLANES,
  MAX_GROUND_SPEED,
  MAX_MOVE_ITERATIONS,
  MAX_VELOCITY,
  SKIN_WIDTH,
  STEP_HEIGHT,
} from "./constants.js";

const EPSILON = 1e-6;

export interface PlayerState {
  /** Feet position - the bottom of the collision capsule, not its center. */
  position: Vec3;
  velocity: Vec3;
  onGround: boolean;
  /** Normal of the surface being stood on. Meaningless while onGround is false. */
  groundNormal: Vec3;
  /**
   * Whether jump was held on the previous tick. Part of the state rather than a client-side
   * detail because auto-bhop-off means "jump" is an edge, not a level, and replayed inputs
   * during reconciliation have to see the same edge the original simulation did.
   */
  jumpHeld: boolean;
}

export interface PlayerInput {
  /** -1 back .. +1 forward. */
  forward: number;
  /** -1 left .. +1 right. */
  right: number;
  jump: boolean;
  /** View yaw in radians. Movement uses yaw only - looking up does not slow you down. */
  yaw: number;
}

export interface MoveOptions {
  autoBhop?: boolean;
}

export function createPlayerState(position: Vec3): PlayerState {
  return {
    position: vec3.clone(position),
    velocity: vec3.zero(),
    onGround: false,
    groundNormal: vec3.up(),
    jumpHeld: false,
  };
}

/**
 * Convert WASD input into a normalized world-space direction, using view yaw only.
 *
 * Yaw 0 faces -Z, matching Three.js's default camera orientation, so the client can feed the
 * camera's yaw straight in without a conversion step that could drift from the server's.
 */
export function wishDirection(input: PlayerInput): Vec3 {
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  const forward: Vec3 = { x: -sin, y: 0, z: -cos };
  const right: Vec3 = { x: cos, y: 0, z: -sin };
  return vec3.normalize({
    x: forward.x * input.forward + right.x * input.right,
    y: 0,
    z: forward.z * input.forward + right.z * input.right,
  });
}

interface GroundProbe {
  normal: Vec3;
  /** Gap between the feet and the floor, so the caller can close it. */
  distance: number;
}

/**
 * Downward probe for a walkable floor. Returns null when airborne or over a too-steep face.
 *
 * Swept from GROUND_PROBE_LIFT above the feet with a slightly narrowed shape, so the cast
 * starts clear of both the floor underneath and any wall alongside - see the two constants for
 * why each is needed.
 */
function probeGround(position: Vec3, world: CollisionWorld): GroundProbe | null {
  const start = { x: position.x, y: position.y + GROUND_PROBE_LIFT, z: position.z };
  const length = GROUND_PROBE_LIFT + GROUND_CHECK_DIST;

  const hit = world.castPlayer(start, { x: 0, y: -length, z: 0 }, GROUND_PROBE_SHRINK);
  if (!hit) return null;
  // A surf ramp registers a hit here too - it just isn't steep-enough-side-up to be "ground."
  // Rejecting it is what keeps friction and ground-accelerate off while surfing.
  if (hit.normal.y < GROUND_NORMAL_MIN_Y) return null;

  // Take the lift back off, leaving the gap between the feet and where they should rest.
  return { normal: hit.normal, distance: Math.max(hit.fraction * length - GROUND_PROBE_LIFT, 0) };
}

interface SlideResult {
  position: Vec3;
  velocity: Vec3;
}

/**
 * Move by velocity * dt, sliding along whatever is hit rather than stopping at it.
 *
 * Velocity is deliberately *not* zeroed on contact - clipping it into the surface plane is what
 * turns a steep ramp into a surf ramp instead of a wall (MOVEMENT_SPEC.md "Surf").
 */
function slideMove(
  position: Vec3,
  velocity: Vec3,
  dt: number,
  world: CollisionWorld,
): SlideResult {
  let pos = position;
  let vel = velocity;
  const planes: Vec3[] = [];
  let timeLeft = dt;

  for (let bump = 0; bump < MAX_MOVE_ITERATIONS; bump++) {
    if (timeLeft <= EPSILON || vec3.lengthSq(vel) < EPSILON) break;

    const delta = vec3.scale(vel, timeLeft);
    const hit = world.castPlayer(pos, delta);

    if (!hit) {
      pos = vec3.add(pos, delta);
      break;
    }

    if (hit.fraction > 0) {
      pos = vec3.scaleAndAdd(pos, delta, hit.fraction);
    } else {
      // Zero-fraction hit: we started the sweep already touching this surface, usually because
      // the previous iteration clipped velocity exactly tangent to it. Without a nudge the
      // sweep reports the same contact forever, burns all four iterations making no progress,
      // and the player stops dead partway down a ramp. Lift clear along the normal - well
      // under GROUND_CHECK_DIST, so it cannot shake a genuine ground contact loose.
      pos = vec3.scaleAndAdd(pos, hit.normal, SKIN_WIDTH);
    }
    timeLeft -= timeLeft * hit.fraction;

    if (planes.length >= MAX_CLIP_PLANES) {
      vel = vec3.zero();
      break;
    }
    // Grazing the same surface on consecutive iterations would otherwise record it twice, and
    // two copies of one plane mutually "violate" each other in clipVelocityAgainstPlanes -
    // which then falls through to a degenerate crease and zeroes the velocity.
    const alreadyKnown = planes.some(
      (p) => vec3.dot(p, hit.normal) > PARALLEL_PLANE_DOT,
    );
    if (!alreadyKnown) planes.push(hit.normal);

    const clipped = clipVelocityAgainstPlanes(vel, planes);
    if (!clipped) {
      vel = vec3.zero();
      break;
    }
    // If clipping reversed us relative to where we were heading, we're in a wedge that would
    // otherwise oscillate the player back and forth. Stop instead.
    if (vec3.dot(clipped, velocity) <= 0) {
      vel = vec3.zero();
      break;
    }
    vel = clipped;
  }

  return { position: pos, velocity: vel };
}

/** Sweep along `delta` and stop just short of contact, keeping the skin gap intact. */
function sweep(position: Vec3, delta: Vec3, world: CollisionWorld): Vec3 {
  const hit = world.castPlayer(position, delta);
  if (!hit) return vec3.add(position, delta);
  return vec3.scaleAndAdd(position, delta, hit.fraction);
}

/**
 * slideMove, plus Source-style stair stepping.
 *
 * Without this, walking into a curb stops the player dead, because a curb is just a wall to the
 * slide solver. Try the move normally and also try it lifted by STEP_HEIGHT, then keep whichever
 * covered more horizontal ground. Only from the ground - stepping mid-air would let players
 * climb walls.
 */
function stepMove(
  position: Vec3,
  velocity: Vec3,
  dt: number,
  world: CollisionWorld,
): SlideResult {
  const flat = slideMove(position, velocity, dt, world);
  if (!velocity.x && !velocity.z) return flat;

  const up = sweep(position, { x: 0, y: STEP_HEIGHT, z: 0 }, world);
  const stepped = slideMove(up, velocity, dt, world);
  const down = world.castPlayer(stepped.position, { x: 0, y: -STEP_HEIGHT, z: 0 });

  // Landed on nothing, or on something too steep to stand on: the step was into thin air or
  // onto a ramp face, neither of which should be treated as a stair.
  if (!down || down.normal.y < GROUND_NORMAL_MIN_Y) return flat;

  const landed = vec3.scaleAndAdd(stepped.position, { x: 0, y: -STEP_HEIGHT, z: 0 }, down.fraction);

  const flatDist =
    (flat.position.x - position.x) ** 2 + (flat.position.z - position.z) ** 2;
  const stepDist = (landed.x - position.x) ** 2 + (landed.z - position.z) ** 2;
  if (stepDist <= flatDist) return flat;

  // Keep the stepped path's velocity, but not any downward component picked up on the way
  // down - the player walked up a stair, they shouldn't accelerate into the floor.
  return {
    position: landed,
    velocity: { x: stepped.velocity.x, y: Math.max(stepped.velocity.y, 0), z: stepped.velocity.z },
  };
}

/** One fixed simulation tick. Pure: does not mutate `state`. */
export function movePlayer(
  state: PlayerState,
  input: PlayerInput,
  world: CollisionWorld,
  dt: number,
  options: MoveOptions = {},
): PlayerState {
  const autoBhop = options.autoBhop ?? AUTO_BHOP_ENABLED;

  let velocity = vec3.clone(state.velocity);
  let position = vec3.clone(state.position);

  // 1. Where are we standing? Skip the probe while moving up, or a jump's first tick would
  //    immediately re-detect the floor it just left and cancel itself.
  let ground = velocity.y > 0 ? null : probeGround(position, world);
  let onGround = ground !== null;

  if (onGround && velocity.y < 0) velocity.y = 0;

  // 2. Jump. Horizontal velocity is untouched on purpose - carrying it through the jump is the
  //    entire basis of a bhop chain (MOVEMENT_SPEC.md "Jump").
  const wantsJump = input.jump && (autoBhop || !state.jumpHeld);
  if (onGround && wantsJump) {
    velocity.y = JUMP_IMPULSE;
    onGround = false;
    ground = null;
  }

  // 3. Accelerate.
  const wishDir = wishDirection(input);
  const inputMagnitude = Math.min(
    1,
    Math.hypot(input.forward, input.right),
  );

  if (onGround) {
    velocity = applyFriction(velocity, dt);
    velocity = groundAccelerate(velocity, wishDir, MAX_GROUND_SPEED * inputMagnitude, dt);
  } else {
    velocity = airAccelerate(
      velocity,
      wishDir,
      dt,
      airWishSpeed(MAX_GROUND_SPEED * inputMagnitude),
    );
  }

  // 4. Gravity, split either side of the move. A full step before or after biases jump height
  //    by g*dt^2/2 per tick; splitting it makes the arc match the analytic height instead, so
  //    JUMP_IMPULSE/GRAVITY tuning means what MOVEMENT_SPEC.md says it means.
  if (!onGround) velocity.y -= GRAVITY * dt * 0.5;

  // 5. Integrate.
  const moved = onGround
    ? stepMove(position, velocity, dt, world)
    : slideMove(position, velocity, dt, world);
  position = moved.position;
  velocity = moved.velocity;

  if (!onGround) velocity.y -= GRAVITY * dt * 0.5;

  // 6. Re-check ground so the returned state reflects where the player actually ended up -
  //    the renderer, the HUD, and next tick's jump check all read this.
  const landedProbe = velocity.y > 0 ? null : probeGround(position, world);
  const landed = landedProbe !== null;
  if (landedProbe) {
    // Close the gap to the floor. Without this the player rests wherever the probe first found
    // ground - up to GROUND_CHECK_DIST in the air - and visibly hovers, worse on every stair
    // and slope since the gap varies with approach speed.
    position = { x: position.x, y: position.y - landedProbe.distance, z: position.z };
  }
  // Landing deliberately does not touch horizontal velocity. Friction on the next grounded tick
  // bleeds it off instead, which is what makes a frame-perfect bhop keep speed and a late one
  // lose it (MOVEMENT_SPEC.md "Landing").
  if (landed && velocity.y < 0) velocity.y = 0;

  const speed = vec3.length(velocity);
  if (speed > MAX_VELOCITY) velocity = vec3.scale(velocity, MAX_VELOCITY / speed);

  return {
    position,
    velocity,
    onGround: landed,
    groundNormal: landedProbe?.normal ?? vec3.up(),
    jumpHeld: input.jump,
  };
}

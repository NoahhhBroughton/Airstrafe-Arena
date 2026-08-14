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

/**
 * Per-call overrides for the tuning constants that change how movement *feels*. Anything
 * omitted falls back to the value in constants.ts, which stays the source of truth.
 *
 * These exist so a tuning UI can turn a knob and feel the result immediately rather than
 * rebuilding. In Phase 3 the server owns these values and sends them to the client - a client
 * that picks its own air acceleration is a client that can outrun everyone else.
 */
export interface MoveOptions {
  autoBhop?: boolean;
  airAccel?: number;
  airWishSpeedCap?: number;
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
  /**
   * How far to move the feet to sit exactly SKIN_WIDTH above the floor. Usually positive
   * (settle down onto it); slightly negative when the feet ended up flush against or inside
   * the surface, in which case the player is nudged back out to the resting gap.
   */
  distance: number;
}

/**
 * Downward probe for a walkable floor. Returns null when airborne or over a too-steep face.
 *
 * Swept from GROUND_PROBE_LIFT above the feet with a slightly narrowed shape, so the cast
 * starts clear of both the floor underneath and any wall alongside - see the two constants for
 * why each is needed.
 */
function probeGround(
  position: Vec3,
  world: CollisionWorld,
  distance = GROUND_CHECK_DIST,
): GroundProbe | null {
  const start = { x: position.x, y: position.y + GROUND_PROBE_LIFT, z: position.z };
  const length = GROUND_PROBE_LIFT + distance;

  const hit = world.castPlayer(start, { x: 0, y: -length, z: 0 }, GROUND_PROBE_SHRINK);
  if (!hit) return null;
  // A surf ramp registers a hit here too - it just isn't steep-enough-side-up to be "ground."
  // Rejecting it is what keeps friction and ground-accelerate off while surfing.
  if (hit.normal.y < GROUND_NORMAL_MIN_Y) return null;

  // Take the lift back off, then hold the feet SKIN_WIDTH clear of the surface rather than on
  // it. Allowed to go slightly negative so a player resting flush is lifted back to the gap -
  // bounded by SKIN_WIDTH, far too small to push anyone through a ceiling.
  const toContact = hit.fraction * length - GROUND_PROBE_LIFT;
  return {
    normal: hit.normal,
    distance: Math.max(toContact - SKIN_WIDTH, -SKIN_WIDTH),
  };
}

interface SlideResult {
  position: Vec3;
  velocity: Vec3;
  /**
   * Whether a surface actually opposed the motion, as opposed to merely being touched.
   *
   * The distinction matters because the floor you are standing on registers as a contact on
   * every horizontal sweep - the capsule rests within the cast's contact tolerance. Treating
   * that as an obstruction makes the caller try to step over the ground it is already on.
   */
  blocked: boolean;
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
  let blocked = false;
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

    // Only a surface we are moving *into* can stop us. A surface we are sliding along - most
    // often the floor, during ordinary walking - is contact without obstruction.
    if (vec3.dot(vel, hit.normal) < -EPSILON) blocked = true;

    if (hit.fraction > 0) {
      pos = vec3.scaleAndAdd(pos, delta, hit.fraction);
    }
    // Always come to rest SKIN_WIDTH clear of whatever we touched, rather than flush against
    // it. Sitting exactly on a surface makes the next sweep start at zero distance, where the
    // contact resolves arbitrarily and its normal is meaningless. It also guarantees progress
    // out of a zero-fraction graze, which would otherwise repeat until the iterations run out
    // and leave the player stopped dead partway down a ramp.
    pos = vec3.scaleAndAdd(pos, hit.normal, SKIN_WIDTH);
    timeLeft -= timeLeft * hit.fraction;

    if (planes.length >= MAX_CLIP_PLANES) {
      vel = vec3.zero();
      blocked = true;
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
      blocked = true;
      break;
    }
    // If clipping reversed us relative to where we were heading, we're in a wedge that would
    // otherwise oscillate the player back and forth. Stop instead.
    if (vec3.dot(clipped, velocity) <= 0) {
      vel = vec3.zero();
      blocked = true;
      break;
    }
    vel = clipped;
  }

  return { position: pos, velocity: vel, blocked };
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

  // Nothing stopped us, so there is nothing to step over. Skipping here is not just an
  // optimisation: on open ground the flat sweep grazes the floor, and attempting a step anyway
  // meant lifting the capsule STEP_HEIGHT, sliding, and dropping it again every single tick.
  // The drop rarely landed at exactly the original height, so the player crept upward and
  // flickered in and out of ground state while simply walking in a straight line.
  if (!flat.blocked) return flat;

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
    blocked: stepped.blocked,
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

  // 1. Where are we standing? Note this asks the world, not the velocity: walking up a slope
  //    leaves velocity clipped *along* it and therefore rising, and treating "moving upward"
  //    as "airborne" would drop friction and ground acceleration for the whole climb.
  let ground = probeGround(position, world);
  let onGround = ground !== null;
  /** Ground state before the jump can clear it - the step-down at the end keys off this. */
  const wasOnGround = onGround;

  if (onGround && velocity.y < 0) velocity.y = 0;

  // 2. Jump. Horizontal velocity is untouched on purpose - carrying it through the jump is the
  //    entire basis of a bhop chain (MOVEMENT_SPEC.md "Jump").
  const wantsJump = input.jump && (autoBhop || !state.jumpHeld);
  const jumped = onGround && wantsJump;
  if (jumped) {
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
      airWishSpeed(MAX_GROUND_SPEED * inputMagnitude, options.airWishSpeedCap),
      options.airAccel,
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
  // Skip entirely on the tick we jumped, or the probe re-finds the floor we just left and
  // cancels the jump before it starts.
  let landedProbe = jumped ? null : probeGround(position, world);

  // Step down. Walking is integrated horizontally, so on any descending surface the ground
  // falls away underneath you: at speed v on a slope of angle a, each tick drops v * dt * tan(a)
  // below where you were. Past GROUND_CHECK_DIST that reads as *airborne* - which costs friction
  // and ground acceleration, and (because a jump needs onGround) silently kills auto-bhop the
  // moment you point yourself downhill. Reaching further down to reattach is what keeps you
  // glued to slopes and stairs. Only when already grounded and not on the way up, so it can
  // never yank a jump back to the floor.
  if (!landedProbe && wasOnGround && !jumped && velocity.y <= 0) {
    landedProbe = probeGround(position, world, STEP_HEIGHT);
  }

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

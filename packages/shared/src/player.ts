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
  clipVelocity,
  clipVelocityAgainstPlanes,
  PARALLEL_PLANE_DOT,
} from "./movement.js";
import {
  AUTO_BHOP_ENABLED,
  DUCK_HEIGHT_GAIN,
  DUCK_SPEED_SCALE,
  DUCK_TRANSITION_TIME,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_CHECK_DIST,
  GROUND_NORMAL_MIN_Y,
  GROUND_PROBE_LIFT,
  GROUND_PROBE_SHRINK,
  JUMP_IMPULSE,
  LURCH_COOLDOWN,
  LURCH_ENABLED,
  LURCH_MAX_ANGLE,
  LURCH_MIN_SPEED,
  LURCH_SPEED_RETENTION,
  MAX_CLIP_PLANES,
  MAX_GROUND_SPEED,
  MAX_MOVE_ITERATIONS,
  MAX_VELOCITY,
  PLAYER_DUCK_EYE_HEIGHT,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  SKIN_WIDTH,
  SLIDE_ENABLED,
  SLIDE_END_SPEED,
  SLIDE_FRICTION,
  SLIDE_MIN_SPEED,
  SLIDE_STEER_ACCEL,
  SLIDE_STEER_SPEED,
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
  /**
   * How ducked the player is, 0 (standing) to 1 (fully ducked). Continuous rather than a
   * boolean so the hull can animate down on the ground, and so the eye can follow it without
   * the camera teleporting.
   */
  duck: number;
  /** Currently sliding. Entered by landing on crouch with speed; see MOVEMENT_SPEC.md. */
  sliding: boolean;
  /**
   * Strafe axis on the previous tick. Lurch fires on the *edge* of a strafe press, so the
   * previous value has to survive into the next tick - and has to be part of the state, not a
   * client-side detail, or reconciliation replay would see different edges than the original
   * simulation did.
   */
  lastRight: number;
  /** Seconds until another lurch may fire. */
  lurchCooldown: number;
}

export interface PlayerInput {
  /** -1 back .. +1 forward. */
  forward: number;
  /** -1 left .. +1 right. */
  right: number;
  jump: boolean;
  crouch: boolean;
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
  lurch?: boolean;
  lurchMaxAngle?: number;
  lurchRetention?: number;
  slide?: boolean;
}

export function createPlayerState(position: Vec3): PlayerState {
  return {
    position: vec3.clone(position),
    velocity: vec3.zero(),
    onGround: false,
    groundNormal: vec3.up(),
    jumpHeld: false,
    duck: 0,
    sliding: false,
    lastRight: 0,
    lurchCooldown: 0,
  };
}

/**
 * Rotate horizontal velocity toward wishDir, keeping (almost) all of its magnitude.
 *
 * Air acceleration can only add `airWishSpeed` per tick along wishDir, so redirecting momentum
 * with it means spending a long time pointing away from where you are going and bleeding speed
 * the whole way. A lurch instead *turns* the existing velocity vector: the speed survives, only
 * the heading changes. Capped per event and behind a cooldown, so it reads as a deliberate
 * technique rather than free steering.
 */
function applyLurch(velocity: Vec3, wishDir: Vec3, maxAngleDeg: number, retention: number): Vec3 {
  const horizontal = { x: velocity.x, y: 0, z: velocity.z };
  const speed = vec3.length(horizontal);
  if (speed < LURCH_MIN_SPEED) return velocity;

  const from = vec3.scale(horizontal, 1 / speed);
  const cos = Math.min(Math.max(vec3.dot(from, wishDir), -1), 1);
  const angle = Math.acos(cos);
  const maxAngle = (maxAngleDeg * Math.PI) / 180;
  if (angle < 1e-4) return velocity;

  const t = Math.min(1, maxAngle / angle);
  // Spherical interpolation between the two headings, so the turn is along the arc rather than
  // through the middle - a linear blend would shrink the vector as it crosses.
  const sinTotal = Math.sin(angle);
  let direction: Vec3;
  if (sinTotal < 1e-6) {
    direction = wishDir;
  } else {
    const a = Math.sin((1 - t) * angle) / sinTotal;
    const b = Math.sin(t * angle) / sinTotal;
    direction = vec3.normalize({
      x: from.x * a + wishDir.x * b,
      y: 0,
      z: from.z * a + wishDir.z * b,
    });
  }

  const kept = speed * retention;
  return { x: direction.x * kept, y: velocity.y, z: direction.z * kept };
}

/** Total collision height at a given duck amount. */
export function hullHeight(duck: number): number {
  return PLAYER_HEIGHT - duck * DUCK_HEIGHT_GAIN;
}

/** Camera height above the feet at a given duck amount. */
export function eyeHeight(duck: number): number {
  return PLAYER_EYE_HEIGHT - duck * (PLAYER_EYE_HEIGHT - PLAYER_DUCK_EYE_HEIGHT);
}

/**
 * Advance the duck amount, moving the player if the hull has to shift under them.
 *
 * On the ground the hull shrinks downward from the head and the feet stay planted, so ducking
 * is purely cosmetic to the collision floor. In the air it is the opposite and that asymmetry
 * *is* the crouch-jump: the head holds its arc while the feet snap up to meet it, clearing
 * DUCK_HEIGHT_GAIN more than a plain jump would. Instantly, not over DUCK_TRANSITION_TIME -
 * the timing window for tucking your legs mid-jump is what makes the technique a skill.
 */
function updateDuck(
  state: PlayerState,
  wantsCrouch: boolean,
  onGround: boolean,
  position: Vec3,
  world: CollisionWorld,
  dt: number,
): { duck: number; position: Vec3 } {
  const target = wantsCrouch ? 1 : 0;
  let duck = state.duck;
  let pos = position;

  if (target > duck) {
    if (onGround) {
      duck = Math.min(1, duck + dt / DUCK_TRANSITION_TIME);
    } else {
      pos = { x: pos.x, y: pos.y + (1 - duck) * DUCK_HEIGHT_GAIN, z: pos.z };
      duck = 1;
    }
    return { duck, position: pos };
  }

  if (target < duck) {
    // Standing back up needs somewhere to put the extra height, or the player would grow into
    // whatever they are crouched under.
    const current = hullHeight(duck);
    if (onGround) {
      const needed = PLAYER_HEIGHT - current;
      const blocked =
        needed > 0 && world.castPlayer(pos, { x: 0, y: needed, z: 0 }, { height: current });
      if (!blocked) duck = Math.max(0, duck - dt / DUCK_TRANSITION_TIME);
    } else {
      // Airborne, the feet drop back down to where the taller hull's base belongs.
      const drop = duck * DUCK_HEIGHT_GAIN;
      const blocked =
        drop > 0 && world.castPlayer(pos, { x: 0, y: -drop, z: 0 }, { height: current });
      if (!blocked) {
        pos = { x: pos.x, y: pos.y - drop, z: pos.z };
        duck = 0;
      }
    }
  }

  return { duck, position: pos };
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
  height: number,
  distance = GROUND_CHECK_DIST,
): GroundProbe | null {
  const start = { x: position.x, y: position.y + GROUND_PROBE_LIFT, z: position.z };
  const length = GROUND_PROBE_LIFT + distance;

  const hit = world.castPlayer(start, { x: 0, y: -length, z: 0 }, {
    shrink: GROUND_PROBE_SHRINK,
    height,
  });
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
  height: number,
): SlideResult {
  let pos = position;
  let vel = velocity;
  let blocked = false;
  const planes: Vec3[] = [];
  let timeLeft = dt;

  for (let bump = 0; bump < MAX_MOVE_ITERATIONS; bump++) {
    if (timeLeft <= EPSILON || vec3.lengthSq(vel) < EPSILON) break;

    const delta = vec3.scale(vel, timeLeft);
    const hit = world.castPlayer(pos, delta, { height });

    if (!hit) {
      pos = vec3.add(pos, delta);
      break;
    }

    // Only a surface we are moving *into* can stop us. A surface we are sliding along, or
    // actively leaving, is contact without obstruction.
    const opposing = vec3.dot(vel, hit.normal) < -EPSILON;
    if (opposing) blocked = true;

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

    // A contact we are moving away from must not touch the velocity. Clipping it would remove
    // the component heading *out* of the surface - which is how jumping off a slope used to
    // destroy itself: the sweep grazed the ramp underfoot, and clipping against it turned the
    // jump's +375 vertical into -110 and cut horizontal speed from 479 to 302. Back off and
    // carry on instead.
    if (!opposing) continue;

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
function sweep(position: Vec3, delta: Vec3, world: CollisionWorld, height: number): Vec3 {
  const hit = world.castPlayer(position, delta, { height });
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
  height: number,
): SlideResult {
  const flat = slideMove(position, velocity, dt, world, height);
  if (!velocity.x && !velocity.z) return flat;

  // Nothing stopped us, so there is nothing to step over. Skipping here is not just an
  // optimisation: on open ground the flat sweep grazes the floor, and attempting a step anyway
  // meant lifting the capsule STEP_HEIGHT, sliding, and dropping it again every single tick.
  // The drop rarely landed at exactly the original height, so the player crept upward and
  // flickered in and out of ground state while simply walking in a straight line.
  if (!flat.blocked) return flat;

  const up = sweep(position, { x: 0, y: STEP_HEIGHT, z: 0 }, world, height);
  const stepped = slideMove(up, velocity, dt, world, height);
  const down = world.castPlayer(stepped.position, { x: 0, y: -STEP_HEIGHT, z: 0 }, { height });

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
  //    Probed with the hull we came in at, before ducking can change it.
  let ground = probeGround(position, world, hullHeight(state.duck));
  let onGround = ground !== null;
  /** Ground state before the jump can clear it - the step-down at the end keys off this. */
  const wasOnGround = onGround;

  // Project onto the ground plane rather than flattening vertical velocity to zero. On level
  // ground the two are identical (the normal is straight up, so the projection removes exactly
  // velocity.y). On a slope they are not: zeroing throws away the descent, while projecting
  // keeps the player sliding along the surface. See MOVEMENT_SPEC.md "Ramp slide".
  if (ground && velocity.y < 0) velocity = clipVelocity(velocity, ground.normal);

  // 2. Duck, before the jump, so a crouch-jump on the same tick still leaves at full height
  //    and only tucks the legs once airborne.
  const ducked = updateDuck(state, input.crouch, onGround, position, world, dt);
  position = ducked.position;
  const duck = ducked.duck;
  const height = hullHeight(duck);

  // 3. Jump. Horizontal velocity is untouched on purpose - carrying it through the jump is the
  //    entire basis of a bhop chain (MOVEMENT_SPEC.md "Jump").
  const wantsJump = input.jump && (autoBhop || !state.jumpHeld);
  const jumped = onGround && wantsJump;
  if (jumped) {
    velocity.y = JUMP_IMPULSE;
    onGround = false;
    ground = null;
  }

  // 4. Accelerate.
  const wishDir = wishDirection(input);
  const inputMagnitude = Math.min(
    1,
    Math.hypot(input.forward, input.right),
  );

  // A slide runs until the player stands up, jumps, leaves the ground, or runs out of
  // momentum. Entering one is decided at the end of the tick, since landing is only known
  // after the move - see step 8.
  const slideAllowed = options.slide ?? SLIDE_ENABLED;
  let sliding =
    state.sliding && slideAllowed && input.crouch && !jumped && onGround;
  if (sliding && vec3.horizontalLength(velocity) < SLIDE_END_SPEED) sliding = false;

  let lurchCooldown = Math.max(0, state.lurchCooldown - dt);

  if (onGround) {
    if (sliding) {
      // Barely any friction, and only enough acceleration to aim the slide. Gravity along the
      // surface is applied later, which is what makes a downhill slide pick up speed.
      velocity = applyFriction(velocity, dt, SLIDE_FRICTION);
      velocity = groundAccelerate(
        velocity,
        wishDir,
        SLIDE_STEER_SPEED * inputMagnitude,
        dt,
        GROUND_ACCEL * SLIDE_STEER_ACCEL,
      );
    } else {
      // Ducking slows you down, but only on the ground. Applying it airborne would make a
      // crouch-jump cost air control, turning a movement technique into a penalty.
      const duckScale = 1 - duck * (1 - DUCK_SPEED_SCALE);
      velocity = applyFriction(velocity, dt);
      velocity = groundAccelerate(
        velocity,
        wishDir,
        MAX_GROUND_SPEED * inputMagnitude * duckScale,
        dt,
      );
    }
  } else {
    // Lurch fires on a fresh strafe press only. Holding a strafe key - which is what air
    // strafing does - never re-triggers it, so the two mechanics coexist untouched.
    const freshStrafe = input.right !== 0 && input.right !== state.lastRight;
    if ((options.lurch ?? LURCH_ENABLED) && freshStrafe && lurchCooldown <= 0) {
      const lurched = applyLurch(
        velocity,
        wishDir,
        options.lurchMaxAngle ?? LURCH_MAX_ANGLE,
        options.lurchRetention ?? LURCH_SPEED_RETENTION,
      );
      if (lurched !== velocity) {
        velocity = lurched;
        lurchCooldown = LURCH_COOLDOWN;
      }
    }

    velocity = airAccelerate(
      velocity,
      wishDir,
      dt,
      airWishSpeed(MAX_GROUND_SPEED * inputMagnitude, options.airWishSpeedCap),
      options.airAccel,
    );
  }

  // 5. Gravity, split either side of the move. A full step before or after biases jump height
  //    by g*dt^2/2 per tick; splitting it makes the arc match the analytic height instead, so
  //    JUMP_IMPULSE/GRAVITY tuning means what MOVEMENT_SPEC.md says it means.
  if (!onGround) velocity.y -= GRAVITY * dt * 0.5;

  // Sliding leaves gravity switched on, projected onto the surface. Walking does not - you do
  // not accelerate strolling down a hill - but a slide is exactly the case where the slope
  // should pull you, so a downhill slide builds speed and an uphill one dies.
  if (onGround && sliding && ground) {
    const pull = clipVelocity({ x: 0, y: -GRAVITY * dt, z: 0 }, ground.normal);
    velocity = vec3.add(velocity, pull);
  }

  // 6. Integrate.
  const moved = onGround
    ? stepMove(position, velocity, dt, world, height)
    : slideMove(position, velocity, dt, world, height);
  position = moved.position;
  velocity = moved.velocity;

  if (!onGround) velocity.y -= GRAVITY * dt * 0.5;

  // 7. Re-check ground so the returned state reflects where the player actually ended up -
  //    the renderer, the HUD, and next tick's jump check all read this.
  // Skip entirely on the tick we jumped, or the probe re-finds the floor we just left and
  // cancels the jump before it starts.
  let landedProbe = jumped ? null : probeGround(position, world, height);

  // Step down. Walking is integrated horizontally, so on any descending surface the ground
  // falls away underneath you: at speed v on a slope of angle a, each tick drops v * dt * tan(a)
  // below where you were. Past GROUND_CHECK_DIST that reads as *airborne* - which costs friction
  // and ground acceleration, and (because a jump needs onGround) silently kills auto-bhop the
  // moment you point yourself downhill. Reaching further down to reattach is what keeps you
  // glued to slopes and stairs. Only when already grounded and not on the way up, so it can
  // never yank a jump back to the floor.
  if (!landedProbe && wasOnGround && !jumped && velocity.y <= 0) {
    landedProbe = probeGround(position, world, height, STEP_HEIGHT);
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
  //
  // Landing on a *slope* actively pays out: projecting the fall onto the surface converts the
  // downward speed into speed along it, so dropping onto a descending ramp leaves faster than
  // it arrived. Zeroing velocity.y here instead would discard exactly that (MOVEMENT_SPEC.md
  // "Ramp slide").
  if (landedProbe && velocity.y < 0) {
    velocity = clipVelocity(velocity, landedProbe.normal);
  }

  // 8. Enter a slide. Only decidable here, because "did we just land" is only known after the
  //    move. Landing on crouch with speed slides; crouching while already running does not -
  //    a slide has to be launched into, which is what makes it a technique.
  if (
    slideAllowed &&
    input.crouch &&
    !jumped &&
    landed &&
    !wasOnGround &&
    vec3.horizontalLength(velocity) >= SLIDE_MIN_SPEED
  ) {
    sliding = true;
  }
  sliding = sliding && landed;

  const speed = vec3.length(velocity);
  if (speed > MAX_VELOCITY) velocity = vec3.scale(velocity, MAX_VELOCITY / speed);

  return {
    position,
    velocity,
    onGround: landed,
    groundNormal: landedProbe?.normal ?? vec3.up(),
    jumpHeld: input.jump,
    duck,
    sliding,
    lastRight: input.right,
    lurchCooldown,
  };
}

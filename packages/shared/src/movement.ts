// Pure movement functions, implementing docs/MOVEMENT_SPEC.md.
//
// These are deliberately pure (state in, state out, no side effects) so they can:
//   1. run identically on client (prediction) and server (authority) - see docs/ARCHITECTURE.md
//   2. be unit tested in isolation without a renderer or network stack
//
// Do not add rendering, networking, or Rapier-specific types here. World collision info comes
// in as plain data (onGround, groundNormal) - the caller is responsible for producing that via
// shape casts.

import { vec3, type Vec3 } from "./vec3.js";
import {
  GROUND_ACCEL,
  AIR_ACCEL,
  AIR_WISH_SPEED_CAP,
  FRICTION,
  STOP_SPEED,
} from "./constants.js";

const EPSILON = 1e-6;

/** Slack when testing "does this velocity move into that plane" - see clipVelocityAgainstPlanes. */
const PLANE_TOLERANCE = 1e-4;

/** Above this, two contact normals are the same surface and must not both be recorded. */
export const PARALLEL_PLANE_DOT = 0.999;

/** Ground friction. Only apply while onGround, before groundAccelerate. */
export function applyFriction(vel: Vec3, dt: number, friction = FRICTION, stopSpeed = STOP_SPEED): Vec3 {
  const speed = vec3.length(vel);
  if (speed < EPSILON) return vel;
  const control = speed < stopSpeed ? stopSpeed : speed;
  const drop = control * friction * dt;
  const newSpeed = Math.max(speed - drop, 0);
  return vec3.scale(vel, newSpeed / speed);
}

/** Shared accelerate step used by both ground and air movement - see MOVEMENT_SPEC.md. */
function accelerate(vel: Vec3, wishDir: Vec3, wishSpeed: number, accel: number, dt: number): Vec3 {
  const currentSpeed = vec3.dot(vel, wishDir);
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) return vel;
  const accelSpeed = Math.min(accel * wishSpeed * dt, addSpeed);
  return vec3.add(vel, vec3.scale(wishDir, accelSpeed));
}

/** Grounded acceleration toward wishDir, capped at wishSpeed (e.g. MAX_GROUND_SPEED). */
export function groundAccelerate(
  vel: Vec3,
  wishDir: Vec3,
  wishSpeed: number,
  dt: number,
  accel = GROUND_ACCEL,
): Vec3 {
  return accelerate(vel, wishDir, wishSpeed, accel, dt);
}

/**
 * Airborne acceleration. wishSpeed here should be AIR_WISH_SPEED_CAP, NOT the player's max
 * ground speed - that low cap relative to wishDir is precisely what lets strafing compound
 * total velocity beyond ground max speed. See MOVEMENT_SPEC.md "Air movement".
 */
export function airAccelerate(
  vel: Vec3,
  wishDir: Vec3,
  dt: number,
  wishSpeed = AIR_WISH_SPEED_CAP,
  accel = AIR_ACCEL,
): Vec3 {
  return accelerate(vel, wishDir, wishSpeed, accel, dt);
}

/**
 * Clamp a desired speed down to the airborne cap.
 *
 * This is the single most important line in the whole movement model: airborne, the player may
 * be travelling at 800+ units/s, but accelerate() only ever tries to reach ~30 along wishDir.
 * That leaves dot(vel, wishDir) below wishSpeed whenever wishDir is near-perpendicular to
 * velocity, so addSpeed stays positive and every tick adds a little speed. Raise this and
 * strafing stops compounding; the whole bhop/surf ceiling collapses to walk speed.
 */
export function airWishSpeed(wishSpeed: number, cap = AIR_WISH_SPEED_CAP): number {
  return Math.min(wishSpeed, cap);
}

/** Slide velocity along a surface instead of zeroing it on contact - used for surf ramps. */
export function clipVelocity(vel: Vec3, normal: Vec3, overbounce = 1.0): Vec3 {
  const backoff = vec3.dot(vel, normal) * overbounce;
  return vec3.sub(vel, vec3.scale(normal, backoff));
}

/**
 * Clip velocity so it violates none of the surfaces touched this tick.
 *
 * Single-plane clipping is not enough once the player wedges into a corner: sliding along
 * plane A can push straight into plane B, which next iteration pushes back into A, and the
 * player jitters in place. So: try each plane in turn and keep the first result that moves
 * away from (or along) every other plane. If no single plane works and there are exactly two,
 * the only remaining legal direction is the crease where they meet - project onto it. More
 * than two mutually blocking planes means the player is boxed in; stop dead.
 *
 * Returns null if the player is fully blocked and velocity should be zeroed.
 */
export function clipVelocityAgainstPlanes(vel: Vec3, planes: readonly Vec3[]): Vec3 | null {
  for (let i = 0; i < planes.length; i++) {
    const plane = planes[i];
    if (!plane) continue;
    const candidate = clipVelocity(vel, plane);
    let violatesAnother = false;
    for (let j = 0; j < planes.length; j++) {
      const other = planes[j];
      if (j === i || !other) continue;
      // Negative dot means the candidate still moves into that surface. The tolerance matters:
      // clipping leaves velocity exactly tangent to its own plane, which rounds to a dot of
      // -1e-16 or so. Testing against a hard zero would read that as a violation and reject a
      // perfectly good slide, stopping the player dead on a ramp.
      if (vec3.dot(candidate, other) < -PLANE_TOLERANCE) {
        violatesAnother = true;
        break;
      }
    }
    if (!violatesAnother) return candidate;
  }

  if (planes.length !== 2) return null;
  const a = planes[0];
  const b = planes[1];
  if (!a || !b) return null;
  const cross = vec3.cross(a, b);
  // Near-parallel planes have no meaningful crease; treat as fully blocked rather than
  // projecting onto a normalized zero vector.
  if (vec3.length(cross) < 1e-6) return null;
  const crease = vec3.normalize(cross);
  return vec3.scale(crease, vec3.dot(crease, vel));
}

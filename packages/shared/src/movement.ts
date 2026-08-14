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

/** Slide velocity along a surface instead of zeroing it on contact - used for surf ramps. */
export function clipVelocity(vel: Vec3, normal: Vec3, overbounce = 1.0): Vec3 {
  const backoff = vec3.dot(vel, normal) * overbounce;
  return vec3.sub(vel, vec3.scale(normal, backoff));
}

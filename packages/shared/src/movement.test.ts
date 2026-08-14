import { test } from "node:test";
import assert from "node:assert/strict";
import { groundAccelerate, airAccelerate, applyFriction, clipVelocity } from "./movement.js";
import { vec3 } from "./vec3.js";

test("groundAccelerate increases speed toward wishDir up to wishSpeed", () => {
  let vel = vec3.zero();
  const wishDir = { x: 1, y: 0, z: 0 };
  for (let i = 0; i < 1000; i++) {
    vel = groundAccelerate(vel, wishDir, 320, 1 / 64);
  }
  // should converge to approximately wishSpeed, never exceed it substantially
  assert.ok(vec3.length(vel) <= 320 + 1);
  assert.ok(vec3.length(vel) > 300);
});

test("applyFriction reduces speed over time and never reverses direction", () => {
  let vel = { x: 200, y: 0, z: 0 };
  const initialSpeed = vec3.length(vel);
  vel = applyFriction(vel, 1 / 64);
  assert.ok(vec3.length(vel) < initialSpeed);
  assert.ok(vel.x > 0); // still same direction, just slower
});

test("airAccelerate with alternating strafe directions can exceed ground max speed", () => {
  // Real air-strafing keeps wishDir at a small, consistent angle relative to the CURRENT
  // velocity direction (mirrored each "strafe cycle"), not a fixed world-space angle - that's
  // what lets each tick's accelerate() add speed roughly along the existing velocity direction
  // instead of fighting it. Simulate that properly rather than a fixed-angle approximation.
  let vel = { x: 320, y: 0, z: 0 }; // start at ground max speed exiting a bhop
  const wishSpeedCap = 30; // matches AIR_WISH_SPEED_CAP
  const ticksPerCycle = 16; // how often the strafe direction mirrors, like alternating A/D
  for (let i = 0; i < 400; i++) {
    const sign = Math.floor(i / ticksPerCycle) % 2 === 0 ? 1 : -1;
    const velDir = vec3.normalize(vel);
    // Classic strafejump optimal angle: as current speed grows well past the air wishSpeed
    // cap, the wish direction has to sit closer to perpendicular to velocity to keep
    // dot(vel, wishDir) low enough for addSpeed to stay positive. Recompute each tick so the
    // simulation tracks the real optimum as speed changes, rather than a fixed guess.
    const speed = Math.max(vec3.length(vel), 1);
    const cosTheta = Math.min(Math.max(wishSpeedCap / (2 * speed), -1), 1);
    const strafeAngle = Math.acos(cosTheta);
    const rotated = {
      x: velDir.x * Math.cos(strafeAngle * sign) - velDir.z * Math.sin(strafeAngle * sign),
      y: 0,
      z: velDir.x * Math.sin(strafeAngle * sign) + velDir.z * Math.cos(strafeAngle * sign),
    };
    vel = airAccelerate(vel, vec3.normalize(rotated), 1 / 64);
  }
  assert.ok(vec3.length(vel) > 320, "strafing in air should be able to exceed ground max speed");
});

test("clipVelocity slides along a surface instead of stopping", () => {
  const vel = { x: 0, y: -100, z: 0 }; // falling straight down onto a ramp
  const rampNormal = vec3.normalize({ x: 0, y: 0.6, z: 0.8 }); // steep ramp, not "ground"
  const result = clipVelocity(vel, rampNormal);
  // should still have significant speed (not zeroed), redirected along the slope
  assert.ok(vec3.length(result) > 10);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { vec3, type Vec3 } from "./vec3.js";
import type { CollisionWorld } from "./collision.js";
import { createPlayerState, movePlayer, wishDirection, type PlayerInput } from "./player.js";
import {
  AIR_WISH_SPEED_CAP,
  GROUND_NORMAL_MIN_Y,
  GROUND_PROBE_SHRINK,
  JUMP_IMPULSE,
  MAX_GROUND_SPEED,
  TICK_DT,
} from "./constants.js";

// A single infinite plane through the origin, tilted by `angleDeg` about +Z. Enough to test
// every ground/air/surf decision without pulling in Rapier - which is the point of movement
// taking a CollisionWorld rather than a physics engine.
function tiltedPlane(angleDeg: number): CollisionWorld {
  const a = (angleDeg * Math.PI) / 180;
  const normal: Vec3 = { x: -Math.sin(a), y: Math.cos(a), z: 0 };
  return {
    castPlayer(from: Vec3, delta: Vec3) {
      const dist = vec3.dot(from, normal);
      const approach = vec3.dot(delta, normal);
      if (approach >= 0) return null; // moving away from the surface, or parallel to it
      if (dist + approach > 0) return null; // motion ends before reaching it
      const fraction = dist <= 0 ? 0 : dist / -approach;
      return { fraction: Math.min(Math.max(fraction, 0), 1), normal };
    },
  };
}

const flatGround = (): CollisionWorld => tiltedPlane(0);

/** Empty world - every cast misses, so the player is always airborne. */
const emptyWorld: CollisionWorld = { castPlayer: () => null };

function input(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return { forward: 0, right: 0, jump: false, yaw: 0, ...overrides };
}

test("wishDirection: yaw 0 faces -Z and strafes +X, matching Three.js camera orientation", () => {
  const fwd = wishDirection(input({ forward: 1 }));
  assert.ok(Math.abs(fwd.x) < 1e-9);
  assert.ok(Math.abs(fwd.z + 1) < 1e-9);

  const right = wishDirection(input({ right: 1 }));
  assert.ok(Math.abs(right.x - 1) < 1e-9);
  assert.ok(Math.abs(right.z) < 1e-9);
});

test("wishDirection is normalized when two keys are held, so diagonals aren't faster", () => {
  const diagonal = wishDirection(input({ forward: 1, right: 1 }));
  assert.ok(Math.abs(vec3.length(diagonal) - 1) < 1e-9);
});

test("standing on flat ground stays grounded and does not sink", () => {
  let state = createPlayerState({ x: 0, y: 0, z: 0 });
  for (let i = 0; i < 64; i++) {
    state = movePlayer(state, input(), flatGround(), TICK_DT);
  }
  assert.equal(state.onGround, true);
  assert.ok(Math.abs(state.position.y) < 1e-6, `drifted to y=${state.position.y}`);
});

test("jump leaves the ground and gravity brings the player back down", () => {
  const world = flatGround();
  let state = createPlayerState({ x: 0, y: 0, z: 0 });
  state = movePlayer(state, input({ jump: true }), world, TICK_DT);

  assert.equal(state.onGround, false);
  assert.ok(state.position.y > 0);

  // Hold jump: with auto-bhop off this must not re-trigger, so the player lands again.
  let landed = false;
  for (let i = 0; i < 128; i++) {
    state = movePlayer(state, input({ jump: true }), world, TICK_DT);
    if (state.onGround) {
      landed = true;
      break;
    }
  }
  assert.ok(landed, "player never came back down");
});

test("jump height matches the analytic JUMP_IMPULSE^2 / 2g", () => {
  const world = flatGround();
  let state = createPlayerState({ x: 0, y: 0, z: 0 });
  let peak = 0;
  state = movePlayer(state, input({ jump: true }), world, TICK_DT);
  for (let i = 0; i < 128 && !state.onGround; i++) {
    state = movePlayer(state, input(), world, TICK_DT);
    peak = Math.max(peak, state.position.y);
  }
  const expected = (JUMP_IMPULSE * JUMP_IMPULSE) / (2 * 800);
  // Split gravity keeps this within a fraction of a unit; a whole-step integration would be
  // off by ~2 units and quietly invalidate the tuning table in MOVEMENT_SPEC.md.
  assert.ok(
    Math.abs(peak - expected) < 1,
    `jump peaked at ${peak.toFixed(2)}, expected ~${expected.toFixed(2)}`,
  );
});

test("auto-bhop off requires a fresh press; auto-bhop on re-jumps while held", () => {
  const world = flatGround();

  let held = createPlayerState({ x: 0, y: 0, z: 0 });
  held = movePlayer(held, input({ jump: true }), world, TICK_DT); // takes off
  // jumpHeld is now true, so a grounded player holding jump must not launch again.
  const grounded = { ...createPlayerState({ x: 0, y: 0, z: 0 }), jumpHeld: true };
  const blocked = movePlayer(grounded, input({ jump: true }), world, TICK_DT);
  assert.equal(blocked.onGround, true, "held jump should not re-trigger with auto-bhop off");

  const auto = movePlayer(grounded, input({ jump: true }), world, TICK_DT, { autoBhop: true });
  assert.equal(auto.onGround, false, "auto-bhop should re-trigger on a held jump");
});

test("jumping preserves horizontal momentum instead of zeroing it", () => {
  const world = flatGround();
  const state = { ...createPlayerState({ x: 0, y: 0, z: 0 }), velocity: { x: 500, y: 0, z: 0 } };
  const after = movePlayer(state, input({ jump: true }), world, TICK_DT);
  assert.equal(after.onGround, false);
  // Friction is skipped on the tick you jump - that is exactly what makes a frame-perfect
  // bhop chain keep speed (MOVEMENT_SPEC.md "Jump").
  assert.equal(after.velocity.x, 500);
});

test("landing preserves horizontal speed; friction only bleeds it once actually grounded", () => {
  const world = flatGround();
  let state = {
    ...createPlayerState({ x: 0, y: 40, z: 0 }),
    velocity: { x: 600, y: 0, z: 0 },
  };
  while (!state.onGround) state = movePlayer(state, input(), world, TICK_DT);

  // The landing tick itself must not scrub speed.
  assert.ok(state.velocity.x > 590, `landing cost speed: ${state.velocity.x}`);

  const onLanding = state.velocity.x;
  state = movePlayer(state, input(), world, TICK_DT);
  assert.ok(state.velocity.x < onLanding, "friction should apply on the next grounded tick");
});

test("ground movement converges on MAX_GROUND_SPEED and no further", () => {
  const world = flatGround();
  let state = createPlayerState({ x: 0, y: 0, z: 0 });
  for (let i = 0; i < 256; i++) {
    state = movePlayer(state, input({ forward: 1 }), world, TICK_DT);
  }
  const speed = vec3.horizontalLength(state.velocity);
  assert.ok(speed > MAX_GROUND_SPEED * 0.95, `only reached ${speed}`);
  assert.ok(speed <= MAX_GROUND_SPEED + 1e-6, `exceeded ground cap: ${speed}`);
});

test("a 20-degree slope is walkable, a 55-degree surf ramp is not", () => {
  const walkable = movePlayer(createPlayerState(vec3.zero()), input(), tiltedPlane(20), TICK_DT);
  assert.ok(Math.cos((20 * Math.PI) / 180) > GROUND_NORMAL_MIN_Y);
  assert.equal(walkable.onGround, true);

  const surf = movePlayer(createPlayerState(vec3.zero()), input(), tiltedPlane(55), TICK_DT);
  assert.ok(Math.cos((55 * Math.PI) / 180) < GROUND_NORMAL_MIN_Y);
  assert.equal(surf.onGround, false, "a surf ramp must never count as ground");
});

test("surfing a ramp accelerates along it without penetrating it", () => {
  const angle = 55;
  const world = tiltedPlane(angle);
  const a = (angle * Math.PI) / 180;
  const normal: Vec3 = { x: -Math.sin(a), y: Math.cos(a), z: 0 };

  let state = { ...createPlayerState(vec3.zero()), velocity: { x: 0, y: 0, z: -200 } };
  const startSpeed = vec3.length(state.velocity);

  for (let i = 0; i < 64; i++) {
    state = movePlayer(state, input(), world, TICK_DT);
    // Never end a tick on the solid side of the ramp.
    assert.ok(vec3.dot(state.position, normal) > -1e-3, `sank into the ramp at tick ${i}`);
  }

  assert.equal(state.onGround, false);
  assert.ok(
    vec3.length(state.velocity) > startSpeed,
    "gravity should accelerate the player down the ramp",
  );
  // Velocity is clipped into the ramp plane, not stopped by it. The residual is the half tick
  // of gravity applied after the slide, which next tick's clip removes - so the bound is that
  // half-step, not zero.
  const into = -vec3.dot(state.velocity, normal);
  assert.ok(
    into >= 0 && into <= 800 * TICK_DT * 0.5 * normal.y + 1e-6,
    `velocity drives into the surface by ${into}, more than one half-tick of gravity`,
  );
});

test("air control still applies while surfing - the ramp is not a special mode", () => {
  // A ramp tilted about +Z has a normal with no Z component, and gravity has none either. So
  // motion along Z is untouched by both clipping and gravity, and any change in vz is purely
  // airAccelerate's doing - the one axis where air control is measurable in isolation. (Total
  // speed can't show it: gravity pulls ~655 u/s^2 down a 55-degree slope, swamping a 30 u/s cap.)
  const world = tiltedPlane(55);
  const start = createPlayerState(vec3.zero());

  let passive = start;
  let strafing = start;
  for (let i = 0; i < 128; i++) {
    passive = movePlayer(passive, input(), world, TICK_DT);
    strafing = movePlayer(strafing, input({ forward: 1 }), world, TICK_DT); // yaw 0 => -Z
  }

  assert.equal(passive.onGround, false);
  assert.equal(passive.velocity.z, 0, "nothing should move the passive player along Z");
  // Converges on the airborne cap, not MAX_GROUND_SPEED - proof it took the air path, and that
  // friction never touched it despite being in constant contact with a surface.
  assert.ok(
    strafing.velocity.z < -AIR_WISH_SPEED_CAP * 0.95,
    `air control on a ramp only reached vz=${strafing.velocity.z}`,
  );
  assert.ok(strafing.velocity.z >= -AIR_WISH_SPEED_CAP - 1e-6, "air cap should still bind");
});

test("the ground probe starts clear of the feet and uses a narrowed shape", () => {
  const calls: { from: Vec3; delta: Vec3; shrink: number | undefined }[] = [];
  const spy: CollisionWorld = {
    castPlayer(from, delta, shrink) {
      calls.push({ from, delta, shrink });
      return null;
    },
  };
  movePlayer(createPlayerState({ x: 0, y: 0, z: 0 }), input(), spy, TICK_DT);

  const probes = calls.filter((c) => c.shrink !== undefined);
  assert.ok(probes.length > 0, "no ground probe was issued");
  for (const probe of probes) {
    // Both of these guard against the shape cast starting inside contact range, where it
    // returns a zero-length hit with an arbitrary normal instead of finding the floor.
    assert.ok(probe.from.y > 0, `probe started at the feet (y=${probe.from.y})`);
    assert.equal(probe.shrink, GROUND_PROBE_SHRINK);
    assert.ok(probe.delta.y < 0 && probe.delta.x === 0 && probe.delta.z === 0);
  }
});

test("standing on a floor while pressed against a wall stays grounded", () => {
  // Models what a real shape cast does next to a wall: at full width the sweep catches the
  // wall's bottom corner and reports a 45-degree normal, which is not walkable. Only the
  // narrowed probe clears the wall and finds the floor. Without the shrink, a player hugging a
  // wall reads as airborne and cannot jump - which breaks bhopping any tight course.
  const floor: Vec3 = { x: 0, y: 1, z: 0 };
  const corner: Vec3 = vec3.normalize({ x: 0, y: 1, z: 1 });
  const world: CollisionWorld = {
    castPlayer(_from, delta, shrink) {
      if (delta.y >= 0) return null;
      return { fraction: 0.5, normal: (shrink ?? 0) > 0 ? floor : corner };
    },
  };

  const state = movePlayer(createPlayerState({ x: 0, y: 0, z: 0 }), input(), world, TICK_DT);
  assert.equal(state.onGround, true);
  assert.equal(state.groundNormal.y, 1);
});

test("falling through empty space accelerates at exactly GRAVITY", () => {
  let state = createPlayerState({ x: 0, y: 1000, z: 0 });
  for (let i = 0; i < 64; i++) state = movePlayer(state, input(), emptyWorld, TICK_DT);
  // 64 ticks == 1 second.
  assert.ok(Math.abs(state.velocity.y + 800) < 1e-6, `vy=${state.velocity.y}`);
  assert.equal(state.onGround, false);
});

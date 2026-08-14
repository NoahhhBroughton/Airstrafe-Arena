import { test } from "node:test";
import assert from "node:assert/strict";
import { vec3, type Vec3 } from "./vec3.js";
import type { CollisionWorld } from "./collision.js";
import {
  createPlayerState,
  eyeHeight,
  hullHeight,
  movePlayer,
  wishDirection,
  type PlayerInput,
  type PlayerState,
} from "./player.js";
import {
  AIR_WISH_SPEED_CAP,
  DUCK_HEIGHT_GAIN,
  GROUND_NORMAL_MIN_Y,
  GROUND_PROBE_SHRINK,
  JUMP_IMPULSE,
  MAX_GROUND_SPEED,
  PLAYER_DUCK_HEIGHT,
  PLAYER_HEIGHT,
  SLIDE_BOOST_SPEED,
  SLIDE_GRACE_TIME,
  SLIDE_MIN_SPEED,
  SKIN_WIDTH,
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
  return { forward: 0, right: 0, jump: false, crouch: false, yaw: 0, ...overrides };
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

test("standing on flat ground stays grounded and settles at a stable resting height", () => {
  const world = flatGround();
  let state = createPlayerState({ x: 0, y: 0, z: 0 });
  for (let i = 0; i < 64; i++) state = movePlayer(state, input(), world, TICK_DT);

  assert.equal(state.onGround, true);
  // Feet rest SKIN_WIDTH clear of the floor, not flush on it - see SKIN_WIDTH in constants.ts.
  assert.ok(
    Math.abs(state.position.y - SKIN_WIDTH) < 1e-6,
    `settled at y=${state.position.y}, expected ${SKIN_WIDTH}`,
  );

  // And it has to stay there. Any per-tick creep is the bug that used to launch players off
  // level ground, so assert the height is a fixed point rather than merely small.
  const settled = state.position.y;
  for (let i = 0; i < 64; i++) state = movePlayer(state, input(), world, TICK_DT);
  assert.ok(
    Math.abs(state.position.y - settled) < 1e-9,
    `drifted from ${settled} to ${state.position.y}`,
  );
});

test("walking in a straight line on flat ground never leaves the ground", () => {
  const world = flatGround();
  let state = createPlayerState({ x: 0, y: 0, z: 0 });
  for (let i = 0; i < 16; i++) state = movePlayer(state, input({ forward: 1 }), world, TICK_DT);

  // The regression this guards: a grazing floor contact during horizontal motion used to
  // return an arbitrary normal, and clipping against it injected vertical velocity that
  // accumulated until the player took off.
  for (let i = 0; i < 256; i++) {
    state = movePlayer(state, input({ forward: 1 }), world, TICK_DT);
    assert.equal(state.onGround, true, `went airborne on flat ground at tick ${i}`);
    assert.ok(
      Math.abs(state.position.y - SKIN_WIDTH) < 1e-6,
      `height drifted to ${state.position.y} at tick ${i}`,
    );
    assert.ok(Math.abs(state.velocity.y) < 1e-6, `gained vertical speed ${state.velocity.y}`);
    // Walking forward must not develop sideways drift either.
    assert.ok(Math.abs(state.velocity.x) < 1e-6, `gained sideways speed ${state.velocity.x}`);
  }
});

test("jump leaves the ground and gravity brings the player back down", () => {
  const world = flatGround();
  let state = createPlayerState({ x: 0, y: 0, z: 0 });
  state = movePlayer(state, input({ jump: true }), world, TICK_DT);

  assert.equal(state.onGround, false);
  assert.ok(state.position.y > 0);

  let landed = false;
  for (let i = 0; i < 128; i++) {
    state = movePlayer(state, input(), world, TICK_DT);
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

test("auto-bhop re-jumps on a held key; turning it off requires a fresh press", () => {
  const world = flatGround();
  // Grounded with jump already held from a previous tick - the moment the two modes differ.
  const grounded = { ...createPlayerState({ x: 0, y: 0, z: 0 }), jumpHeld: true };

  const auto = movePlayer(grounded, input({ jump: true }), world, TICK_DT, { autoBhop: true });
  assert.equal(auto.onGround, false, "auto-bhop should re-trigger on a held jump");

  const manual = movePlayer(grounded, input({ jump: true }), world, TICK_DT, { autoBhop: false });
  assert.equal(manual.onGround, true, "held jump should not re-trigger with auto-bhop off");

  // A fresh press still works in manual mode.
  const fresh = movePlayer(
    { ...grounded, jumpHeld: false },
    input({ jump: true }),
    world,
    TICK_DT,
    { autoBhop: false },
  );
  assert.equal(fresh.onGround, false);
});

test("the default is auto-bhop on, matching surf/bhop server convention", () => {
  const grounded = { ...createPlayerState({ x: 0, y: 0, z: 0 }), jumpHeld: true };
  const state = movePlayer(grounded, input({ jump: true }), flatGround(), TICK_DT);
  assert.equal(state.onGround, false);
});

test("air acceleration saturates above 1/dt, so larger values are indistinguishable", () => {
  // The reason AIR_ACCEL is 100 rather than Source's 10: at 10 a tick can only steer
  // 10 * 30 * dt = 4.7 u/s. Past 1/dt (64 here) accelSpeed is bounded by addSpeed instead,
  // and every value above that behaves the same - so 100 and 1000 are the same setting.
  // Measured as steering authority: already moving fast along -Z, how much sideways velocity
  // can two ticks of holding strafe-right produce? From a standstill every setting saturates
  // within a few ticks and looks the same - the difference only shows up mid-flight.
  const start = {
    ...createPlayerState({ x: 0, y: 1000, z: 0 }),
    velocity: { x: 0, y: 0, z: -500 },
  };

  const steer = (airAccel: number) => {
    let s = start;
    for (let i = 0; i < 2; i++) {
      s = movePlayer(s, input({ right: 1 }), emptyWorld, TICK_DT, { airAccel });
    }
    return s.velocity.x;
  };

  const sluggish = steer(10);
  const responsive = steer(100);
  const absurd = steer(1000);

  assert.ok(responsive > sluggish * 2, `100 (${responsive}) should clearly beat 10 (${sluggish})`);
  assert.equal(responsive, absurd, "everything past 1/dt should be identical");
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

// tiltedPlane slopes down toward -X, so yaw +90deg faces downhill and -90deg faces uphill.
const DOWNHILL_YAW = Math.PI / 2;
const UPHILL_YAW = -Math.PI / 2;

test("walking down a slope stays glued to it instead of flickering airborne", () => {
  const world = tiltedPlane(20);
  let state = createPlayerState(vec3.zero());
  for (let i = 0; i < 64; i++) {
    state = movePlayer(state, input({ forward: 1, yaw: DOWNHILL_YAW }), world, TICK_DT);
  }

  // Movement integrates horizontally, so descending ground falls away underneath at
  // speed * dt * tan(angle) per tick - past GROUND_CHECK_DIST that reads as airborne, which
  // costs friction, ground acceleration, and (since jumping needs onGround) auto-bhop.
  for (let i = 0; i < 256; i++) {
    state = movePlayer(state, input({ forward: 1, yaw: DOWNHILL_YAW }), world, TICK_DT);
    assert.equal(state.onGround, true, `went airborne descending a walkable slope at tick ${i}`);
  }
});

test("auto-bhop keeps chaining while heading down a slope", () => {
  const world = tiltedPlane(20);
  let state = createPlayerState(vec3.zero());
  for (let i = 0; i < 64; i++) {
    state = movePlayer(state, input({ forward: 1, yaw: DOWNHILL_YAW }), world, TICK_DT);
  }

  let jumps = 0;
  let previousY = state.velocity.y;
  for (let i = 0; i < 256; i++) {
    state = movePlayer(state, input({ forward: 1, jump: true, yaw: DOWNHILL_YAW }), world, TICK_DT);
    // A jump is the only thing that makes vertical velocity leap upward by the impulse.
    if (state.velocity.y - previousY > JUMP_IMPULSE * 0.5) jumps++;
    previousY = state.velocity.y;
  }
  assert.ok(jumps > 2, `only ${jumps} jumps fired while bhopping downhill`);
});

test("jumping off a slope is not clipped by the slope being left", () => {
  const world = tiltedPlane(20);
  let state = createPlayerState(vec3.zero());
  for (let i = 0; i < 64; i++) {
    state = movePlayer(state, input({ forward: 1, yaw: DOWNHILL_YAW }), world, TICK_DT);
  }

  const before = vec3.horizontalLength(state.velocity);
  const after = movePlayer(state, input({ forward: 1, jump: true, yaw: DOWNHILL_YAW }), world, TICK_DT);

  // The sweep grazes the ramp underfoot on the way up. Clipping against a surface you are
  // moving *away* from removes the component leaving it, which used to convert the jump's
  // upward velocity into downward and scrub a third of the horizontal speed with it.
  assert.ok(
    after.velocity.y > JUMP_IMPULSE * 0.9,
    `jump off a slope only reached vy=${after.velocity.y}`,
  );
  assert.ok(
    vec3.horizontalLength(after.velocity) > before * 0.99,
    `jumping off a slope cost speed: ${before} -> ${vec3.horizontalLength(after.velocity)}`,
  );
});

test("landing on a descending slope converts fall speed into speed along it", () => {
  const world = tiltedPlane(20);
  // Airborne above the plane, moving downhill and falling hard.
  let state = {
    ...createPlayerState({ x: 0, y: 400, z: 0 }),
    velocity: { x: -320, y: 0, z: 0 },
  };

  let impact: { before: number; after: number } | null = null;
  for (let i = 0; i < 256 && !impact; i++) {
    const previous = state;
    state = movePlayer(state, input({ yaw: DOWNHILL_YAW }), world, TICK_DT);
    if (!previous.onGround && state.onGround) {
      impact = {
        before: vec3.horizontalLength(previous.velocity),
        after: vec3.horizontalLength(state.velocity),
      };
    }
  }

  assert.ok(impact, "never landed");
  // Projecting the fall onto the ramp plane redirects it along the surface - this is the
  // ramp-slide payout, and the reason landing must never just zero velocity.y.
  assert.ok(
    impact.after > impact.before * 1.2,
    `ramp slide paid nothing: ${impact.before} -> ${impact.after}`,
  );
});

test("bhopping down a slope compounds speed rather than bleeding it", () => {
  const world = tiltedPlane(20);
  let state = createPlayerState(vec3.zero());
  for (let i = 0; i < 64; i++) {
    state = movePlayer(state, input({ forward: 1, yaw: DOWNHILL_YAW }), world, TICK_DT);
  }
  const entry = vec3.horizontalLength(state.velocity);

  for (let i = 0; i < 256; i++) {
    state = movePlayer(state, input({ forward: 1, jump: true, yaw: DOWNHILL_YAW }), world, TICK_DT);
  }

  assert.ok(
    vec3.horizontalLength(state.velocity) > entry * 1.5,
    `downhill bhop lost speed: ${entry} -> ${vec3.horizontalLength(state.velocity)}`,
  );
});

test("walking up a slope climbs it without ever leaving the ground", () => {
  const world = tiltedPlane(20);
  let state = createPlayerState(vec3.zero());
  for (let i = 0; i < 64; i++) {
    state = movePlayer(state, input({ forward: 1, yaw: UPHILL_YAW }), world, TICK_DT);
  }

  const startY = state.position.y;
  for (let i = 0; i < 128; i++) {
    state = movePlayer(state, input({ forward: 1, yaw: UPHILL_YAW }), world, TICK_DT);
    assert.equal(state.onGround, true, `went airborne climbing a walkable slope at tick ${i}`);
  }

  assert.ok(state.position.y > startY + 100, `barely climbed: ${startY} -> ${state.position.y}`);
  // Climbing resolves through the stair-step path rather than the slide, so vertical velocity
  // stays at zero and the height comes from the step's landing trace. Either route is fine;
  // what must not happen is inferring "airborne" from an upward-clipped velocity, which used to
  // drop friction and ground acceleration for the whole climb.
  assert.ok(
    vec3.horizontalLength(state.velocity) > MAX_GROUND_SPEED * 0.9,
    `lost speed climbing: ${vec3.horizontalLength(state.velocity)}`,
  );
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
    castPlayer(from, delta, hull) {
      calls.push({ from, delta, shrink: hull?.shrink });
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
    castPlayer(_from, delta, hull) {
      if (delta.y >= 0) return null;
      return { fraction: 0.5, normal: (hull?.shrink ?? 0) > 0 ? floor : corner };
    },
  };

  const state = movePlayer(createPlayerState({ x: 0, y: 0, z: 0 }), input(), world, TICK_DT);
  assert.equal(state.onGround, true);
  assert.equal(state.groundNormal.y, 1);
});

/** Floor at y = 0 with a ceiling overhead, to exercise downward-facing contact normals. */
function room(ceilingHeight: number): CollisionWorld {
  return {
    castPlayer(from: Vec3, delta: Vec3, hull) {
      if (delta.y < 0) {
        const dist = from.y;
        if (dist + delta.y > 0) return null;
        const fraction = dist <= 0 ? 0 : dist / -delta.y;
        return { fraction: Math.min(Math.max(fraction, 0), 1), normal: { x: 0, y: 1, z: 0 } };
      }
      if (delta.y > 0) {
        // Height matters here: a ducked hull fits under a ceiling a standing one does not.
        const headroom = ceilingHeight - (from.y + (hull?.height ?? PLAYER_HEIGHT));
        if (delta.y < headroom) return null;
        const fraction = headroom <= 0 ? 0 : headroom / delta.y;
        return { fraction: Math.min(Math.max(fraction, 0), 1), normal: { x: 0, y: -1, z: 0 } };
      }
      return null;
    },
  };
}

test("jumping into a ceiling stops you dead rather than sticking or clipping through", () => {
  const headroom = 20;
  const world = room(PLAYER_HEIGHT + headroom);
  let state = createPlayerState({ x: 0, y: 0, z: 0 });

  state = movePlayer(state, input({ jump: true }), world, TICK_DT);
  assert.equal(state.onGround, false);

  let peak = 0;
  let landed = false;
  for (let i = 0; i < 128; i++) {
    state = movePlayer(state, input(), world, TICK_DT);
    peak = Math.max(peak, state.position.y);
    // The head must never pass through the ceiling, even for a tick.
    assert.ok(
      state.position.y <= headroom + 1e-3,
      `clipped through the ceiling to y=${state.position.y} at tick ${i}`,
    );
    if (state.onGround) {
      landed = true;
      break;
    }
  }

  // Unobstructed this jump would reach ~45.6; the ceiling has to be what stopped it.
  assert.ok(peak > headroom - 1, `never actually reached the ceiling (peak ${peak})`);
  assert.ok(landed, "player stuck against the ceiling instead of falling back down");
});

test("crouching on the ground lowers the hull but leaves the feet planted", () => {
  const world = flatGround();
  let state = createPlayerState({ x: 0, y: 0, z: 0 });
  state = movePlayer(state, input(), world, TICK_DT);
  const standingFeet = state.position.y;

  for (let i = 0; i < 64; i++) state = movePlayer(state, input({ crouch: true }), world, TICK_DT);

  assert.equal(state.duck, 1, "should be fully ducked after holding crouch");
  assert.equal(hullHeight(state.duck), PLAYER_DUCK_HEIGHT);
  assert.ok(
    Math.abs(state.position.y - standingFeet) < 1e-6,
    `feet moved while crouching on the ground: ${standingFeet} -> ${state.position.y}`,
  );
  // The eye drops instead, which is what the player actually sees.
  assert.ok(eyeHeight(state.duck) < eyeHeight(0));
});

test("ducking on the ground takes DUCK_TRANSITION_TIME rather than snapping", () => {
  const world = flatGround();
  let state = createPlayerState({ x: 0, y: 0, z: 0 });
  state = movePlayer(state, input({ crouch: true }), world, TICK_DT);
  assert.ok(state.duck > 0 && state.duck < 1, `snapped straight to ${state.duck}`);
});

test("crouch-jump clears more height than a plain jump", () => {
  const world = flatGround();

  const peakOf = (crouchInAir: boolean): number => {
    let state = createPlayerState({ x: 0, y: 0, z: 0 });
    state = movePlayer(state, input({ jump: true }), world, TICK_DT);
    let peak = state.position.y;
    for (let i = 0; i < 128 && !state.onGround; i++) {
      state = movePlayer(state, input({ jump: true, crouch: crouchInAir }), world, TICK_DT);
      peak = Math.max(peak, state.position.y);
    }
    return peak;
  };

  const plain = peakOf(false);
  const crouched = peakOf(true);

  // Ducking mid-air snaps the feet up to the head, so the feet clear DUCK_HEIGHT_GAIN more
  // than the jump arc alone would carry them - the entire point of the technique.
  assert.ok(
    crouched > plain + DUCK_HEIGHT_GAIN * 0.9,
    `crouch-jump reached ${crouched.toFixed(1)} vs plain ${plain.toFixed(1)}, ` +
      `expected about ${DUCK_HEIGHT_GAIN} more`,
  );
});

test("you cannot stand up inside a ceiling you crouched under", () => {
  // Headroom fits the ducked hull but not the standing one.
  const world = room(PLAYER_DUCK_HEIGHT + 4);
  let state = { ...createPlayerState({ x: 0, y: 0, z: 0 }), duck: 1 };

  for (let i = 0; i < 64; i++) state = movePlayer(state, input(), world, TICK_DT);

  assert.equal(state.duck, 1, "stood up into a ceiling that has no room for it");
  assert.equal(state.onGround, true);
});

test("alternating strafe keys mid-air only ever applies air acceleration", () => {
  // Guards the reason lurch was removed. Air strafing alternates A and D every cycle, so any
  // mechanic keyed on a "fresh strafe press" fires constantly during ordinary strafing rather
  // than only on a deliberate tap. Nothing may redirect velocity faster than the air cap.
  let state = {
    ...createPlayerState({ x: 0, y: 4000, z: 0 }),
    velocity: { x: 0, y: 0, z: -600 },
  };

  for (let i = 0; i < 128; i++) {
    const previous = state.velocity;
    // Release and re-press, the way a real strafe cycle does.
    const right = i % 8 < 4 ? 1 : 0;
    state = movePlayer(state, input({ right }), emptyWorld, TICK_DT);
    const sidewaysDelta = Math.abs(state.velocity.x - previous.x);
    assert.ok(
      sidewaysDelta <= AIR_WISH_SPEED_CAP + 1e-6,
      `velocity was redirected by ${sidewaysDelta} in one tick at tick ${i}`,
    );
  }
});

test("landing on crouch at speed starts a slide that carries", () => {
  const world = flatGround();
  let state = {
    ...createPlayerState({ x: 0, y: 60, z: 0 }),
    velocity: { x: 0, y: 0, z: -400 },
  };

  while (!state.onGround) state = movePlayer(state, input({ crouch: true }), world, TICK_DT);
  assert.equal(state.sliding, true, "landing on crouch with speed should start a slide");

  const entry = vec3.horizontalLength(state.velocity);
  for (let i = 0; i < 32; i++) state = movePlayer(state, input({ crouch: true }), world, TICK_DT);
  const carried = vec3.horizontalLength(state.velocity);

  // Inside SLIDE_GRACE_TIME nothing takes speed at all - not friction, and on the flat not
  // gravity either.
  assert.ok(Math.abs(carried - entry) < 1e-6, `slide lost speed during grace: ${entry} -> ${carried}`);
  assert.equal(state.sliding, true);
});

test("slide speed holds for SLIDE_GRACE_TIME, then falls off", () => {
  const world = flatGround();
  let state: PlayerState = {
    ...createPlayerState({ x: 0, y: 60, z: 0 }),
    velocity: { x: 0, y: 0, z: -400 },
  };
  while (!state.onGround) state = movePlayer(state, input({ crouch: true }), world, TICK_DT);
  const entry = vec3.horizontalLength(state.velocity);

  // Just before the window closes.
  const graceTicks = Math.floor(SLIDE_GRACE_TIME / TICK_DT) - 2;
  for (let i = 0; i < graceTicks; i++) {
    state = movePlayer(state, input({ crouch: true }), world, TICK_DT);
  }
  const atGraceEnd = vec3.horizontalLength(state.velocity);
  assert.ok(
    Math.abs(atGraceEnd - entry) < 1e-6,
    `lost speed inside the grace window: ${entry} -> ${atGraceEnd}`,
  );

  // And a second later friction has clearly bitten.
  for (let i = 0; i < 64; i++) state = movePlayer(state, input({ crouch: true }), world, TICK_DT);
  const afterFalloff = vec3.horizontalLength(state.velocity);
  assert.ok(afterFalloff < atGraceEnd * 0.9, `no falloff after grace: ${atGraceEnd} -> ${afterFalloff}`);
});

test("strafing during a slide compounds speed, the same way it does mid-air", () => {
  const world = flatGround();
  const enter = (): PlayerState => {
    let s: PlayerState = {
      ...createPlayerState({ x: 0, y: 60, z: 0 }),
      velocity: { x: 0, y: 0, z: -400 },
    };
    while (!s.onGround) s = movePlayer(s, input({ crouch: true }), world, TICK_DT);
    return s;
  };

  let passive = enter();
  let strafing = enter();
  const entry = vec3.horizontalLength(strafing.velocity);

  for (let i = 0; i < 100; i++) {
    passive = movePlayer(passive, input({ crouch: true }), world, TICK_DT);
    // Same optimal-angle strafe as air strafing: wishDir held near-perpendicular to velocity.
    const sign = Math.floor(i / 12) % 2 === 0 ? 1 : -1;
    const speed = Math.max(vec3.horizontalLength(strafing.velocity), 1);
    const theta =
      Math.acos(Math.min(Math.max(AIR_WISH_SPEED_CAP / (2 * speed), -1), 1)) * sign;
    const dir = vec3.normalize({ x: strafing.velocity.x, y: 0, z: strafing.velocity.z });
    const rx = dir.x * Math.cos(theta) - dir.z * Math.sin(theta);
    const rz = dir.x * Math.sin(theta) + dir.z * Math.cos(theta);
    strafing = movePlayer(
      strafing,
      input({ forward: 1, crouch: true, yaw: Math.atan2(-rx, -rz) }),
      world,
      TICK_DT,
    );
  }

  // A slide uses airAccelerate, so the same mouse technique that builds speed in the air builds
  // it on the ground. Ground acceleration would have capped both at MAX_GROUND_SPEED instead.
  assert.ok(
    vec3.horizontalLength(strafing.velocity) > entry,
    `strafing a slide did not gain: ${entry} -> ${vec3.horizontalLength(strafing.velocity)}`,
  );
  assert.ok(
    vec3.horizontalLength(strafing.velocity) > vec3.horizontalLength(passive.velocity),
    "strafing should beat sliding passively",
  );
});

test("a slide ends on releasing crouch, on jumping, and when it runs out of speed", () => {
  const world = flatGround();
  const slideStart = (): PlayerState => {
    let s: PlayerState = {
      ...createPlayerState({ x: 0, y: 60, z: 0 }),
      velocity: { x: 0, y: 0, z: -400 },
    };
    while (!s.onGround) s = movePlayer(s, input({ crouch: true }), world, TICK_DT);
    return s;
  };

  assert.equal(movePlayer(slideStart(), input(), world, TICK_DT).sliding, false, "released crouch");
  assert.equal(
    movePlayer(slideStart(), input({ crouch: true, jump: true }), world, TICK_DT).sliding,
    false,
    "jumped out of the slide",
  );

  let state = slideStart();
  for (let i = 0; i < 2048 && state.sliding; i++) {
    state = movePlayer(state, input({ crouch: true }), world, TICK_DT);
  }
  assert.equal(state.sliding, false, "slide never ran out of speed");
});

test("pressing crouch while running starts a slide", () => {
  const world = flatGround();
  let state = createPlayerState({ x: 0, y: 0, z: 0 });
  for (let i = 0; i < 128; i++) state = movePlayer(state, input({ forward: 1 }), world, TICK_DT);
  assert.equal(state.onGround, true);
  assert.ok(vec3.horizontalLength(state.velocity) >= SLIDE_MIN_SPEED);

  const runSpeed = vec3.horizontalLength(state.velocity);
  state = movePlayer(state, input({ forward: 1, crouch: true }), world, TICK_DT);
  assert.equal(state.sliding, true, "crouch while running should slide");

  // Entering the slide launches you well past run speed - that boost is the reward for
  // sliding, and the reason to do it rather than keep running.
  const boosted = vec3.horizontalLength(state.velocity);
  assert.ok(
    Math.abs(boosted - SLIDE_BOOST_SPEED) < 1e-6,
    `slide entry did not boost: ${runSpeed} -> ${boosted}, expected ${SLIDE_BOOST_SPEED}`,
  );
});

test("the slide boost is a floor, so a fast entry is not clamped down to it", () => {
  const world = flatGround();
  let state: PlayerState = {
    ...createPlayerState({ x: 0, y: 60, z: 0 }),
    velocity: { x: 0, y: 0, z: -(SLIDE_BOOST_SPEED + 400) },
  };
  while (!state.onGround) state = movePlayer(state, input({ crouch: true }), world, TICK_DT);

  assert.equal(state.sliding, true);
  assert.ok(
    vec3.horizontalLength(state.velocity) > SLIDE_BOOST_SPEED + 300,
    `a fast entry was clamped to the boost speed: ${vec3.horizontalLength(state.velocity)}`,
  );
});

test("crouching too slowly to slide just crouches", () => {
  const world = flatGround();
  let state = createPlayerState({ x: 0, y: 0, z: 0 });
  // Walk briefly, well short of SLIDE_MIN_SPEED - ground accel reaches it in about four ticks.
  for (let i = 0; i < 3; i++) state = movePlayer(state, input({ forward: 1 }), world, TICK_DT);
  const speed = vec3.horizontalLength(state.velocity);
  assert.ok(speed < SLIDE_MIN_SPEED, `already too fast to test: ${speed}`);

  state = movePlayer(state, input({ forward: 1, crouch: true }), world, TICK_DT);
  assert.equal(state.sliding, false);
});

test("a spent slide does not restart itself while crouch stays held", () => {
  const world = flatGround();
  let state = createPlayerState({ x: 0, y: 0, z: 0 });
  for (let i = 0; i < 128; i++) state = movePlayer(state, input({ forward: 1 }), world, TICK_DT);
  state = movePlayer(state, input({ forward: 1, crouch: true }), world, TICK_DT);
  assert.equal(state.sliding, true);

  // Ride it out, still holding both crouch and forward.
  for (let i = 0; i < 1024 && state.sliding; i++) {
    state = movePlayer(state, input({ forward: 1, crouch: true }), world, TICK_DT);
  }
  assert.equal(state.sliding, false, "slide never ended");

  // The gap between SLIDE_MIN_SPEED and SLIDE_END_SPEED is what has to hold here: crouch-walk
  // acceleration is capped well below the entry threshold, so it cannot flicker back on.
  for (let i = 0; i < 256; i++) {
    state = movePlayer(state, input({ forward: 1, crouch: true }), world, TICK_DT);
    assert.equal(state.sliding, false, `slide restarted itself at tick ${i}`);
  }
});

test("sliding downhill picks up speed; uphill it dies", () => {
  const downhill = tiltedPlane(20);
  const enter = (yaw: number): PlayerState => {
    let s: PlayerState = {
      ...createPlayerState({ x: 0, y: 60, z: 0 }),
      velocity: yaw === DOWNHILL_YAW ? { x: -400, y: 0, z: 0 } : { x: 400, y: 0, z: 0 },
    };
    while (!s.onGround) s = movePlayer(s, input({ crouch: true, yaw }), downhill, TICK_DT);
    return s;
  };

  let down = enter(DOWNHILL_YAW);
  const downEntry = vec3.horizontalLength(down.velocity);
  for (let i = 0; i < 64; i++) {
    down = movePlayer(down, input({ crouch: true, yaw: DOWNHILL_YAW }), downhill, TICK_DT);
  }
  // Gravity along the surface still applies while sliding, unlike while walking.
  assert.ok(
    vec3.horizontalLength(down.velocity) > downEntry,
    `downhill slide did not accelerate: ${downEntry} -> ${vec3.horizontalLength(down.velocity)}`,
  );

  let up = enter(UPHILL_YAW);
  const upEntry = vec3.horizontalLength(up.velocity);
  for (let i = 0; i < 64; i++) {
    up = movePlayer(up, input({ crouch: true, yaw: UPHILL_YAW }), downhill, TICK_DT);
  }
  assert.ok(
    vec3.horizontalLength(up.velocity) < upEntry,
    `uphill slide did not decay: ${upEntry} -> ${vec3.horizontalLength(up.velocity)}`,
  );
});

test("falling through empty space accelerates at exactly GRAVITY", () => {
  let state = createPlayerState({ x: 0, y: 1000, z: 0 });
  for (let i = 0; i < 64; i++) state = movePlayer(state, input(), emptyWorld, TICK_DT);
  // 64 ticks == 1 second.
  assert.ok(Math.abs(state.velocity.y + 800) < 1e-6, `vy=${state.velocity.y}`);
  assert.equal(state.onGround, false);
});

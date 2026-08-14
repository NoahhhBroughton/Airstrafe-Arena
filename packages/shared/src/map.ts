// Test map geometry, as plain data.
//
// It lives in shared rather than in the client because the server has to build the exact same
// collision world - if the two disagree about where a ramp is, prediction never reconciles.
// Rendering and Rapier both consume this; neither owns it.
//
// Everything is axis-aligned boxes plus an optional rotation, which is enough for flat ground,
// stairs and ramps. Phase 2 replaces this with real map loading (see docs/ROADMAP.md).

import { vec3, type Vec3 } from "./vec3.js";

export interface MapBrush {
  /** Center of the box, in world space. */
  center: Vec3;
  /** Half-size on each axis, before rotation. */
  halfExtents: Vec3;
  /** Axis-angle rotation (radians). Omitted means axis-aligned. */
  rotation?: { axis: Vec3; angle: number };
  color: number;
}

/**
 * A named place to drop the player, bound to a number key. Tuning movement means running the
 * same 5 seconds of geometry hundreds of times; without these, most of a tuning session is
 * spent walking back to the ramp.
 */
export interface MapSpot {
  name: string;
  position: Vec3;
  yaw: number;
}

export interface MapDef {
  name: string;
  spawn: Vec3;
  spawnYaw: number;
  brushes: MapBrush[];
  spots: MapSpot[];
}

const DEG = Math.PI / 180;
const Z_AXIS: Vec3 = { x: 0, y: 0, z: 1 };

/**
 * Rotating a box by `angle` about +Z tilts its top face by that angle, sloping down toward -X.
 * The resulting surface normal is (-sin a, cos a, 0), so normal.y is cos(angle) - which is what
 * GROUND_NORMAL_MIN_Y (0.7, about 45.6 degrees) gets compared against. Below that angle a slope
 * is walkable; above it, it's a surf ramp. That threshold is the only thing separating the two.
 */
function tiltZ(angleDeg: number): { axis: Vec3; angle: number } {
  return { axis: Z_AXIS, angle: angleDeg * DEG };
}

const GROUND_COLOR = 0x3f4a3f;
const BHOP_COLOR = 0xc25a44;
const SURF_COLOR = 0x4a5ec2;
const STRUCTURE_COLOR = 0x7a7a88;

/** Ascending platforms with gaps - too tall to walk up (36 > STEP_HEIGHT), so they must be jumped. */
function bhopStaircase(): MapBrush[] {
  const brushes: MapBrush[] = [];
  const count = 8;
  const rise = 36; // under the ~45-unit jump height, so each step is reachable
  const spacing = 260; // roughly one jump's travel at MAX_GROUND_SPEED, tighter as speed builds
  for (let i = 0; i < count; i++) {
    const top = rise * (i + 1);
    brushes.push({
      center: { x: 0, y: top - 20, z: -600 - i * spacing },
      halfExtents: { x: 150, y: 20, z: 100 },
      color: BHOP_COLOR,
    });
  }
  return brushes;
}

const SURF_RAMP_ANGLE = 55; // normal.y = cos(55) = 0.57, comfortably under GROUND_NORMAL_MIN_Y
const ACCESS_RAMP_ANGLE = 20; // normal.y = cos(20) = 0.94, walkable

export const TEST_MAP: MapDef = {
  name: "test_movement",
  spawn: { x: 0, y: 8, z: 0 },
  spawnYaw: 0, // faces -Z, toward the bhop staircase

  brushes: [
    // Flat ground, top face at y = 0.
    {
      center: { x: 0, y: -40, z: 0 },
      halfExtents: { x: 3000, y: 40, z: 3000 },
      color: GROUND_COLOR,
    },

    ...bhopStaircase(),

    // --- Head-bonk shelter, off to -X --------------------------------------------------
    // A roof 100 units up: walk under it freely at 72 tall, jump and you hit your head. The
    // only geometry in the map with a downward-facing surface, so it is the only thing that
    // exercises ceiling collision at all. Off the main paths on purpose - a low roof anywhere
    // near the bhop run would just interrupt it.
    {
      center: { x: -600, y: 120, z: 0 },
      halfExtents: { x: 300, y: 20, z: 300 },
      color: STRUCTURE_COLOR,
    },
    // Corner posts only - full-length walls would fence the shelter off entirely.
    ...[-880, -320].flatMap((x) =>
      [-280, 280].map((z) => ({
        center: { x, y: 50, z },
        halfExtents: { x: 20, y: 50, z: 20 },
        color: STRUCTURE_COLOR,
      })),
    ),

    // --- Surf section, off to +X -------------------------------------------------------
    // A walkable ramp climbs to a platform; you step off the platform onto the steep ramp
    // and ride it down. Two ramps at different angles, either side of GROUND_NORMAL_MIN_Y,
    // so the walkable/surf boundary is directly comparable in one place.
    {
      center: { x: 1500, y: 257, z: 1200 },
      halfExtents: { x: 750, y: 30, z: 300 },
      rotation: tiltZ(ACCESS_RAMP_ANGLE),
      color: STRUCTURE_COLOR,
    },
    // Start platform, top face at y = 514 to meet the access ramp's high end.
    {
      center: { x: 2500, y: 257, z: 550 },
      halfExtents: { x: 300, y: 257, z: 950 },
      color: STRUCTURE_COLOR,
    },
    // The surf ramp itself. Its high edge sits at (2260, 500), buried *inside* the start
    // platform rather than out in the open. A slab's top edge is a sharp corner, and a player
    // who lands on that corner instead of the face wedges there and loses all their speed -
    // which is what happens with the edge exposed, however it is positioned relative to the
    // lip. Tucked under the overhang, the corner is unreachable: the face first emerges from
    // the platform's side at (2200, 414), so stepping off the lip always lands on open face.
    // The low edge passes below y = 0, so the ride ends by depositing you on flat ground.
    {
      center: { x: 2002, y: 131, z: -1500 },
      halfExtents: { x: 450, y: 40, z: 1500 },
      rotation: tiltZ(SURF_RAMP_ANGLE),
      color: SURF_COLOR,
    },
  ],

  spots: [
    { name: "spawn", position: { x: 0, y: 8, z: 0 }, yaw: 0 },
    // Just short of the first platform, facing up the staircase.
    { name: "bhop", position: { x: 0, y: 8, z: -420 }, yaw: 0 },
    // On the start platform, back along +Z with room to build speed. Run -Z down the platform,
    // then strafe off the -X lip once past z = 0 (where the ramp starts) to drop onto the face
    // carrying that momentum - entering with speed along the ramp's length is the whole point.
    { name: "surf", position: { x: 2500, y: 520, z: 900 }, yaw: 0 },
  ],
};

/** Convert a brush's axis-angle rotation to a quaternion (x, y, z, w) for Rapier/Three. */
export function brushQuaternion(brush: MapBrush): { x: number; y: number; z: number; w: number } {
  if (!brush.rotation) return { x: 0, y: 0, z: 0, w: 1 };
  const axis = vec3.normalize(brush.rotation.axis);
  const half = brush.rotation.angle * 0.5;
  const s = Math.sin(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
}

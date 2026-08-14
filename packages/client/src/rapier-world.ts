// Rapier-backed implementation of the shared CollisionWorld interface.
//
// Rapier is used strictly as a query engine here: shape casts against static geometry, nothing
// else. There is no rigid body for the player and no call to world.step() - the player's motion
// is integrated entirely by packages/shared (see CLAUDE.md, "What NOT to do").

import RAPIER from "@dimforge/rapier3d-compat";
import {
  brushQuaternion,
  vec3,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SKIN_WIDTH,
  type CollisionWorld,
  type MapDef,
  type ShapeCastHit,
  type Vec3,
} from "@airstrafe-arena/shared";

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Rapier's Capsule takes the half-height of the *cylinder* section, so total height is
 * 2 * (halfHeight + radius). Deriving halfHeight from the radius this way keeps total height
 * pinned at PLAYER_HEIGHT for any radius - which is what makes `shrink` narrow the capsule
 * without lifting the feet off the ground and quietly breaking the ground probe.
 */
const capsuleHalfHeight = (radius: number): number => PLAYER_HEIGHT / 2 - radius;

export async function initRapier(): Promise<void> {
  await RAPIER.init();
}

export function createRapierWorld(map: MapDef): CollisionWorld {
  // Zero gravity: this world is never stepped, so gravity would do nothing anyway. Being
  // explicit avoids anyone later assuming Rapier is simulating something.
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });

  for (const brush of map.brushes) {
    const q = brushQuaternion(brush);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(brush.center.x, brush.center.y, brush.center.z)
        .setRotation(q),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        brush.halfExtents.x,
        brush.halfExtents.y,
        brush.halfExtents.z,
      ),
      body,
    );
  }

  // Scene queries read the broad-phase BVH, which is only built during a simulation step - an
  // unstepped world silently reports no hits and the player falls through everything. One step
  // is enough and stays enough: every body here is fixed, so nothing ever invalidates it.
  world.step();

  // Shape instances are reused rather than rebuilt per cast - each one allocates on the WASM
  // heap, and this runs several times a tick.
  const capsules = new Map<number, RAPIER.Capsule>();
  const capsuleFor = (shrink: number): RAPIER.Capsule => {
    let capsule = capsules.get(shrink);
    if (!capsule) {
      const radius = PLAYER_RADIUS - shrink;
      capsule = new RAPIER.Capsule(capsuleHalfHeight(radius), radius);
      capsules.set(shrink, capsule);
    }
    return capsule;
  };

  return {
    castPlayer(from: Vec3, delta: Vec3, shrink = 0): ShapeCastHit | null {
      // A zero-length sweep has no direction for Rapier to work with.
      if (vec3.lengthSq(delta) < 1e-12) return null;

      // Callers work in feet coordinates; Rapier wants the capsule's center.
      const center = { x: from.x, y: from.y + PLAYER_HEIGHT / 2, z: from.z };

      const hit = world.castShape(
        center,
        IDENTITY_ROTATION,
        delta,
        capsuleFor(shrink),
        SKIN_WIDTH, // stop this far short of contact, so the next sweep never starts touching
        1.0, // maxToi of 1 means "travel at most `delta`", making time_of_impact a fraction
        true, // report a hit rather than sliding through if we somehow start penetrating
      );
      if (!hit) return null;

      // normal1, despite the "normal on the first shape" wording in Rapier's docs, is the one
      // pointing back toward the swept capsule - i.e. the surface normal movement wants.
      // Verified directly: sweeping the capsule down onto a floor yields normal1 = (0, 1, 0)
      // and normal2 = (0, -1, 0). Taking normal2 inverts every contact, which reads as the
      // player being sucked into geometry rather than stopped by it.
      const normal = vec3.normalize(hit.normal1);
      if (vec3.lengthSq(normal) < 0.5) {
        // Degenerate normal, which Rapier can report for a contact at exactly zero distance.
        // Fall back to opposing the sweep so the player stops instead of sliding into geometry.
        return { fraction: 0, normal: vec3.scale(vec3.normalize(delta), -1) };
      }

      return { fraction: Math.min(Math.max(hit.time_of_impact, 0), 1), normal };
    },
  };
}

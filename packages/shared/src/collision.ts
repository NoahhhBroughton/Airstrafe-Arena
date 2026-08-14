// The collision queries the movement code needs, expressed as a plain interface.
//
// Why an interface instead of importing Rapier here: CLAUDE.md keeps packages/shared free of
// anything environment-specific, and the movement step has to be *the same code* on client and
// server (docs/ARCHITECTURE.md - reconciliation replay only works if both sides compute
// identically). Each side constructs its own Rapier-backed implementation of this and hands it
// in. It also means movement can be unit tested against a hand-written fake world with no WASM
// involved.

import type { Vec3 } from "./vec3.js";

export interface ShapeCastHit {
  /** Fraction of the attempted motion completed before contact, in [0, 1]. */
  fraction: number;
  /** Unit surface normal of the geometry that was hit, pointing back toward the player. */
  normal: Vec3;
}

export interface HullOptions {
  /**
   * Narrows the shape by this many units *without changing its height*, so the feet stay put.
   *
   * The ground probe needs it: at full width, a downward sweep taken while pressed against a
   * wall catches the wall's bottom edge first and reports a 45-degree normal, which reads as
   * "not walkable" and drops the player out of ground state while they are plainly standing on
   * the floor. A slightly thinner probe misses the wall and finds the floor.
   */
  shrink?: number;
  /** Total capsule height. Defaults to PLAYER_HEIGHT; crouching passes the ducked height. */
  height?: number;
}

export interface CollisionWorld {
  /**
   * Sweep the player's collision shape from `from` along `delta` and report the first contact.
   *
   * `from` is the player's **feet** position (the bottom of the capsule), not its center -
   * implementations are responsible for offsetting to whatever origin their shape uses.
   * Returns null if the whole sweep is unobstructed.
   *
   * Contact is reported at zero distance. Implementations must not build a skin gap into the
   * cast tolerance: movement maintains its own clearance, and folding the two together puts a
   * resting player exactly on the hit/miss boundary where the reported normal is arbitrary.
   */
  castPlayer(from: Vec3, delta: Vec3, hull?: HullOptions): ShapeCastHit | null;

  /**
   * Cast a thin ray from `from` along `delta` and report the first contact.
   *
   * Not used by movement - movement always sweeps the player's hull. This is for everything
   * that needs a line rather than a volume: keeping the third-person camera out of walls now,
   * and hitscan in Phase 4.
   */
  castRay(from: Vec3, delta: Vec3): ShapeCastHit | null;
}

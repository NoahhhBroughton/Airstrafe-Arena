// Blocky bones: tapered boxes that bend as a curve rather than snapping at a point.
//
// The style is boxes - square cross-sections, hard facets, no smooth tubes. The trick for
// getting a taper out of a box is CylinderGeometry with four radial segments: four sides is a
// square prism, and top and bottom radii give it a taper that a scaled BoxGeometry cannot.
//
// The curve comes from splitting each bone into a few stacked sub-boxes and spreading a bend
// across them, so an elbow reads as a limb curving rather than two blocks meeting at a corner.
// This is the cheap stand-in for skinning: no weights, no deformation across the joint, just
// enough subdivision that the silhouette bends.

import * as THREE from "three";

/** A square prism, optionally tapered, standing along +Y with its base at the origin. */
export function taperedBox(
  topSide: number,
  bottomSide: number,
  length: number,
  material: THREE.Material,
): THREE.Mesh {
  // Four radial segments inscribe a square whose side is radius * sqrt(2), so divide through
  // to get the side length asked for. The 45-degree twist puts the flat faces on the axes
  // instead of the corners.
  const geometry = new THREE.CylinderGeometry(
    topSide / Math.SQRT2,
    bottomSide / Math.SQRT2,
    length,
    4,
    1,
  );
  geometry.rotateY(Math.PI / 4);
  return new THREE.Mesh(geometry, material);
}

export interface Bone {
  /** Rotate this to swing the whole bone from its joint. */
  readonly pivot: THREE.Group;
  /** Attach the next bone here - it tracks the tip through any curve. */
  readonly tip: THREE.Group;
  /**
   * Bend the bone along its length, in radians, spread across its sub-boxes. Use it to soften
   * the joint at the far end: passing a share of the child's angle makes the two read as one
   * curving limb instead of two blocks hinged together.
   */
  setCurve(radians: number): void;
}

/**
 * A bone hanging along -Y from its pivot, built from `parts` stacked tapered boxes.
 *
 * More parts curve more smoothly and cost more draw calls; two or three is plenty at this
 * scale, where the facets are meant to show.
 */
export function createBone(
  topSide: number,
  bottomSide: number,
  length: number,
  material: THREE.Material,
  parts = 3,
): Bone {
  const pivot = new THREE.Group();
  const partLength = length / parts;
  const joints: THREE.Group[] = [];

  let attach: THREE.Group = pivot;
  for (let i = 0; i < parts; i++) {
    const joint = new THREE.Group();
    // Each sub-box hangs off the end of the one before it.
    joint.position.y = i === 0 ? 0 : -partLength;
    attach.add(joint);
    joints.push(joint);

    const t = i / parts;
    const next = (i + 1) / parts;
    const mesh = taperedBox(
      topSide + (bottomSide - topSide) * t,
      topSide + (bottomSide - topSide) * next,
      partLength,
      material,
    );
    mesh.position.y = -partLength / 2;
    joint.add(mesh);

    attach = joint;
  }

  const tip = new THREE.Group();
  tip.position.y = -partLength;
  attach.add(tip);

  return {
    pivot,
    tip,
    setCurve(radians: number) {
      // The first joint is the bone's own pivot and is driven by the caller; the rest share
      // the curve between them.
      const share = radians / Math.max(1, parts - 1);
      for (let i = 1; i < joints.length; i++) {
        const joint = joints[i];
        if (joint) joint.rotation.x = share;
      }
    },
  };
}

/**
 * Point a unit-height mesh from one place to another, stretching it to fit.
 *
 * Used for forearms, which have to actually reach the weapon. Posing them by rotation alone
 * leaves the hand wherever the angles happen to put it, which is how hands end up buried
 * inside the gun they are supposed to be holding.
 */
export function stretchBetween(
  mesh: THREE.Object3D,
  from: THREE.Vector3,
  to: THREE.Vector3,
): void {
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = direction.length();
  if (length < 1e-6) return;

  mesh.position.copy(from).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.multiplyScalar(1 / length),
  );
  mesh.scale.y = length; // geometry is built one unit tall so this reads as the length
}

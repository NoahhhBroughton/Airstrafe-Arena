// Builds the Three.js view of a map. Purely visual - the collision world is built separately
// from the same MapDef, so the two can never drift apart the way hand-mirrored geometry does.

import * as THREE from "three";
import { brushQuaternion, type MapDef } from "@airstrafe-arena/shared";

export function buildMapScene(map: MapDef): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1d24);
  scene.fog = new THREE.Fog(0x1a1d24, 2000, 6000);

  for (const brush of map.brushes) {
    const geometry = new THREE.BoxGeometry(
      brush.halfExtents.x * 2,
      brush.halfExtents.y * 2,
      brush.halfExtents.z * 2,
    );
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ color: brush.color }),
    );
    mesh.position.set(brush.center.x, brush.center.y, brush.center.z);
    const q = brushQuaternion(brush);
    mesh.quaternion.set(q.x, q.y, q.z, q.w);
    scene.add(mesh);

    // Edge outlines. At bhop speed, untextured blocks give almost no motion cue - the outlines
    // are what make it possible to judge distance and closing speed while tuning.
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
    );
    edges.position.copy(mesh.position);
    edges.quaternion.copy(mesh.quaternion);
    scene.add(edges);
  }

  // A ground grid at 100-unit cells, the single most useful speed reference there is: at
  // MAX_GROUND_SPEED you cross about three cells per second.
  const grid = new THREE.GridHelper(6000, 60, 0x556655, 0x445544);
  grid.position.y = 0.2; // just above the ground brush, to avoid z-fighting
  scene.add(grid);

  const sun = new THREE.DirectionalLight(0xfff2e0, 2.0);
  sun.position.set(300, 800, 200);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8899bb, 0x333322, 1.2));

  return scene;
}

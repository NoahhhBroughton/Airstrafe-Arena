// A first-person body: the legs and torso you see when you look down.
//
// This exists because crouching had no visible tell. The camera barely moves (the feet rise by
// exactly as much as the eye offset drops), and with nothing rendered below the view there was
// no way to know whether you were ducked. Seeing your own legs fold under you is the readable
// signal, and it also makes a slide legible - you can see the pose you are in.
//
// Blocky on purpose, Minecraft-ish: flat-shaded boxes, no skinning. Limbs bend at a joint by
// nesting a box inside a pivot group and rotating the pivot, which is enough for a crouch and a
// slide pose without a skeleton. Purely cosmetic - it reads player state and never writes it.

import * as THREE from "three";
import { hullHeight, vec3, type PlayerState } from "@airstrafe-arena/shared";

const SKIN = 0xd8a07a;
const SHIRT = 0x4a6ea8;
const TROUSERS = 0x39445c;

/** Nests `box` under a pivot placed at its top, so rotating the pivot swings it like a joint. */
function limb(width: number, length: number, depth: number, color: number): THREE.Group {
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, length, depth),
    new THREE.MeshLambertMaterial({ color, flatShading: true }),
  );
  mesh.position.y = -length / 2; // hang from the pivot rather than straddling it
  pivot.add(mesh);
  return pivot;
}

export interface ViewModel {
  /** Attach to the scene. Kept off the camera so the body stays world-oriented, not view-locked. */
  readonly object: THREE.Object3D;
  update(state: PlayerState, viewDuck: number, position: THREE.Vector3, yaw: number): void;
}

export function createViewModel(): ViewModel {
  const root = new THREE.Group();

  // Yaw-only holder: the body turns with your heading but never pitches, so looking up and down
  // does not tip your own legs into view.
  const body = new THREE.Group();
  root.add(body);

  const hips = new THREE.Group();
  body.add(hips);

  // Pelvis only - no torso. A chest sits within a few units of the camera and inside its
  // horizontal footprint, so at this FOV it fills the screen the moment you look down. Legs
  // are the readable part anyway, which is what this is for.
  const pelvis = new THREE.Mesh(
    new THREE.BoxGeometry(20, 8, 12),
    new THREE.MeshLambertMaterial({ color: SHIRT, flatShading: true }),
  );
  hips.add(pelvis);

  // Sized so hip height (~0.47 of the hull) minus thigh minus shin lands the feet near the
  // floor when standing.
  const thighLength = 17;
  const shinLength = 15;
  const legs: { hip: THREE.Group; knee: THREE.Group }[] = [];

  for (const side of [-1, 1]) {
    const hip = limb(10, thighLength, 10, TROUSERS);
    hip.position.set(side * 6, 0, 0);
    hips.add(hip);

    const knee = limb(9, shinLength, 9, TROUSERS);
    knee.position.y = -thighLength;
    hip.add(knee);

    const foot = new THREE.Mesh(
      new THREE.BoxGeometry(9, 4, 13),
      new THREE.MeshLambertMaterial({ color: SKIN, flatShading: true }),
    );
    foot.position.set(0, -shinLength - 2, -2);
    knee.add(foot);

    legs.push({ hip, knee });
  }

  const DEG = Math.PI / 180;
  let stride = 0;

  return {
    object: root,

    update(state: PlayerState, viewDuck: number, position: THREE.Vector3, yaw: number) {
      root.position.copy(position);
      body.rotation.y = yaw;

      // Hips ride at roughly the waist of whatever hull we currently have, so crouching lowers
      // them along with the camera. Driven by viewDuck rather than state.duck so the body and
      // the view move together - the simulation value would make the legs lead the camera
      // through the crouch ease.
      hips.position.y = hullHeight(viewDuck) * 0.47;

      const speed = vec3.horizontalLength(state.velocity);

      // Limbs hang along -Y, so a positive rotation.x swings them forward (toward -Z, the way
      // yaw 0 faces) and knees bend with a negative rotation. Getting these signs backwards
      // folds the legs behind the player, out of view, which is exactly where you cannot see
      // them.
      if (state.sliding) {
        // Lead leg extended out front, trailing leg tucked underneath - the classic slide
        // pose, and unmistakable from a crouch when you glance down.
        legs[0]?.hip.rotation.set(38 * DEG, 0, 0);
        legs[0]?.knee.rotation.set(-12 * DEG, 0, 0);
        legs[1]?.hip.rotation.set(-8 * DEG, 0, 0);
        legs[1]?.knee.rotation.set(-115 * DEG, 0, 0);
        return;
      }

      // Crouch folds both legs symmetrically; the walk cycle swings them out of phase.
      const crouchBend = viewDuck * 55 * DEG;
      const moving = speed > 20 && state.onGround;
      stride += moving ? speed * 0.00035 : -stride * 0.2;

      legs.forEach(({ hip, knee }, i) => {
        const phase = i === 0 ? stride : stride + Math.PI;
        const swing = moving ? Math.sin(phase) * 30 * DEG : 0;
        hip.rotation.x = crouchBend + swing;
        // Knees only ever bend one way: backwards.
        knee.rotation.x = -crouchBend * 2 - Math.max(0, Math.sin(phase)) * 26 * DEG;
      });
    },
  };
}

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
import { hullHeight, vec3, PLAYER_HEIGHT, type PlayerState } from "@airstrafe-arena/shared";

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

  // Anatomy note, and the whole reason this looks right or wrong: the camera is the player's
  // *eyes*, which sit at the front of the head, not at the centre of the body. So the torso
  // hangs BEHIND the camera and the legs angle FORWARD from the hips. Put the body directly
  // under the camera instead and looking down shows you a cross-section through the middle of
  // your own thighs, which is exactly as odd as it sounds.
  const TORSO_BACK = 9;
  const pelvis = new THREE.Mesh(
    new THREE.BoxGeometry(20, 9, 13),
    new THREE.MeshLambertMaterial({ color: TROUSERS, flatShading: true }),
  );
  pelvis.position.z = TORSO_BACK * 0.55;
  hips.add(pelvis);

  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(23, 24, 13),
    new THREE.MeshLambertMaterial({ color: SHIRT, flatShading: true }),
  );
  torso.position.set(0, 14, TORSO_BACK);
  hips.add(torso);

  /** Standing lean of the thighs. Without it the legs drop straight down out of sight. */
  const THIGH_REST = 16;

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
      const hull = hullHeight(viewDuck);
      hips.position.y = hull * 0.47;

      // The torso has to shrink with the hull, not just ride lower on it. At a fixed height a
      // ducked torso reaches above the ducked eye line and floods the view from the inside.
      const torsoScale = hull / PLAYER_HEIGHT;
      torso.scale.y = torsoScale;
      torso.position.y = 14 * torsoScale;

      const speed = vec3.horizontalLength(state.velocity);

      // Limbs hang along -Y, so a positive rotation.x swings them forward (toward -Z, the way
      // yaw 0 faces) and knees bend with a negative rotation. Getting these signs backwards
      // folds the legs behind the player, out of view, which is exactly where you cannot see
      // them.
      if (state.sliding) {
        // Lead leg thrown out front, trailing leg tucked underneath - the classic slide pose,
        // and unmistakable from a crouch when you glance down.
        legs[0]?.hip.rotation.set(52 * DEG, 0, 0);
        legs[0]?.knee.rotation.set(-14 * DEG, 0, 0);
        legs[1]?.hip.rotation.set(4 * DEG, 0, 0);
        legs[1]?.knee.rotation.set(-118 * DEG, 0, 0);
        torso.rotation.x = -10 * DEG; // lean back into the slide, gently - more crowds the view
        return;
      }

      torso.rotation.x = 0;

      // Crouch folds both legs symmetrically; the walk cycle swings them out of phase.
      const crouchBend = viewDuck * 48 * DEG;
      const rest = THIGH_REST * DEG;
      const moving = speed > 20 && state.onGround;
      stride += moving ? speed * 0.00035 : -stride * 0.2;

      legs.forEach(({ hip, knee }, i) => {
        const phase = i === 0 ? stride : stride + Math.PI;
        const swing = moving ? Math.sin(phase) * 30 * DEG : 0;
        hip.rotation.x = rest + crouchBend + swing;
        // Knees only ever bend one way: backwards. The rest lean is cancelled here so a
        // standing leg hangs vertically from the knee down rather than kicking forward.
        knee.rotation.x = -rest - crouchBend * 2 - Math.max(0, Math.sin(phase)) * 26 * DEG;
      });
    },
  };
}

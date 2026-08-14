// The player character: one rig, used by both camera modes.
//
// It is deliberately a single model rather than a first-person body plus a separate third-person
// one. Two models drift - a pose fixed in one stays wrong in the other, and a slide that reads
// well over the shoulder looks broken down the barrel. First person just hides the head and puts
// the camera in it.
//
// Limbs are tapered segments in a joint hierarchy, with a rounded cap at every joint. That cap
// is doing the work a skinned mesh would: without it a bent elbow shows the corner of one
// segment poking out of the other. True skinning would deform the surface across the joint
// instead, but that wants an authored, weighted mesh rather than procedural geometry - see
// docs/ROADMAP.md.
//
// Purely cosmetic: this reads player state and never writes it.

import * as THREE from "three";
import { hullHeight, vec3, PLAYER_HEIGHT, type PlayerState } from "@airstrafe-arena/shared";

const SKIN = 0xd8a07a;
const SHIRT = 0x46618f;
const SHIRT_DARK = 0x35496b;
const TROUSERS = 0x333b4d;
const BOOTS = 0x22262f;

const DEG = Math.PI / 180;

function material(color: number): THREE.Material {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

/**
 * A tapered segment hanging from a pivot, with a cap at the joint.
 *
 * Eight radial sides reads as rounded at this scale while staying in the blocky, faceted style -
 * flat shading keeps the facets visible rather than smoothing them away.
 */
function segment(
  topRadius: number,
  bottomRadius: number,
  length: number,
  color: number,
): THREE.Group {
  const pivot = new THREE.Group();

  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(topRadius, bottomRadius, length, 8, 1),
    material(color),
  );
  mesh.position.y = -length / 2; // hang from the pivot rather than straddling it
  pivot.add(mesh);

  // Fills the wedge that opens up on the outside of a bend.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(topRadius, 8, 6), material(color));
  pivot.add(cap);

  return pivot;
}

interface Limb {
  upper: THREE.Group;
  lower: THREE.Group;
}

export interface Character {
  /** World-space root. Add to the scene. */
  readonly object: THREE.Object3D;
  /** Where the weapon attaches in third person. */
  readonly rightHand: THREE.Object3D;
  /** Hides the head so the camera is not inside it. */
  setFirstPerson(firstPerson: boolean): void;
  update(state: PlayerState, viewDuck: number, position: THREE.Vector3, yaw: number): void;
}

export function createCharacter(): Character {
  const root = new THREE.Group();

  // Yaw-only holder: the body turns with your heading but never pitches, so looking up and down
  // does not tip your own legs into view.
  const body = new THREE.Group();
  root.add(body);

  const hips = new THREE.Group();
  body.add(hips);

  /**
   * How far the body sits behind the camera. The camera is the player's *eyes*, at the front of
   * the head rather than the centre of the body, so everything below hangs behind it.
   */
  const HIPS_BACK = 5;
  /**
   * The chest sits further back again. Not anatomy for its own sake: with the torso directly
   * above the hips it covers the legs completely when you look straight down, since both project
   * to the same point. Offsetting it back puts the legs in front of it in view without the legs
   * having to be thrown forward - which is what made an earlier version look like the character
   * was permanently sitting down.
   */
  const TORSO_BACK = 11;
  const torsoLean = TORSO_BACK - HIPS_BACK;

  hips.position.z = HIPS_BACK;

  const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(9, 8, 10, 8, 1), material(TROUSERS));
  pelvis.position.z = torsoLean * 0.4;
  hips.add(pelvis);

  // Chest tapers up to the shoulders, so the silhouette is not a plain slab in third person.
  const chest = new THREE.Group();
  chest.position.set(0, 4, torsoLean);
  hips.add(chest);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(11, 8.5, 24, 8, 1), material(SHIRT));
  torso.position.y = 12;
  chest.add(torso);

  // Stacked so the pieces actually touch: torso tops out at local 24, the collar straddles it,
  // the neck sits on that, and the skull rests on the neck. Positioning the head off the eye
  // height instead - which is what this did first - leaves it floating above the shoulders,
  // because the eye is deliberately *inside* where the head should be.
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(7, 10, 5, 8, 1), material(SHIRT_DARK));
  collar.position.y = 24;
  chest.add(collar);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4, 4, 8, 1), material(SKIN));
  neck.position.y = 25.5;
  chest.add(neck);

  const head = new THREE.Group();
  head.position.y = 25.5;
  chest.add(head);

  const skull = new THREE.Mesh(new THREE.BoxGeometry(10.5, 10.5, 10.5), material(SKIN));
  skull.position.y = 5;
  head.add(skull);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(10.9, 3, 2), material(0x1b2430));
  visor.position.set(0, 5.5, -4.8);
  head.add(visor);

  const arms: Limb[] = [];
  const hands: THREE.Object3D[] = [];
  const upperArm = 13;
  const forearm = 12;

  for (const side of [-1, 1]) {
    const shoulder = segment(4.2, 3.4, upperArm, SHIRT);
    shoulder.position.set(side * 11, 24, 0);
    chest.add(shoulder);

    const elbow = segment(3.4, 3, forearm, SKIN);
    elbow.position.y = -upperArm;
    shoulder.add(elbow);

    const hand = new THREE.Group();
    hand.position.y = -forearm;
    elbow.add(hand);
    const fist = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), material(SKIN));
    hand.add(fist);

    arms.push({ upper: shoulder, lower: elbow });
    hands.push(hand);
  }

  const legs: Limb[] = [];
  const thigh = 17;
  const shin = 15;

  for (const side of [-1, 1]) {
    const hip = segment(5.5, 4.4, thigh, TROUSERS);
    hip.position.set(side * 6, 0, 0);
    hips.add(hip);

    const knee = segment(4.4, 3.6, shin, TROUSERS);
    knee.position.y = -thigh;
    hip.add(knee);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(8, 4.5, 13), material(BOOTS));
    foot.position.set(0, -shin - 2, -3.5);
    knee.add(foot);

    legs.push({ upper: hip, lower: knee });
  }

  let stride = 0;
  let firstPerson = true;

  return {
    object: root,
    rightHand: hands[1] ?? new THREE.Group(),

    setFirstPerson(value: boolean) {
      firstPerson = value;
      // The camera sits inside the skull in first person; rendering it there shows the inside
      // of the head, and the visor blocks the view outright.
      head.visible = !value;
      neck.visible = !value;
      // Arms belong to the weapon viewmodel in first person, and to the character in third.
      for (const arm of arms) arm.upper.visible = !value;
    },

    update(state, viewDuck, position, yaw) {
      root.position.copy(position);
      body.rotation.y = yaw;

      const hull = hullHeight(viewDuck);
      hips.position.y = hull * 0.47;

      // The upper body has to shrink with the hull, not just ride lower on it. At a fixed
      // height a ducked chest reaches above the ducked eye line and floods the view.
      chest.scale.setScalar(hull / PLAYER_HEIGHT);

      const speed = vec3.horizontalLength(state.velocity);
      const moving = speed > 20 && state.onGround;

      // Segments hang along -Y, so a positive rotation.x swings them forward and knees bend
      // negative. Getting these signs backwards folds the legs behind the player, which is
      // exactly where they cannot be seen.
      if (state.sliding) {
        // Lead leg thrown out front, trailing leg tucked underneath.
        legs[0]?.upper.rotation.set(52 * DEG, 0, 0);
        legs[0]?.lower.rotation.set(-14 * DEG, 0, 0);
        legs[1]?.upper.rotation.set(4 * DEG, 0, 0);
        legs[1]?.lower.rotation.set(-118 * DEG, 0, 0);
        chest.rotation.x = -12 * DEG;
        stride = 0;
      } else {
        chest.rotation.x = 0;

        // Idle legs hang straight down under the hips. An earlier version leaned them forward
        // so they would be easier to see, which read as the character permanently sitting.
        const crouchBend = viewDuck * 48 * DEG;
        stride += moving ? speed * 0.00035 : -stride * 0.2;

        legs.forEach(({ upper, lower }, i) => {
          const phase = i === 0 ? stride : stride + Math.PI;
          const swing = moving ? Math.sin(phase) * 30 * DEG : 0;
          upper.rotation.x = crouchBend + swing;
          // Knees only ever bend one way: backwards.
          lower.rotation.x = -crouchBend * 2 - Math.max(0, Math.sin(phase)) * 26 * DEG;
        });
      }

      if (firstPerson) return; // arms are hidden; the weapon viewmodel owns them

      // Arms counter-swing against the legs while running, and hold the weapon otherwise.
      arms.forEach(({ upper, lower }, i) => {
        const phase = i === 0 ? stride + Math.PI : stride;
        if (state.sliding) {
          upper.rotation.set(-30 * DEG, 0, (i === 0 ? -1 : 1) * 12 * DEG);
          lower.rotation.set(-50 * DEG, 0, 0);
          return;
        }
        // Right arm (index 1) stays forward on the weapon; the left supports it. Held wide
        // enough to clear the chest, or from directly behind the arms vanish into the torso
        // and the character reads as armless.
        const carry = i === 1 ? 48 * DEG : 40 * DEG;
        const swing = moving ? Math.sin(phase) * 12 * DEG : 0;
        upper.rotation.set(carry + swing, 0, (i === 0 ? 1 : -1) * 26 * DEG);
        lower.rotation.set(-40 * DEG, 0, (i === 0 ? -1 : 1) * 14 * DEG);
      });
    },
  };
}

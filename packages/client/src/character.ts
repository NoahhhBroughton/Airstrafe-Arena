// The player character: one rig, used by both camera modes.
//
// It is deliberately a single model rather than a first-person body plus a separate third-person
// one. Two models drift - a pose fixed in one stays wrong in the other, and a slide that reads
// well over the shoulder looks broken down the barrel. First person just hides the head and puts
// the camera in it.
//
// Everything is boxes: square cross-sections, tapered, flat-shaded. Limbs bend as curves rather
// than corners because each bone is a few stacked boxes sharing the bend - see rig.ts. Purely
// cosmetic: this reads player state and never writes it.

import * as THREE from "three";
import { hullHeight, vec3, PLAYER_HEIGHT, type PlayerState } from "@airstrafe-arena/shared";
import { createBone, taperedBox, type Bone } from "./rig.js";

const SKIN = 0xd8a07a;
const SHIRT = 0x46618f;
const SHIRT_DARK = 0x35496b;
const TROUSERS = 0x333b4d;
const BOOTS = 0x22262f;

const DEG = Math.PI / 180;

const material = (color: number): THREE.Material =>
  new THREE.MeshLambertMaterial({ color, flatShading: true });

interface Limb {
  upper: Bone;
  lower: Bone;
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

  const pelvis = taperedBox(18, 16, 10, material(TROUSERS));
  pelvis.position.z = torsoLean * 0.4;
  hips.add(pelvis);

  // Chest tapers out to the shoulders, so the silhouette is not a plain slab in third person.
  const chest = new THREE.Group();
  chest.position.set(0, 4, torsoLean);
  hips.add(chest);

  const torso = taperedBox(22, 17, 24, material(SHIRT));
  torso.position.y = 12;
  chest.add(torso);

  // Stacked so the pieces actually touch: torso tops out at local 24, the collar straddles it,
  // the neck sits on that, and the skull rests on the neck. Positioning the head off the eye
  // height instead - which is what this did first - leaves it floating above the shoulders,
  // because the eye is deliberately *inside* where the head should be.
  const collar = taperedBox(14, 21, 5, material(SHIRT_DARK));
  collar.position.y = 24;
  chest.add(collar);

  const neck = taperedBox(7, 8, 4, material(SKIN));
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
  const upperArmLength = 13;
  const forearmLength = 12;

  for (const side of [-1, 1]) {
    const upper = createBone(8, 6.5, upperArmLength, material(SHIRT));
    upper.pivot.position.set(side * 11, 24, 0);
    chest.add(upper.pivot);

    const lower = createBone(6.5, 5, forearmLength, material(SKIN));
    upper.tip.add(lower.pivot);

    const hand = new THREE.Group();
    lower.tip.add(hand);
    const fist = new THREE.Mesh(new THREE.BoxGeometry(5.5, 5, 5.5), material(SKIN));
    fist.position.y = -2.5;
    hand.add(fist);

    arms.push({ upper, lower });
    hands.push(hand);
  }

  const legs: Limb[] = [];
  const thighLength = 17;
  const shinLength = 15;

  for (const side of [-1, 1]) {
    const upper = createBone(11, 9, thighLength, material(TROUSERS));
    upper.pivot.position.set(side * 5.5, 0, 0);
    hips.add(upper.pivot);

    const lower = createBone(9, 7, shinLength, material(TROUSERS));
    upper.tip.add(lower.pivot);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(8, 4.5, 13), material(BOOTS));
    foot.position.set(0, -2, -3.5);
    lower.tip.add(foot);

    legs.push({ upper, lower });
  }

  let stride = 0;
  let firstPerson = true;

  /** Set a joint angle and let the parent bone take a share of it, so the bend curves. */
  const bend = (limb: Limb, upperAngle: number, lowerAngle: number) => {
    limb.upper.pivot.rotation.x = upperAngle;
    limb.lower.pivot.rotation.x = lowerAngle;
    // A third of the child's angle, spread up the parent, turns a corner into a curve.
    limb.upper.setCurve(lowerAngle * 0.33);
    limb.lower.setCurve(lowerAngle * -0.12);
  };

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
      for (const arm of arms) arm.upper.pivot.visible = !value;
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
      const moving = speed > 20 && state.onGround && !state.sliding;

      // Bones hang along -Y, so a positive rotation.x swings them forward and knees bend
      // negative. Getting these signs backwards folds the legs behind the player, which is
      // exactly where they cannot be seen.
      if (state.sliding) {
        // Lead leg thrown out front, trailing leg tucked underneath.
        if (legs[0]) bend(legs[0], 52 * DEG, -14 * DEG);
        if (legs[1]) bend(legs[1], 4 * DEG, -118 * DEG);
        chest.rotation.x = -12 * DEG;
        stride = 0;
      } else {
        chest.rotation.x = 0;

        // Idle legs hang straight down under the hips. An earlier version leaned them forward
        // so they would be easier to see, which read as the character permanently sitting.
        const crouchBend = viewDuck * 48 * DEG;
        stride += moving ? speed * 0.00045 : -stride * 0.2;

        legs.forEach((leg, i) => {
          const phase = i === 0 ? stride : stride + Math.PI;
          const swing = moving ? Math.sin(phase) * 30 * DEG : 0;
          // Knees only ever bend one way: backwards.
          bend(
            leg,
            crouchBend + swing,
            -crouchBend * 2 - Math.max(0, Math.sin(phase)) * 26 * DEG,
          );
        });
      }

      if (firstPerson) return; // arms are hidden; the weapon viewmodel owns them

      // Arms counter-swing against the legs while running, and hold the weapon otherwise.
      arms.forEach((arm, i) => {
        const phase = i === 0 ? stride + Math.PI : stride;
        if (state.sliding) {
          arm.upper.pivot.rotation.set(-30 * DEG, 0, (i === 0 ? -1 : 1) * 12 * DEG);
          arm.lower.pivot.rotation.x = -50 * DEG;
          arm.upper.setCurve(-16 * DEG);
          return;
        }
        // Right arm (index 1) stays forward on the weapon; the left supports it. Held wide
        // enough to clear the chest, or from directly behind the arms vanish into the torso
        // and the character reads as armless.
        const carry = i === 1 ? 48 * DEG : 40 * DEG;
        const swing = moving ? Math.sin(phase) * 12 * DEG : 0;
        arm.upper.pivot.rotation.set(carry + swing, 0, (i === 0 ? 1 : -1) * 26 * DEG);
        arm.lower.pivot.rotation.set(-40 * DEG, 0, (i === 0 ? -1 : 1) * 14 * DEG);
        arm.upper.setCurve(-13 * DEG);
      });
    },
  };
}

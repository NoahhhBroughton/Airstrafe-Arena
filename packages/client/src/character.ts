// The player character: one rig, used by both camera modes.
//
// It is deliberately a single model rather than a first-person body plus a separate third-person
// one. Two models drift - a pose fixed in one stays wrong in the other, and a slide that reads
// well over the shoulder looks broken down the barrel. First person just hides the head and puts
// the camera in it.
//
// Proportions are Minecraft's, 1:1. That model is 32 pixels tall - 8 head, 12 torso, 12 legs -
// and our hull is 72 units, so one pixel is 2.25 units and the three stack to exactly 72. Every
// dimension below is a pixel count times that scale, so the silhouette is the familiar one
// rather than an approximation of it.
//
// Where it departs from Minecraft is articulation: arms and legs have elbows and knees, so the
// body can hold a pose rather than swinging rigid planks. Purely cosmetic - this reads player
// state and never writes it.

import * as THREE from "three";
import { hullHeight, vec3, PLAYER_HEIGHT, type PlayerState } from "@airstrafe-arena/shared";
import { createBone, slab, solveTwoBoneIK, type Bone } from "./rig.js";
import { FORE_HAND, GRIP_HAND } from "./weapon.js";

// Exported so the first-person arms in weapon.ts are built from the same numbers and colours.
// They are separate meshes - the viewmodel needs bob and sway the world model must not have -
// so the only way they can look like the same arms is to share every dimension that defines them.
export const SKIN = 0xd8a07a;
export const SHIRT = 0x3aa0a0;
const TROUSERS = 0x3b4a8f;
const BOOTS = 0x2a2f3d;
const HAIR = 0x3b2a1e;

const DEG = Math.PI / 180;

/** Minecraft models are measured in pixels; 32 of them make our 72-unit hull. */
const PX = PLAYER_HEIGHT / 32;

const HEAD = 8 * PX;
const TORSO_W = 8 * PX;
const TORSO_H = 12 * PX;
const TORSO_D = 4 * PX;
export const LIMB = 4 * PX;
const LIMB_LEN = 12 * PX;

const material = (color: number): THREE.Material =>
  new THREE.MeshLambertMaterial({ color, flatShading: true });

interface Limb {
  upper: Bone;
  lower: Bone;
}

/** Target joint angles for one limb, in radians. */
interface Pose {
  upper: number;
  lower: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface Character {
  /** World-space root. Add to the scene. */
  readonly object: THREE.Object3D;
  /** Where the weapon attaches in third person - a chest mount, not a hand. */
  readonly weaponMount: THREE.Object3D;
  /** Hides the head so the camera is not inside it. */
  setFirstPerson(firstPerson: boolean): void;
  update(
    state: PlayerState,
    viewDuck: number,
    position: THREE.Vector3,
    yaw: number,
    dt: number,
  ): void;
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
   * How far the whole body sits behind the camera. The camera is the player's *eyes*, at the
   * front of the head rather than the centre of the body, so everything hangs behind it.
   *
   * Hips and chest share this offset, so the legs are directly under the torso. An earlier
   * version staggered them to keep the legs visible when looking straight down - but a torso
   * that overhangs its own legs is wrong from every angle that actually shows the model, and
   * third person shows it constantly.
   *
   * Deep enough that the chest is not directly underfoot. First person hides the head, so a
   * torso sitting right below the eye presents its flat top face straight up the camera and
   * reads as a cut-off neck. Set back, you look along the chest instead of down into it.
   */
  const BODY_BACK = 9;

  hips.position.z = BODY_BACK;

  const chest = new THREE.Group();
  hips.add(chest);

  const torso = slab(TORSO_W, TORSO_H, TORSO_D, material(SHIRT));
  torso.position.y = TORSO_H / 2;
  chest.add(torso);

  const head = new THREE.Group();
  head.position.y = TORSO_H;
  chest.add(head);

  const skull = slab(HEAD, HEAD, HEAD, material(SKIN));
  skull.position.y = HEAD / 2;
  head.add(skull);

  // A hair slab and a visor, so the head has a front in third person.
  const hair = slab(HEAD * 1.02, HEAD * 0.3, HEAD * 1.02, material(HAIR));
  hair.position.y = HEAD * 0.86;
  head.add(hair);

  const visor = slab(HEAD * 1.03, HEAD * 0.18, HEAD * 0.08, material(0x1b2430));
  visor.position.set(0, HEAD * 0.6, -HEAD / 2);
  head.add(visor);

  /**
   * Where the weapon rides in third person: chest height, forward and slightly right, with no
   * rotation of its own so its barrel points straight down the body's forward axis.
   *
   * Mounted here rather than parented to a hand. A weapon hanging off a hand bone inherits
   * whatever direction the forearm happens to point, which is how it ends up aimed at the
   * ground and looking one-handed. Pinned here, the arms are solved to reach *it*.
   */
  const weaponMount = new THREE.Group();
  weaponMount.position.set(2, 14, -4);
  chest.add(weaponMount);

  const arms: Limb[] = [];
  const shoulders: THREE.Vector3[] = [];
  const half = LIMB_LEN / 2;

  for (const side of [-1, 1]) {
    const upper = createBone(LIMB, LIMB, half, material(SHIRT), 1);
    const at = new THREE.Vector3((side * (TORSO_W + LIMB)) / 2, TORSO_H - LIMB / 2, 0);
    upper.pivot.position.copy(at);
    chest.add(upper.pivot);

    const lower = createBone(LIMB, LIMB, half, material(SKIN), 1);
    upper.tip.add(lower.pivot);

    const hand = slab(LIMB * 1.15, LIMB * 0.9, LIMB * 1.35, material(SKIN));
    hand.position.y = -LIMB * 0.35;
    lower.tip.add(hand);

    arms.push({ upper, lower });
    shoulders.push(at);
  }

  const legs: Limb[] = [];
  for (const side of [-1, 1]) {
    const upper = createBone(LIMB, LIMB, half, material(TROUSERS), 1);
    upper.pivot.position.set((side * LIMB) / 2, 0, 0);
    hips.add(upper.pivot);

    const lower = createBone(LIMB, LIMB, half, material(TROUSERS), 1);
    upper.tip.add(lower.pivot);

    const boot = slab(LIMB * 1.05, LIMB * 0.35, LIMB * 1.3, material(BOOTS));
    boot.position.set(0, -LIMB * 0.1, -LIMB * 0.15);
    lower.tip.add(boot);

    legs.push({ upper, lower });
  }

  let stride = 0;
  /** Eased 0..1, so entering and leaving a slide is a transition rather than a snap. */
  let slideBlend = 0;
  /** Eased 0..1 for the airborne tuck. */
  let airBlend = 0;
  /** Kicked to 1 on touchdown and decayed, driving the landing crouch. */
  let landImpulse = 0;
  let wasOnGround = true;
  let firstPerson = true;

  const applyLimb = (limb: Limb, pose: Pose) => {
    limb.upper.pivot.rotation.x = pose.upper;
    limb.lower.pivot.rotation.x = pose.lower;
  };

  // Trailing leg tucked right under, lead leg thrown out front.
  const SLIDE_LEGS: Pose[] = [
    { upper: 52 * DEG, lower: -14 * DEG },
    { upper: 4 * DEG, lower: -118 * DEG },
  ];
  /**
   * Arms stay *forward* through a slide, pulled in tight rather than swung back.
   *
   * They used to rotate behind the body, which pointed the weapon backwards in third person
   * while the first-person viewmodel still had it out front - the two views showing opposite
   * things. Every pose here has to hold the weapon where first person holds it.
   */
  const SLIDE_ARMS: Pose[] = [
    { upper: 62 * DEG, lower: -52 * DEG },
    { upper: 66 * DEG, lower: -44 * DEG },
  ];
  /**
   * Knees up, the bhop tuck. Legs hanging slack mid-flight is the single biggest tell that a
   * character is a physics capsule with limbs attached; pulling them up sells the jump.
   */
  const AIR_LEGS: Pose[] = [
    { upper: 64 * DEG, lower: -96 * DEG },
    { upper: 42 * DEG, lower: -74 * DEG },
  ];

  // Grip points in chest space. The mount has no rotation, so these are just offsets from it.
  const gripTarget = weaponMount.position.clone().add(GRIP_HAND);
  const foreTarget = weaponMount.position.clone().add(FORE_HAND);
  // Elbows drop back and out, away from the body.
  const ELBOW_POLE = [new THREE.Vector3(-0.7, -1, 0.6), new THREE.Vector3(0.7, -1, 0.6)];

  return {
    object: root,
    weaponMount,

    setFirstPerson(value: boolean) {
      firstPerson = value;
      // The camera sits inside the skull in first person; rendering it there shows the inside
      // of the head, and the visor blocks the view outright.
      head.visible = !value;
      // Arms belong to the weapon viewmodel in first person, and to the character in third.
      for (const arm of arms) arm.upper.pivot.visible = !value;
    },

    update(state, viewDuck, position, yaw, dt) {
      root.position.copy(position);
      body.rotation.y = yaw;

      // Ease toward the slide pose instead of switching to it. Snapping between two poses in a
      // single frame is the most jarring thing the model does, and a slide is entered at speed.
      const target = state.sliding ? 1 : 0;
      slideBlend += (target - slideBlend) * (1 - Math.exp(-dt / 0.09));
      if (Math.abs(target - slideBlend) < 0.001) slideBlend = target;

      // Airborne tuck, and the compression on touchdown. Leaving the ground eases out over a
      // little longer than coming back to it, so a bhop chain does not strobe between poses.
      const airTarget = state.onGround || state.sliding ? 0 : 1;
      airBlend += (airTarget - airBlend) * (1 - Math.exp(-dt / (airTarget > 0 ? 0.11 : 0.07)));

      if (!wasOnGround && state.onGround) landImpulse = 1;
      wasOnGround = state.onGround;
      landImpulse = Math.max(0, landImpulse - dt / 0.26);
      // Squared so the absorb snaps in on contact and eases out, rather than fading linearly.
      const absorb = landImpulse * landImpulse * 30 * DEG;

      const hull = hullHeight(viewDuck);
      // Hips sit at the top of the legs - 12 of the 32 pixels up - not at an eyeballed fraction.
      // The landing dip is visual only: the camera keeps riding the simulated eye height, so
      // the body sinks under it and springs back rather than the whole view lurching.
      hips.position.y = hull * (LIMB_LEN / PLAYER_HEIGHT) - landImpulse * landImpulse * 5;

      // The upper body has to shrink with the hull, not just ride lower on it. At a fixed
      // height a ducked chest reaches above the ducked eye line and floods the view.
      chest.scale.setScalar(hull / PLAYER_HEIGHT);
      // Slide pulls the chest back as well as tilting it: ducked and leaning, its top corner
      // otherwise passes close enough to the eye to show the inside of the torso.
      chest.position.z = slideBlend * 7;
      // A few degrees of forward posture at rest. Upright, the chest presents a perfectly flat
      // top face to a camera looking straight down at it, which is both unnatural and the
      // hardest thing to read - every pixel of it catches the light identically.
      chest.rotation.x = lerp(7 * DEG, -14 * DEG, slideBlend);

      const speed = vec3.horizontalLength(state.velocity);
      const moving = speed > 20 && state.onGround && !state.sliding;

      // Bones hang along -Y, so a positive rotation.x swings them forward and knees bend
      // negative. Getting these signs backwards folds the legs behind the player, which is
      // exactly where they cannot be seen.
      const crouchBend = viewDuck * 48 * DEG;
      stride += moving ? speed * 0.00045 : -stride * 0.2;

      legs.forEach((leg, i) => {
        const phase = i === 0 ? stride : stride + Math.PI;
        const swing = moving ? Math.sin(phase) * 30 * DEG : 0;
        const walk: Pose = {
          upper: crouchBend + swing,
          // Knees only ever bend one way: backwards.
          lower: -crouchBend * 2 - Math.max(0, Math.sin(phase)) * 26 * DEG,
        };

        // Layered ground -> air -> slide, so a slide entered out of a jump resolves cleanly
        // instead of fighting between two poses.
        const air = AIR_LEGS[i] ?? walk;
        const slide = SLIDE_LEGS[i] ?? walk;
        const grounded: Pose = {
          upper: walk.upper + absorb * 0.55,
          lower: walk.lower - absorb,
        };
        const airborne: Pose = {
          upper: lerp(grounded.upper, air.upper, airBlend),
          lower: lerp(grounded.lower, air.lower, airBlend),
        };
        applyLimb(leg, {
          upper: lerp(airborne.upper, slide.upper, slideBlend),
          lower: lerp(airborne.lower, slide.lower, slideBlend),
        });
      });

      if (firstPerson) return; // arms are hidden; the weapon viewmodel owns them

      // Both hands are solved onto the weapon: right on the grip, left forward under the
      // barrel. Two hands on one mounted weapon is what makes it read as *held* and aimed,
      // rather than dangling from whichever way an arm happened to be posed.
      //
      // A small breathing sway on the mount, and a bit more of it while running, so the hold
      // is not perfectly rigid - the arms follow because they track the weapon.
      const sway = moving ? Math.sin(stride) * 1.2 : 0;
      weaponMount.position.z = -4 + sway * 0.6 - slideBlend * 2;
      weaponMount.position.y = 14 + sway * 0.4 - slideBlend * 3;
      weaponMount.rotation.x = slideBlend * 6 * DEG;

      const grip = weaponMount.position.clone().add(GRIP_HAND);
      const fore = weaponMount.position.clone().add(FORE_HAND);
      gripTarget.copy(grip);
      foreTarget.copy(fore);

      arms.forEach((arm, i) => {
        const target = i === 1 ? gripTarget : foreTarget;
        const shoulder = shoulders[i];
        const pole = ELBOW_POLE[i];
        if (!shoulder || !pole) return;
        solveTwoBoneIK(arm.upper, arm.lower, shoulder, target.clone(), half, half, pole.clone());
      });
    },
  };
}

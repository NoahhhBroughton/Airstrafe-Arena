// The instagib laser weapon.
//
// It has no behaviour yet - no firing, no hit registration, that is Phase 4. This exists so the
// movement can be tuned against what the game will actually look like from behind the gun, since
// bob and sway are a large part of how fast movement *feels*.
//
// The model is re-parented rather than duplicated: in first person it hangs off the camera and
// carries its own arms, in third person it hangs off the character's hand and the character's
// arms take over. One model, so the two views can never disagree about what you are holding.

import * as THREE from "three";
import { vec3, MAX_GROUND_SPEED, type PlayerState } from "@airstrafe-arena/shared";
import { stretchBetween, taperedBox } from "./rig.js";

const SKIN = 0xd8a07a;
const SLEEVE = 0x46618f;
const GUNMETAL = 0x2a2e38;
const GUN_TRIM = 0x555c6b;
const LASER = 0x5fd8ff;

const DEG = Math.PI / 180;

const material = (color: number): THREE.Material =>
  new THREE.MeshLambertMaterial({ color, flatShading: true });

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
}

/** Unlit, so the emitter reads as its own light source rather than a pale blue block in shade. */
function glow(w: number, h: number, d: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ color: LASER }),
  );
}

/**
 * Held low and right, angled slightly inward, the way a shouldered weapon reads first-person.
 *
 * The Z matters more than it looks: pulled in close, the arms are only a dozen units from a
 * near plane of 1 and read as enormous slabs rather than limbs. Pushing the whole assembly out
 * shrinks it in frame without changing its proportions.
 */
const REST = new THREE.Vector3(10, -10, -30);

/**
 * Where the hands sit on the weapon, in its local space, and where the arms enter frame from.
 *
 * Posing arms by rotation alone leaves the hand wherever the angles happen to land, which is
 * how they end up buried inside the gun. Pinning the hands to the grip and fore-end and then
 * *stretching* the forearms out to meet them makes the grip correct by construction.
 */
const GRIP_HAND = new THREE.Vector3(0, -4, 5);
const FORE_HAND = new THREE.Vector3(0, -3.5, -13);
// Elbows enter frame from the lower right. Kept well forward of the camera - drawn back toward
// it they pass within a few units of the near plane and fill the screen edge.
const RIGHT_ELBOW = new THREE.Vector3(5, -17, 15);
const LEFT_ELBOW = new THREE.Vector3(-5, -16, 2);

export interface Weapon {
  readonly object: THREE.Object3D;
  /** Camera in first person, the character's hand in third. Arms follow. */
  attachTo(parent: THREE.Object3D, firstPerson: boolean): void;
  update(state: PlayerState, viewDuck: number, yaw: number, dt: number): void;
}

export function createWeapon(): Weapon {
  const root = new THREE.Group();

  const receiver = box(4.5, 5, 22, GUNMETAL);
  receiver.position.z = -2;
  root.add(receiver);

  const barrel = box(3, 3, 16, GUN_TRIM);
  barrel.position.set(0, 0.6, -19);
  root.add(barrel);

  const emitter = glow(4, 4, 3);
  emitter.position.set(0, 0.6, -27.5);
  root.add(emitter);

  const core = glow(1.6, 1.6, 12);
  core.position.set(0, 3, -8);
  root.add(core);

  const stock = box(4, 6, 8, GUNMETAL);
  stock.position.set(0, -1, 11);
  root.add(stock);

  const grip = taperedBox(4, 3, 9, material(GUNMETAL));
  grip.position.set(0, -4.5, 4);
  grip.rotation.x = -18 * DEG;
  root.add(grip);

  // First-person arms. Hidden in third person, where the character's own arms hold the weapon.
  const viewArms = new THREE.Group();
  root.add(viewArms);

  const makeArm = (handAt: THREE.Vector3, elbowAt: THREE.Vector3) => {
    // Unit-height geometry, so stretchBetween can scale it to the exact reach.
    const forearm = taperedBox(6, 4.5, 1, material(SLEEVE));
    viewArms.add(forearm);
    stretchBetween(forearm, elbowAt, handAt);

    const hand = box(5, 5, 6, SKIN);
    hand.position.copy(handAt);
    viewArms.add(hand);
  };

  makeArm(GRIP_HAND, RIGHT_ELBOW);
  makeArm(FORE_HAND, LEFT_ELBOW);

  let bobPhase = 0;
  let previousYaw = 0;
  let swayYaw = 0;
  let swayPitch = 0;
  let firstPerson = true;
  const offset = new THREE.Vector3();

  return {
    object: root,

    attachTo(parent: THREE.Object3D, isFirstPerson: boolean) {
      parent.add(root);
      firstPerson = isFirstPerson;
      viewArms.visible = isFirstPerson;

      if (isFirstPerson) return;
      // In the hand, the weapon is small, local and unswayed - the character's arm animation
      // is what moves it.
      root.position.set(0, -3, -7);
      root.rotation.set(-80 * DEG, 0, 0);
      root.scale.setScalar(0.85);
    },

    update(state, viewDuck, yaw, dt) {
      if (!firstPerson) return; // posed by the character's hand instead

      root.scale.setScalar(1);

      const speed = vec3.horizontalLength(state.velocity);
      // Sliding is not walking. Left in, a 750 u/s slide drives the bob at several times
      // running cadence and the weapon visibly shakes itself apart.
      const walking = speed > 20 && state.onGround && !state.sliding;

      // Bob is what sells speed in first person; without it, sprinting and standing still look
      // identical from behind the gun. Clamped to run speed so anything faster - a bhop landing,
      // a ramp exit - bobs at the same cadence rather than a frantic one.
      const cadence = Math.min(speed, MAX_GROUND_SPEED);
      bobPhase += walking ? cadence * dt * 0.055 : 0;
      const bob = walking ? (cadence / MAX_GROUND_SPEED) * 1.4 : 0;

      // Sway lags the view: turn fast and the weapon trails, then catches up. Taken from the
      // yaw delta rather than raw mouse input so it behaves the same at any sensitivity.
      let yawDelta = yaw - previousYaw;
      // Yaw is unwrapped and runs away while strafing; only the change matters here.
      if (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
      if (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
      previousYaw = yaw;

      const follow = 1 - Math.exp(-dt / 0.08);
      // A slide turns the whole body with the mouse, so the raw delta is large and constant.
      // Damping it there keeps the weapon steady while you steer.
      const swayScale = state.sliding ? 4 : 12;
      const targetYaw = Math.max(-1, Math.min(1, yawDelta * swayScale));
      const targetPitch = state.onGround ? 0 : Math.max(-1, Math.min(1, state.velocity.y / 600));
      swayYaw += (targetYaw - swayYaw) * follow;
      swayPitch += (targetPitch - swayPitch) * follow;

      offset.set(
        Math.cos(bobPhase) * bob - swayYaw * 3,
        Math.abs(Math.sin(bobPhase)) * bob * 0.8 - viewDuck * 1.5 + swayPitch * 2,
        0,
      );
      // Tucked in tight during a slide, clear of the leg thrown out in front of it.
      if (state.sliding) {
        offset.x -= 2;
        offset.y -= 3;
      }

      root.position.copy(REST).add(offset);
      root.rotation.set(
        swayPitch * 0.05 + (state.sliding ? 8 * DEG : 0),
        -6 * DEG - swayYaw * 0.06,
        3 * DEG + swayYaw * 0.05,
      );
    },
  };
}

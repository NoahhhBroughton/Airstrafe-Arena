// Pointer lock, keyboard state, and view angles.
//
// Mouse deltas accumulate into yaw/pitch as they arrive, at mouse polling rate rather than tick
// rate - aiming should never feel quantized to 64Hz. The simulation samples whatever yaw is
// current when a tick runs.

import type { PlayerInput } from "@airstrafe-arena/shared";

/**
 * Source's m_yaw: degrees of rotation per unit of raw mouse movement, before sensitivity.
 * Keeping this identical means a CS player's sensitivity number transfers directly.
 */
const DEGREES_PER_COUNT = 0.022;
const DEG_TO_RAD = Math.PI / 180;

/** Just short of straight up/down - exactly 90 makes the view basis degenerate. */
const MAX_PITCH = 89.9 * DEG_TO_RAD;

export interface InputState {
  readonly yaw: number;
  readonly pitch: number;
  readonly locked: boolean;
  sensitivity: number;
  /** Point the view somewhere, e.g. after teleporting to a test spot. */
  setYaw(yaw: number): void;
  /** Snapshot of the movement input for one simulation tick. */
  sample(): PlayerInput;
  dispose(): void;
}

export function createInput(canvas: HTMLCanvasElement, initialYaw: number): InputState {
  const keys = new Set<string>();
  let yaw = initialYaw;
  let pitch = 0;
  let locked = false;
  let sensitivity = 2.0;

  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    // Space scrolls the page otherwise, which is very noticeable while bhopping.
    if (e.code === "Space") e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);

  const onMouseMove = (e: MouseEvent) => {
    if (!locked) return;
    const scale = DEGREES_PER_COUNT * sensitivity * DEG_TO_RAD;
    yaw -= e.movementX * scale;
    pitch -= e.movementY * scale;
    pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch));
    // Yaw is deliberately unclamped and unwrapped (MOVEMENT_SPEC.md): strafing spins the view
    // continuously, and wrapping it would put a discontinuity in the middle of a turn.
  };

  const onPointerLockChange = () => {
    locked = document.pointerLockElement === canvas;
    // Keys held when focus is lost would otherwise stick down forever.
    if (!locked) keys.clear();
  };

  const onClick = () => {
    if (!locked) void canvas.requestPointerLock();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => keys.clear());
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("pointerlockchange", onPointerLockChange);
  canvas.addEventListener("click", onClick);

  const axis = (positive: string, negative: string): number =>
    (keys.has(positive) ? 1 : 0) - (keys.has(negative) ? 1 : 0);

  return {
    get yaw() {
      return yaw;
    },
    get pitch() {
      return pitch;
    },
    get locked() {
      return locked;
    },
    get sensitivity() {
      return sensitivity;
    },
    set sensitivity(value: number) {
      sensitivity = value;
    },

    setYaw(value: number) {
      yaw = value;
      pitch = 0;
    },

    sample(): PlayerInput {
      // Unfocused means no input at all, rather than freezing the last one - otherwise
      // alt-tabbing mid-strafe leaves the player running into a wall.
      if (!locked) return { forward: 0, right: 0, jump: false, yaw };
      return {
        forward: axis("KeyW", "KeyS"),
        right: axis("KeyD", "KeyA"),
        jump: keys.has("Space"),
        yaw,
      };
    },

    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      canvas.removeEventListener("click", onClick);
    },
  };
}

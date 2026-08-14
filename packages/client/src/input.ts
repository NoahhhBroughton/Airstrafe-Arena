// Pointer lock, keyboard state, and view angles.
//
// Mouse deltas accumulate into yaw/pitch as they arrive, at mouse polling rate rather than tick
// rate - aiming should never feel quantized to 64Hz. The simulation samples whatever yaw is
// current when a tick runs.

import type { PlayerInput } from "@airstrafe-arena/shared";
import type { SettingsStore } from "./settings.js";

const DEG_TO_RAD = Math.PI / 180;

/** Just short of straight up/down - exactly 90 makes the view basis degenerate. */
const MAX_PITCH = 89.9 * DEG_TO_RAD;

/**
 * `requestPointerLock` accepts an options bag in browsers that support unadjusted movement, and
 * returns a promise there. TypeScript's DOM lib types it as the older no-argument, void-returning
 * form depending on version, so this narrows it locally rather than reaching for `any`.
 */
interface PointerLockElement {
  requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | undefined;
}

export interface InputState {
  readonly yaw: number;
  readonly pitch: number;
  readonly locked: boolean;
  /**
   * Whether the browser actually granted unadjusted (OS-acceleration-free) movement. Surfaced
   * because it decides whether the sensitivity number really matches Source or only
   * approximately - the user deserves to know which.
   */
  readonly rawInputActive: boolean;
  setYaw(yaw: number): void;
  requestLock(): void;
  /** Snapshot of the movement input for one simulation tick. */
  sample(): PlayerInput;
  dispose(): void;
}

export function createInput(
  canvas: HTMLCanvasElement,
  settings: SettingsStore,
  initialYaw: number,
): InputState {
  const keys = new Set<string>();
  let yaw = initialYaw;
  let pitch = 0;
  let locked = false;
  let rawInputActive = false;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return; // typing in the settings panel
    keys.add(e.code);
    // Space scrolls the page otherwise, which is very noticeable while bhopping.
    if (e.code === "Space") e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);

  const onMouseMove = (e: MouseEvent) => {
    if (!locked) return;
    // Source's formula exactly: degrees = m_yaw * sensitivity * raw counts. Given raw input,
    // this makes sensitivity 1 here turn the same arc as sensitivity 1 in CS.
    const scale = settings.current.mYaw * settings.current.sensitivity * DEG_TO_RAD;
    yaw -= e.movementX * scale;
    pitch -= e.movementY * scale;
    pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch));
    // Yaw is deliberately unclamped and unwrapped (MOVEMENT_SPEC.md): strafing spins the view
    // continuously, and wrapping it would put a discontinuity in the middle of a turn.
  };

  const onPointerLockChange = () => {
    locked = document.pointerLockElement === canvas;
    // Keys held when focus is lost would otherwise stick down forever.
    if (!locked) {
      keys.clear();
      rawInputActive = false;
    }
  };

  const requestLock = (): void => {
    if (locked) return;
    const element = canvas as unknown as PointerLockElement;

    if (settings.current.rawInput) {
      try {
        const pending = element.requestPointerLock({ unadjustedMovement: true });
        if (pending instanceof Promise) {
          pending.then(
            () => {
              rawInputActive = true;
            },
            () => {
              // The browser or platform can't provide unadjusted movement. Fall back to the
              // ordinary lock so the game still plays - just not perfectly Source-matched.
              rawInputActive = false;
              element.requestPointerLock();
            },
          );
          return;
        }
        // No promise means an older implementation that ignored the options bag entirely, so
        // the lock is proceeding but without raw movement.
        rawInputActive = false;
        return;
      } catch {
        rawInputActive = false;
      }
    }

    rawInputActive = false;
    const pending = element.requestPointerLock();
    if (pending instanceof Promise) pending.catch(() => undefined);
  };

  const onClick = () => requestLock();

  const onBlur = () => keys.clear();

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
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
    get rawInputActive() {
      return rawInputActive;
    },

    setYaw(value: number) {
      yaw = value;
      pitch = 0;
    },

    requestLock,

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
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      canvas.removeEventListener("click", onClick);
    },
  };
}

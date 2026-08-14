// Pointer lock, bind-driven input state, and view angles.
//
// Mouse deltas accumulate into yaw/pitch as they arrive, at mouse polling rate rather than tick
// rate - aiming should never feel quantized to 64Hz. The simulation samples whatever yaw is
// current when a tick runs.
//
// Nothing here knows which physical key does what; it resolves everything through the bind
// table in settings. See keybinds.ts for the token format.

import type { PlayerInput } from "@airstrafe-arena/shared";
import type { SettingsStore } from "./settings.js";
import {
  isPulseToken,
  tokenFromKeyboard,
  tokenFromMouse,
  tokenFromWheel,
} from "./keybinds.js";

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
  /** Edge-triggered actions (respawn, teleports). Only fires while the pointer is locked. */
  onAction(listener: (actionId: string) => void): void;
  /**
   * Suspend all game input, for while the settings screen is capturing a bind. Without this,
   * pressing W to rebind it would also walk the player forward.
   */
  setSuspended(suspended: boolean): void;
  /** Snapshot of the movement input for one simulation tick. */
  sample(): PlayerInput;
  dispose(): void;
}

export function createInput(
  canvas: HTMLCanvasElement,
  settings: SettingsStore,
  initialYaw: number,
): InputState {
  /** Tokens currently held down. */
  const held = new Set<string>();
  /**
   * Tokens fired since the last tick was sampled. A wheel notch has no "release" event, so it
   * is modelled as a single tick of being pressed - which is exactly what makes wheel-jump work
   * for bhop timing.
   */
  const pulses = new Set<string>();

  const actionListeners: ((actionId: string) => void)[] = [];

  let yaw = initialYaw;
  let pitch = 0;
  let locked = false;
  let rawInputActive = false;
  let suspended = false;

  /** Every action currently bound to `token`. */
  const actionsFor = (token: string): string[] => {
    const matches: string[] = [];
    for (const [actionId, pair] of Object.entries(settings.current.binds)) {
      if (pair[0] === token || pair[1] === token) matches.push(actionId);
    }
    return matches;
  };

  const isActive = (actionId: string): boolean => {
    const pair = settings.current.binds[actionId];
    if (!pair) return false;
    for (const token of pair) {
      if (token && (held.has(token) || pulses.has(token))) return true;
    }
    return false;
  };

  const press = (token: string): void => {
    if (suspended) return;
    if (isPulseToken(token)) pulses.add(token);
    else held.add(token);
    // Menu open means no game actions - otherwise clicking around the settings screen would
    // teleport you.
    if (!locked) return;
    for (const actionId of actionsFor(token)) {
      for (const listener of actionListeners) listener(actionId);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return; // typing in a settings field
    const token = tokenFromKeyboard(e);
    if (locked && (token === "Space" || token.startsWith("Arrow"))) e.preventDefault();
    if (e.repeat) return; // auto-repeat is not a new press
    press(token);
  };

  const onKeyUp = (e: KeyboardEvent) => held.delete(tokenFromKeyboard(e));

  const onMouseDown = (e: MouseEvent) => {
    if (!locked) return; // clicks in the menu belong to the menu
    press(tokenFromMouse(e));
  };
  const onMouseUp = (e: MouseEvent) => held.delete(tokenFromMouse(e));

  const onWheel = (e: WheelEvent) => {
    if (!locked) return;
    e.preventDefault(); // don't scroll the page while playing
    const token = tokenFromWheel(e);
    if (token) press(token);
  };

  const onContextMenu = (e: MouseEvent) => {
    // So right-click can be bound without a context menu appearing over the game.
    if (locked) e.preventDefault();
  };

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

  const releaseAll = () => {
    held.clear();
    pulses.clear();
  };

  const onPointerLockChange = () => {
    locked = document.pointerLockElement === canvas;
    // Keys held when focus is lost would otherwise stick down forever.
    if (!locked) {
      releaseAll();
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
  const onBlur = () => releaseAll();

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("wheel", onWheel, { passive: false });
  document.addEventListener("contextmenu", onContextMenu);
  document.addEventListener("pointerlockchange", onPointerLockChange);
  canvas.addEventListener("click", onClick);

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

    onAction(listener) {
      actionListeners.push(listener);
    },

    setSuspended(value: boolean) {
      suspended = value;
      if (value) releaseAll();
    },

    sample(): PlayerInput {
      // Unfocused means no input at all, rather than freezing the last one - otherwise
      // alt-tabbing mid-strafe leaves the player running into a wall.
      if (!locked || suspended) {
        pulses.clear();
        return { forward: 0, right: 0, jump: false, yaw };
      }

      const input: PlayerInput = {
        forward: (isActive("moveForward") ? 1 : 0) - (isActive("moveBack") ? 1 : 0),
        right: (isActive("moveRight") ? 1 : 0) - (isActive("moveLeft") ? 1 : 0),
        jump: isActive("jump"),
        yaw,
      };
      // Pulses last exactly one tick. Cleared after sampling rather than on the next event so
      // a wheel notch always produces a press, however the frame boundaries fall.
      pulses.clear();
      return input;
    },

    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      canvas.removeEventListener("click", onClick);
    },
  };
}

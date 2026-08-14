// Keybinds: the action list, the token format, and conflict resolution.
//
// Every action gets two slots, primary and secondary, because the classic bhop setup is jump on
// both Space and the mouse wheel - hold one for chains, flick the other for precise timing.
//
// A bind token is a string in one of three shapes:
//   "KeyW", "Space", "Digit1", ...   keyboard, straight from KeyboardEvent.code
//   "Mouse0".."Mouse4"               mouse buttons, straight from MouseEvent.button
//   "WheelUp" / "WheelDown"          wheel notches
// Storing the raw platform value keeps the token stable across locales and layouts; the
// human-facing name is produced by describeToken instead.

import type { MapSpot } from "@airstrafe-arena/shared";

/** Primary and secondary. Either may be null, meaning unbound. */
export type BindPair = [string | null, string | null];
export type Binds = Record<string, BindPair>;

export interface ActionDef {
  id: string;
  label: string;
  group: string;
}

export const CORE_ACTIONS: readonly ActionDef[] = [
  { id: "moveForward", label: "Move forward", group: "Move" },
  { id: "moveBack", label: "Move back", group: "Move" },
  { id: "moveLeft", label: "Strafe left", group: "Move" },
  { id: "moveRight", label: "Strafe right", group: "Move" },
  { id: "jump", label: "Jump", group: "Move" },
  { id: "crouch", label: "Crouch", group: "Move" },
  { id: "respawn", label: "Respawn", group: "Debug" },
];

export const spotActionId = (index: number): string => `spot${index + 1}`;

/** Core actions plus one teleport action per spot the loaded map defines. */
export function buildActions(spots: readonly MapSpot[]): ActionDef[] {
  return [
    ...CORE_ACTIONS,
    ...spots.map((spot, i) => ({
      id: spotActionId(i),
      label: `Teleport: ${spot.name}`,
      group: "Debug",
    })),
  ];
}

export function defaultBinds(spots: readonly MapSpot[]): Binds {
  const binds: Binds = {
    moveForward: ["KeyW", null],
    moveBack: ["KeyS", null],
    moveLeft: ["KeyA", null],
    moveRight: ["KeyD", null],
    // Secondary is deliberately empty. Wheel-jump is the obvious thing to put here, but it is
    // a preference, not a default - an unasked-for wheel bind means every stray scroll jumps.
    jump: ["Space", null],
    crouch: ["ControlLeft", null],
    respawn: ["KeyR", null],
  };
  spots.forEach((_, i) => {
    binds[spotActionId(i)] = [i < 9 ? `Digit${i + 1}` : null, null];
  });
  return binds;
}

const NAMED_TOKENS: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  ShiftLeft: "Left Shift",
  ShiftRight: "Right Shift",
  ControlLeft: "Left Ctrl",
  ControlRight: "Right Ctrl",
  AltLeft: "Left Alt",
  AltRight: "Right Alt",
  ArrowUp: "Up Arrow",
  ArrowDown: "Down Arrow",
  ArrowLeft: "Left Arrow",
  ArrowRight: "Right Arrow",
  CapsLock: "Caps Lock",
  WheelUp: "Wheel Up",
  WheelDown: "Wheel Down",
};

/**
 * Mouse button numbering follows Source's naming, not the DOM's: MOUSE1 is left, MOUSE2 is
 * right, MOUSE3 is middle. The DOM orders them left/middle/right, so this is not off-by-one -
 * it is a deliberate remap so the label matches what a CS player expects to read.
 */
const MOUSE_NAMES: Record<string, string> = {
  Mouse0: "Mouse 1",
  Mouse1: "Mouse 3",
  Mouse2: "Mouse 2",
  Mouse3: "Mouse 4",
  Mouse4: "Mouse 5",
};

export function describeToken(token: string | null): string {
  if (!token) return "—";
  const named = NAMED_TOKENS[token] ?? MOUSE_NAMES[token];
  if (named) return named;
  if (token.startsWith("Key")) return token.slice(3);
  if (token.startsWith("Digit")) return token.slice(5);
  if (token.startsWith("Numpad")) return `Num ${token.slice(6)}`;
  return token;
}

export const tokenFromKeyboard = (e: KeyboardEvent): string => e.code;
export const tokenFromMouse = (e: MouseEvent): string => `Mouse${e.button}`;
export const tokenFromWheel = (e: WheelEvent): string | null => {
  if (e.deltaY < 0) return "WheelUp";
  if (e.deltaY > 0) return "WheelDown";
  return null; // horizontal-only scroll; nothing to bind
};

/** A wheel notch is an impulse, not a state - it has no "released" event to wait for. */
export const isPulseToken = (token: string): boolean =>
  token === "WheelUp" || token === "WheelDown";

export interface ClearedBind {
  actionId: string;
  slot: number;
}

export interface AssignResult {
  binds: Binds;
  /** Binds removed to make room, so the UI can say what it took away. */
  cleared: ClearedBind[];
}

/**
 * Bind `token` to one slot, removing it from every other slot first.
 *
 * A token bound to two actions at once is ambiguous, so rebinding always steals rather than
 * duplicating. The caller is expected to tell the player what was taken - silently unbinding
 * their jump key because they reused the same button is how people end up thinking the game is
 * broken.
 */
export function assignBind(
  binds: Binds,
  actionId: string,
  slot: number,
  token: string,
): AssignResult {
  const next: Binds = {};
  const cleared: ClearedBind[] = [];

  for (const [id, pair] of Object.entries(binds)) {
    const copy: BindPair = [pair[0], pair[1]];
    for (let i = 0; i < 2; i++) {
      if (copy[i] !== token) continue;
      if (id === actionId && i === slot) continue; // already where we want it
      copy[i] = null;
      cleared.push({ actionId: id, slot: i });
    }
    next[id] = copy;
  }

  const target: BindPair = next[actionId] ?? [null, null];
  target[slot] = token;
  next[actionId] = target;

  return { binds: next, cleared };
}

export function clearBind(binds: Binds, actionId: string, slot: number): Binds {
  const next: Binds = { ...binds };
  const pair = next[actionId];
  if (!pair) return next;
  const copy: BindPair = [pair[0], pair[1]];
  copy[slot] = null;
  next[actionId] = copy;
  return next;
}

/** Drop unknown actions and fill in missing ones, so stored binds survive an action list change. */
export function reconcileBinds(stored: unknown, actions: readonly ActionDef[], fallback: Binds): Binds {
  const source =
    typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  const result: Binds = {};

  for (const action of actions) {
    const raw = source[action.id];
    const base = fallback[action.id] ?? [null, null];
    if (!Array.isArray(raw)) {
      result[action.id] = [base[0], base[1]];
      continue;
    }
    const slot = (i: number): string | null => {
      const value: unknown = raw[i];
      return typeof value === "string" && value.length > 0 ? value : null;
    };
    result[action.id] = [slot(0), slot(1)];
  }
  return result;
}

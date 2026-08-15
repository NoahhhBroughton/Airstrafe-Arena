// Player settings, persisted to localStorage.
//
// Movement values here are *client-side tuning overrides* for Phase 1 only. The defaults live
// in packages/shared/constants.ts and stay the source of truth; this exists so a tuning session
// is "drag a slider and feel it" instead of "edit a constant and rebuild". Phase 3 moves
// authority for them to the server - a client choosing its own air acceleration is a client
// that outruns everyone else.

import {
  AIR_ACCEL,
  AIR_WISH_SPEED_CAP,
  AUTO_BHOP_ENABLED,
  SLIDE_BOOST_SPEED,
  SLIDE_ENABLED,
  type MapSpot,
} from "@airstrafe-arena/shared";
import { defaultBinds, reconcileBinds, type ActionDef, type Binds } from "./keybinds.js";

export interface Settings {
  /**
   * Source-compatible sensitivity. Degrees turned per unit of raw mouse movement is
   * `mYaw * sensitivity`, which is exactly Source's formula - so sensitivity 1 here turns the
   * same distance as sensitivity 1 in CS, provided raw input is active (see `rawInput`).
   */
  sensitivity: number;
  /** Source's `m_yaw`. 0.022 is the default and almost nobody changes it. */
  mYaw: number;
  /**
   * Ask the browser for unadjusted pointer movement, bypassing the OS pointer-acceleration
   * curve. Without this, `movementX` is the *accelerated* cursor delta: flick fast and you turn
   * further than the same distance moved slowly, and no sensitivity number can match Source
   * because the relationship isn't linear.
   */
  rawInput: boolean;
  /** Horizontal FOV at 4:3, the way Source quotes it. CS's default is 90. */
  fov: number;
  /** Which shoulder the third-person camera sits over. */
  thirdPersonLeftShoulder: boolean;

  autoBhop: boolean;
  airAccel: number;
  airWishSpeedCap: number;

  slide: boolean;
  slideBoostSpeed: number;

  binds: Binds;
}

/** Scalar defaults. Binds depend on the loaded map's spots, so they're filled in per-store. */
export const DEFAULT_SETTINGS: Omit<Settings, "binds"> = {
  sensitivity: 1,
  mYaw: 0.022,
  rawInput: true,
  fov: 90,
  thirdPersonLeftShoulder: false,
  autoBhop: AUTO_BHOP_ENABLED,
  airAccel: AIR_ACCEL,
  airWishSpeedCap: AIR_WISH_SPEED_CAP,
  slide: SLIDE_ENABLED,
  slideBoostSpeed: SLIDE_BOOST_SPEED,
};

const STORAGE_KEY = "airstrafe-arena.settings";

interface Bounds {
  min: number;
  max: number;
}

const NUMERIC_BOUNDS: Record<string, Bounds> = {
  sensitivity: { min: 0.01, max: 20 },
  mYaw: { min: 0.001, max: 1 },
  fov: { min: 60, max: 140 },
  airAccel: { min: 1, max: 2000 },
  airWishSpeedCap: { min: 1, max: 500 },
  slideBoostSpeed: { min: 0, max: 3000 },
};

function clampNumber(key: string, value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const bounds = NUMERIC_BOUNDS[key];
  if (!bounds) return value;
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/**
 * Merge stored values over the defaults, field by field. Anything missing, the wrong type, or
 * out of range falls back - so a settings file from an older build, or one hand-edited into
 * nonsense, degrades to a working game rather than an unbootable one.
 */
function coerce(raw: unknown, defaults: Settings, actions: readonly ActionDef[]): Settings {
  const source =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const result: Settings = { ...defaults, binds: { ...defaults.binds } };

  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Omit<Settings, "binds">)[]) {
    const value = source[key];
    const fallback = DEFAULT_SETTINGS[key];
    if (typeof fallback === "boolean") {
      if (typeof value === "boolean") result[key] = value as never;
    } else if (typeof value === "number") {
      result[key] = clampNumber(key, value, fallback) as never;
    }
  }

  result.binds = reconcileBinds(source["binds"], actions, defaults.binds);
  return result;
}

export interface SettingsStore {
  readonly current: Readonly<Settings>;
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  reset(): void;
  subscribe(listener: (settings: Readonly<Settings>) => void): void;
}

export function createSettingsStore(
  actions: readonly ActionDef[],
  spots: readonly MapSpot[],
): SettingsStore {
  const defaults: Settings = { ...DEFAULT_SETTINGS, binds: defaultBinds(spots) };

  let settings: Settings;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    settings = coerce(stored ? JSON.parse(stored) : {}, defaults, actions);
  } catch {
    // Private browsing, disabled storage, or corrupt JSON. None of these should stop the game.
    settings = { ...defaults };
  }

  const listeners: ((settings: Readonly<Settings>) => void)[] = [];

  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Non-fatal: settings just won't survive a reload.
    }
    for (const listener of listeners) listener(settings);
  };

  return {
    get current() {
      return settings;
    },

    set(key, value) {
      const next =
        typeof value === "number"
          ? clampNumber(key, value, (DEFAULT_SETTINGS as Record<string, unknown>)[key] as number)
          : value;
      settings = { ...settings, [key]: next };
      persist();
    },

    reset() {
      settings = { ...defaults, binds: defaultBinds(spots) };
      persist();
    },

    subscribe(listener) {
      listeners.push(listener);
    },
  };
}

/**
 * Three.js wants a vertical FOV; Source quotes horizontal FOV at 4:3 and widens it on wider
 * displays ("Hor+"). Converting through the 4:3 reference and handing Three the real aspect
 * reproduces that: 90 horizontal at 4:3 becomes ~106 horizontal at 16:9, same as CS.
 */
export function verticalFovDegrees(horizontalFovAt4x3: number): number {
  const h = (horizontalFovAt4x3 * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(h / 2) / (4 / 3)) * 180) / Math.PI;
}

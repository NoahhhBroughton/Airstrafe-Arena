// Phase 1: singleplayer movement prototype.
//
// The structure here matters more than it looks. Simulation runs at a fixed TICK_DT and the
// renderer interpolates between the last two ticks (docs/ARCHITECTURE.md) - not because 64Hz
// looks better, but because Phase 3's prediction and reconciliation require the client to
// advance in the same discrete steps the server does. Anything that steps movement off a raw
// frame delta has to be rewritten later, so it's built this way from the start.

import * as THREE from "three";
import {
  createPlayerState,
  eyeHeight,
  movePlayer,
  vec3,
  TEST_MAP,
  TICK_DT,
  type PlayerState,
} from "@airstrafe-arena/shared";
import { createRapierWorld, initRapier } from "./rapier-world.js";
import { createInput } from "./input.js";
import { buildMapScene } from "./scene.js";
import { createHud } from "./hud.js";
import { createSettingsStore, verticalFovDegrees } from "./settings.js";
import { createSettingsUi } from "./settings-ui.js";
import { buildActions, spotActionId } from "./keybinds.js";

/**
 * Ticks we're willing to run in one frame before giving up on catching up. Without this, a
 * long stall (alt-tab, a breakpoint) hands the loop a huge accumulator, which takes longer to
 * simulate than it does to accrue - the classic spiral of death. Dropping the backlog costs a
 * little apparent time; not dropping it locks the tab up.
 */
const MAX_TICKS_PER_FRAME = 8;

async function main(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) throw new Error("missing #app element");

  await initRapier();

  const map = TEST_MAP;
  const collision = createRapierWorld(map);
  const scene = buildMapScene(map);

  const actions = buildActions(map.spots);
  const settings = createSettingsStore(actions, map.spots);

  const camera = new THREE.PerspectiveCamera(
    verticalFovDegrees(settings.current.fov),
    window.innerWidth / window.innerHeight,
    1,
    8000,
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  app.appendChild(renderer.domElement);

  const input = createInput(renderer.domElement, settings, map.spawnYaw);
  const hud = createHud(app, map.spots, settings);
  const menu = createSettingsUi(
    app,
    settings,
    actions,
    () => input.requestLock(),
    (capturing) => input.setSuspended(capturing),
  );

  settings.subscribe((current) => {
    camera.fov = verticalFovDegrees(current.fov);
    camera.updateProjectionMatrix();
  });

  let state: PlayerState = createPlayerState(map.spawn);
  // Position at the end of the previous tick, so rendering can interpolate toward the current
  // one instead of snapping 64 times a second.
  let previousPosition = vec3.clone(state.position);
  // Interpolated alongside position so the eye glides down on a crouch instead of snapping.
  let previousDuck = state.duck;

  const teleport = (position: typeof map.spawn, yaw: number) => {
    state = createPlayerState(position);
    previousPosition = vec3.clone(state.position);
    previousDuck = state.duck;
    input.setYaw(yaw);
  };

  // Edge-triggered actions come from the bind table rather than fixed keys, and only fire
  // while the pointer is locked - see input.onAction.
  input.onAction((actionId) => {
    if (actionId === "respawn") {
      teleport(map.spawn, map.spawnYaw);
      return;
    }
    const index = map.spots.findIndex((_, i) => spotActionId(i) === actionId);
    const spot = index >= 0 ? map.spots[index] : undefined;
    if (spot) teleport(spot.position, spot.yaw);
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let accumulator = 0;
  let lastFrameTime = performance.now();
  let smoothedFps = 60;

  function frame(now: number): void {
    requestAnimationFrame(frame);

    const frameDt = Math.min((now - lastFrameTime) / 1000, 0.25);
    lastFrameTime = now;
    smoothedFps += (1 / Math.max(frameDt, 1e-6) - smoothedFps) * 0.1;

    // Read tuning fresh every frame so the settings panel's effect is immediate.
    const { autoBhop, airAccel, airWishSpeedCap } = settings.current;
    const moveOptions = { autoBhop, airAccel, airWishSpeedCap };

    accumulator += frameDt;
    let ticks = 0;
    while (accumulator >= TICK_DT && ticks < MAX_TICKS_PER_FRAME) {
      previousPosition = state.position;
      previousDuck = state.duck;
      state = movePlayer(state, input.sample(), collision, TICK_DT, moveOptions);
      accumulator -= TICK_DT;
      ticks++;
    }
    if (ticks === MAX_TICKS_PER_FRAME) accumulator = 0;

    // Render between the last two simulated positions. View angles are applied straight from
    // the mouse rather than from the tick, so aim stays as responsive as the display allows
    // even though movement is quantized to 64Hz.
    const alpha = accumulator / TICK_DT;
    const eye = eyeHeight(previousDuck + (state.duck - previousDuck) * alpha);
    camera.position.set(
      previousPosition.x + (state.position.x - previousPosition.x) * alpha,
      previousPosition.y + (state.position.y - previousPosition.y) * alpha + eye,
      previousPosition.z + (state.position.z - previousPosition.z) * alpha,
    );
    // YXZ order keeps yaw and pitch independent, so the horizon never rolls.
    camera.rotation.set(input.pitch, input.yaw, 0, "YXZ");

    hud.update(state, smoothedFps, input.locked);
    // Unlocked means the menu is up - Esc is the settings key, as in any shooter.
    menu.setVisible(!input.locked);
    menu.setRawInputActive(input.rawInputActive);
    renderer.render(scene, camera);
  }

  requestAnimationFrame(frame);
}

void main().catch((err: unknown) => {
  console.error(err);
  const app = document.getElementById("app");
  if (app) {
    app.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  }
});

// Debug HUD. Not decoration - horizontal speed and onGround are the two numbers you actually
// tune movement against (docs/ROADMAP.md Phase 1), and a speed graph makes it obvious whether a
// bhop chain is gaining or bleeding speed in a way a single number never does.

import {
  vec3,
  MAX_GROUND_SPEED,
  SLIDE_GRACE_TIME,
  type MapSpot,
  type PlayerState,
} from "@airstrafe-arena/shared";
import { describeToken, spotActionId } from "./keybinds.js";
import type { SettingsStore } from "./settings.js";

const HISTORY_LENGTH = 240; // about 4 seconds at 60fps

export interface Hud {
  update(state: PlayerState, fps: number, locked: boolean): void;
}

export function createHud(
  parent: HTMLElement,
  spots: readonly MapSpot[],
  settings: SettingsStore,
): Hud {
  const root = document.createElement("div");
  root.className = "hud";
  root.innerHTML = `
    <div class="hud-panel">
      <div class="hud-speed"><span class="hud-speed-value">0</span><span class="hud-speed-unit">u/s</span></div>
      <canvas class="hud-graph" width="${HISTORY_LENGTH}" height="60"></canvas>
      <dl class="hud-stats">
        <dt>velocity</dt><dd class="hud-vel">0, 0, 0</dd>
        <dt>position</dt><dd class="hud-pos">0, 0, 0</dd>
        <dt>state</dt><dd class="hud-ground">air</dd>
        <dt>fps</dt><dd class="hud-fps">0</dd>
      </dl>
    </div>
    <div class="hud-center"></div>
    <div class="hud-spots" data-role="spots"></div>
  `;
  parent.appendChild(root);

  const speedValue = root.querySelector<HTMLElement>(".hud-speed-value")!;
  const velEl = root.querySelector<HTMLElement>(".hud-vel")!;
  const posEl = root.querySelector<HTMLElement>(".hud-pos")!;
  const groundEl = root.querySelector<HTMLElement>(".hud-ground")!;
  const fpsEl = root.querySelector<HTMLElement>(".hud-fps")!;
  const canvas = root.querySelector<HTMLCanvasElement>(".hud-graph")!;
  const ctx = canvas.getContext("2d")!;
  const spotsEl = root.querySelector<HTMLElement>('[data-role="spots"]')!;

  // Rebuilt whenever binds change, so the shortcut list can never disagree with what the keys
  // actually do.
  const renderSpots = () => {
    const rows = spots.map((spot, i) => ({
      key: settings.current.binds[spotActionId(i)]?.[0] ?? null,
      label: spot.name,
    }));
    rows.push({ key: settings.current.binds["respawn"]?.[0] ?? null, label: "respawn" });

    spotsEl.replaceChildren(
      ...rows.map((row) => {
        const div = document.createElement("div");
        const key = document.createElement("b");
        key.textContent = describeToken(row.key);
        div.append(key, document.createTextNode(row.label));
        return div;
      }),
    );
  };
  settings.subscribe(renderSpots);
  renderSpots();

  const history: number[] = [];
  // Graph scale is generous headroom over walk speed, since the whole point is watching speed
  // climb past it.
  const GRAPH_MAX = MAX_GROUND_SPEED * 4;

  const fmt = (n: number) => (n < 0 ? "" : " ") + n.toFixed(0).padStart(4, " ");

  function drawGraph(onGround: boolean) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Reference line at walk speed: anything above it came from air strafing.
    const refY = canvas.height - (MAX_GROUND_SPEED / GRAPH_MAX) * canvas.height;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, refY);
    ctx.lineTo(canvas.width, refY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = onGround ? "#7bd88f" : "#7aa2f7";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < history.length; i++) {
      const v = history[i] ?? 0;
      const x = (i / (HISTORY_LENGTH - 1)) * canvas.width;
      const y = canvas.height - Math.min(v / GRAPH_MAX, 1) * canvas.height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  return {
    update(state: PlayerState, fps: number, locked: boolean) {
      const speed = vec3.horizontalLength(state.velocity);

      history.push(speed);
      if (history.length > HISTORY_LENGTH) history.shift();

      speedValue.textContent = speed.toFixed(0);
      speedValue.style.color = speed > MAX_GROUND_SPEED + 1 ? "#7aa2f7" : "#e6e6e6";

      const v = state.velocity;
      velEl.textContent = `${fmt(v.x)},${fmt(v.y)},${fmt(v.z)}`;
      const p = state.position;
      posEl.textContent = `${fmt(p.x)},${fmt(p.y)},${fmt(p.z)}`;
      if (state.sliding) {
        // Countdown to the falloff, so the grace window is visible while tuning it.
        const left = Math.max(0, SLIDE_GRACE_TIME - state.slideTime);
        groundEl.textContent =
          left > 0 ? `slide (${left.toFixed(1)}s)` : `slide (falling off)`;
        groundEl.style.color = left > 0 ? "#f7c96a" : "#f7a76a";
      } else if (state.onGround) {
        groundEl.textContent = `ground (n.y ${state.groundNormal.y.toFixed(2)})${
          state.duck > 0 ? " ducked" : ""
        }`;
        groundEl.style.color = "#7bd88f";
      } else {
        groundEl.textContent = state.duck > 0 ? "air ducked" : "air";
        groundEl.style.color = "#7aa2f7";
      }
      fpsEl.textContent = fps.toFixed(0);
      // Dim the whole readout while the settings menu is up, so it doesn't compete with it.
      root.style.opacity = locked ? "1" : "0.25";

      drawGraph(state.onGround);
    },
  };
}

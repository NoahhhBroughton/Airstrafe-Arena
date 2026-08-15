// The settings screen, shown whenever the pointer is unlocked - i.e. Esc is the menu key, the
// way it is in every shooter.
//
// Movement values are live: changing air acceleration takes effect on the very next tick, with
// no reload. That is the whole reason this exists rather than a constants file you edit.

import type { Settings, SettingsStore } from "./settings.js";
import {
  assignBind,
  clearBind,
  describeToken,
  tokenFromKeyboard,
  tokenFromMouse,
  tokenFromWheel,
  type ActionDef,
} from "./keybinds.js";

/** Inline so the page stays self-contained - no icon font, no network request. */
const TRASH_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
  <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5"
        fill="none" stroke="currentColor" stroke-width="1.2"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

interface FieldBase {
  key: keyof Settings;
  label: string;
  hint?: string;
}

interface NumberField extends FieldBase {
  kind: "number";
  step: number;
}

interface ToggleField extends FieldBase {
  kind: "toggle";
}

type Field = NumberField | ToggleField;

const SECTIONS: { title: string; fields: Field[] }[] = [
  {
    title: "Mouse",
    fields: [
      {
        kind: "number",
        key: "sensitivity",
        label: "Sensitivity",
        step: 0.1,
        hint: "1:1 with Source — sensitivity 1 here turns the same arc as sensitivity 1 in CS.",
      },
      {
        kind: "number",
        key: "mYaw",
        label: "m_yaw",
        step: 0.001,
        hint: "Degrees per mouse count before sensitivity. Source's default is 0.022.",
      },
      {
        kind: "toggle",
        key: "rawInput",
        label: "Raw input",
        hint: "Bypasses the OS pointer-acceleration curve. Required for the 1:1 match above.",
      },
    ],
  },
  {
    title: "View",
    fields: [
      {
        kind: "number",
        key: "fov",
        label: "Field of view",
        step: 1,
        hint: "Horizontal FOV at 4:3, quoted the way Source does. Widens on wider displays.",
      },
      {
        kind: "toggle",
        key: "thirdPersonLeftShoulder",
        label: "Third person: left shoulder",
        hint: "Which shoulder the third-person camera sits over. Off is the right shoulder.",
      },
    ],
  },
  {
    title: "Movement tuning",
    fields: [
      {
        kind: "toggle",
        key: "autoBhop",
        label: "Auto bhop",
        hint: "Hold jump to keep hopping instead of re-pressing each time.",
      },
      {
        kind: "number",
        key: "airAccel",
        label: "Air accelerate",
        step: 10,
        hint: "Source's sv_airaccelerate. Saturates above 64 (1/tick), so anything from ~100 up behaves identically — below that it bites.",
      },
      {
        kind: "number",
        key: "airWishSpeedCap",
        label: "Air wish speed",
        step: 1,
        hint: "The real air-control dial. Higher forgives sloppier strafing and builds speed faster; Source's ~30 demands tighter mouse timing.",
      },
    ],
  },
  {
    title: "Movement tech",
    fields: [
      {
        kind: "toggle",
        key: "slide",
        label: "Slide",
        hint: "Crouch while moving fast to slide instead of stopping. Steer it with the mouse alone — movement keys do nothing while sliding. Downhill slides accelerate.",
      },
      {
        kind: "number",
        key: "slideBoostSpeed",
        label: "Slide boost",
        step: 25,
        hint: "Speed a slide launches you to. A floor, not a cap — entering faster keeps what you arrived with.",
      },
    ],
  },
];

export interface SettingsUi {
  /** Visible exactly when the pointer is unlocked. */
  setVisible(visible: boolean): void;
  setRawInputActive(active: boolean): void;
}

/** Grouped bind rows, two slots each. Group order follows first appearance in `actions`. */
function controlsHtml(actions: readonly ActionDef[]): string {
  const groups = new Map<string, ActionDef[]>();
  for (const action of actions) {
    const list = groups.get(action.group);
    if (list) list.push(action);
    else groups.set(action.group, [action]);
  }

  return [...groups]
    .map(
      ([group, list]) => `
      <section class="menu-section">
        <h2>${escapeHtml(group)}</h2>
        <div class="bind-head"><span></span><span>Primary</span><span>Secondary</span></div>
        ${list
          .map(
            (action) => `
          <div class="bind-row">
            <span class="bind-label">${escapeHtml(action.label)}</span>
            ${[0, 1]
              .map(
                (slot) => `
              <span class="bind-cell">
                <button type="button" class="bind-slot" data-action="${escapeHtml(action.id)}" data-slot="${slot}"></button>
                <button type="button" class="bind-clear" data-clear="${escapeHtml(action.id)}" data-slot="${slot}"
                        title="Clear this bind" aria-label="Clear ${escapeHtml(action.label)} ${slot === 0 ? "primary" : "secondary"} bind">
                  ${TRASH_ICON}
                </button>
              </span>`,
              )
              .join("")}
          </div>`,
          )
          .join("")}
      </section>`,
    )
    .join("");
}

export function createSettingsUi(
  parent: HTMLElement,
  settings: SettingsStore,
  actions: readonly ActionDef[],
  onPlay: () => void,
  onCaptureChange: (capturing: boolean) => void,
): SettingsUi {
  const root = document.createElement("div");
  root.className = "menu";

  const sectionsHtml = SECTIONS.map(
    (section) => `
      <section class="menu-section">
        <h2>${section.title}</h2>
        ${section.fields
          .map(
            (field) => `
          <div class="menu-field">
            <label for="set-${field.key}">${field.label}</label>
            ${
              field.kind === "toggle"
                ? `<input type="checkbox" id="set-${field.key}" data-key="${field.key}" />`
                : `<input type="number" id="set-${field.key}" data-key="${field.key}" step="${field.step}" />`
            }
            ${field.hint ? `<p class="menu-hint">${field.hint}</p>` : ""}
          </div>`,
          )
          .join("")}
      </section>`,
  ).join("");

  root.innerHTML = `
    <div class="menu-panel">
      <header class="menu-header">
        <h1>Airstrafe Arena</h1>
        <p class="menu-status" data-role="raw-status"></p>
      </header>
      ${sectionsHtml}
      <h2 class="menu-controls-title">Controls</h2>
      <p class="menu-hint menu-controls-hint">
        Click a slot, then press any key, mouse button or wheel notch.
        <b>Delete</b> clears it, <b>Esc</b> cancels.
      </p>
      <p class="menu-bind-notice" data-role="bind-notice"></p>
      ${controlsHtml(actions)}
      <footer class="menu-footer">
        <button type="button" data-role="reset">Reset to defaults</button>
        <button type="button" data-role="play">Play</button>
      </footer>
    </div>
  `;
  parent.appendChild(root);

  const rawStatus = root.querySelector<HTMLElement>('[data-role="raw-status"]')!;
  const bindNotice = root.querySelector<HTMLElement>('[data-role="bind-notice"]')!;
  const inputs = Array.from(root.querySelectorAll<HTMLInputElement>("input[data-key]"));
  const bindSlots = Array.from(root.querySelectorAll<HTMLButtonElement>(".bind-slot"));

  const labelFor = (actionId: string): string =>
    actions.find((a) => a.id === actionId)?.label ?? actionId;

  /** The slot currently waiting for a key, if any. */
  let capturing: { actionId: string; slot: number; button: HTMLButtonElement } | null = null;

  const render = (current: Readonly<Settings>) => {
    for (const input of inputs) {
      const key = input.dataset.key as keyof Settings | undefined;
      if (!key || key === "binds") continue;
      const value = current[key];
      // Skip the field being typed in, or the cursor jumps to the end on every keystroke.
      if (document.activeElement === input) continue;
      if (typeof value === "boolean") input.checked = value;
      else input.value = String(value);
    }

    for (const button of bindSlots) {
      const actionId = button.dataset.action;
      const slot = Number(button.dataset.slot);
      if (!actionId || !Number.isInteger(slot)) continue;
      const isCapturing = capturing?.actionId === actionId && capturing.slot === slot;
      button.classList.toggle("is-capturing", isCapturing);
      button.textContent = isCapturing
        ? "Press any key…"
        : describeToken(current.binds[actionId]?.[slot] ?? null);
    }
  };

  const notify = (message: string, kind: "info" | "warn") => {
    bindNotice.textContent = message;
    bindNotice.dataset.state = message ? kind : "";
  };

  const stopCapture = () => {
    if (!capturing) return;
    capturing = null;
    onCaptureChange(false);
    render(settings.current);
  };

  const commit = (token: string) => {
    if (!capturing) return;
    const { actionId, slot } = capturing;
    const { binds, cleared } = assignBind(settings.current.binds, actionId, slot, token);
    settings.set("binds", binds);

    if (cleared.length > 0) {
      // Rebinding steals the token rather than duplicating it. Say so explicitly - silently
      // removing someone's jump key because they reused the button is how a game earns a
      // reputation for being broken.
      const names = cleared
        .map((c) => `${labelFor(c.actionId)} (${c.slot === 0 ? "primary" : "secondary"})`)
        .join(", ");
      notify(`${describeToken(token)} was already bound — unbound it from ${names}.`, "warn");
    } else {
      notify(`Bound ${describeToken(token)} to ${labelFor(actionId)}.`, "info");
    }
    stopCapture();
  };

  // Capture phase, on window, so a keypress meant for a bind never reaches the game or the
  // browser's own shortcuts on the way.
  const captureKey = (e: KeyboardEvent) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === "Escape") {
      notify("Rebind cancelled.", "info");
      stopCapture();
      return;
    }
    if (e.code === "Delete" || e.code === "Backspace") {
      const { actionId, slot } = capturing;
      settings.set("binds", clearBind(settings.current.binds, actionId, slot));
      notify(`Cleared ${labelFor(actionId)} (${slot === 0 ? "primary" : "secondary"}).`, "info");
      stopCapture();
      return;
    }
    commit(tokenFromKeyboard(e));
  };

  const captureMouse = (e: MouseEvent) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    commit(tokenFromMouse(e));
  };

  const captureWheel = (e: WheelEvent) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    const token = tokenFromWheel(e);
    if (token) commit(token);
  };

  const captureContextMenu = (e: MouseEvent) => {
    if (capturing) e.preventDefault();
  };

  window.addEventListener("keydown", captureKey, { capture: true });
  window.addEventListener("mousedown", captureMouse, { capture: true });
  window.addEventListener("wheel", captureWheel, { capture: true, passive: false });
  window.addEventListener("contextmenu", captureContextMenu, { capture: true });

  for (const button of bindSlots) {
    button.addEventListener("click", () => {
      const actionId = button.dataset.action;
      const slot = Number(button.dataset.slot);
      if (!actionId || !Number.isInteger(slot)) return;
      if (capturing?.button === button) {
        stopCapture();
        return;
      }
      capturing = { actionId, slot, button };
      notify("", "info");
      onCaptureChange(true);
      render(settings.current);
    });
  }

  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>(".bind-clear"))) {
    button.addEventListener("click", () => {
      const actionId = button.dataset.clear;
      const slot = Number(button.dataset.slot);
      if (!actionId || !Number.isInteger(slot)) return;
      // Clearing while a capture is armed would otherwise leave the listener waiting on a slot
      // the player just emptied.
      stopCapture();
      if (settings.current.binds[actionId]?.[slot] == null) {
        notify(`${labelFor(actionId)} (${slot === 0 ? "primary" : "secondary"}) is already unbound.`, "info");
        return;
      }
      settings.set("binds", clearBind(settings.current.binds, actionId, slot));
      notify(`Cleared ${labelFor(actionId)} (${slot === 0 ? "primary" : "secondary"}).`, "info");
      render(settings.current);
    });
  }

  for (const input of inputs) {
    input.addEventListener("input", () => {
      const key = input.dataset.key as keyof Settings | undefined;
      if (!key) return;
      if (input.type === "checkbox") {
        settings.set(key, input.checked as never);
      } else {
        const parsed = Number(input.value);
        // Mid-typing states like "" or "-" parse to NaN; leave the value alone until it's valid.
        if (Number.isFinite(parsed)) settings.set(key, parsed as never);
      }
    });
    // Re-render on blur so a clamped or rejected value visibly snaps back.
    input.addEventListener("blur", () => render(settings.current));
  }

  root.querySelector('[data-role="reset"]')?.addEventListener("click", () => {
    stopCapture();
    settings.reset();
    notify("Reset to defaults, including keybinds.", "info");
    render(settings.current);
  });
  root.querySelector('[data-role="play"]')?.addEventListener("click", onPlay);

  settings.subscribe(render);
  render(settings.current);

  return {
    setVisible(visible: boolean) {
      // Leaving a capture armed while the menu closes would swallow the player's first
      // keypress back in the game.
      if (!visible) stopCapture();
      root.classList.toggle("is-hidden", !visible);
    },
    setRawInputActive(active: boolean) {
      if (!settings.current.rawInput) {
        rawStatus.textContent = "Raw input off — sensitivity will not match Source.";
        rawStatus.dataset.state = "warn";
      } else if (active) {
        rawStatus.textContent = "Raw input active — sensitivity matches Source 1:1.";
        rawStatus.dataset.state = "ok";
      } else {
        rawStatus.textContent = "Raw input requested. Click Play to confirm the browser grants it.";
        rawStatus.dataset.state = "pending";
      }
    },
  };
}

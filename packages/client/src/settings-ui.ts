// The settings screen, shown whenever the pointer is unlocked - i.e. Esc is the menu key, the
// way it is in every shooter.
//
// Movement values are live: changing air acceleration takes effect on the very next tick, with
// no reload. That is the whole reason this exists rather than a constants file you edit.

import type { Settings, SettingsStore } from "./settings.js";

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
    ],
  },
  {
    title: "Movement",
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
        hint: "Source's sv_airaccelerate. Above 64 (1/tick) this saturates — 100 and 1000 are the same.",
      },
      {
        kind: "number",
        key: "airWishSpeedCap",
        label: "Air wish speed",
        step: 1,
        hint: "The real air-control dial. Low values are what make strafing compound speed.",
      },
    ],
  },
];

export interface SettingsUi {
  /** Visible exactly when the pointer is unlocked. */
  setVisible(visible: boolean): void;
  setRawInputActive(active: boolean): void;
}

export function createSettingsUi(
  parent: HTMLElement,
  settings: SettingsStore,
  onPlay: () => void,
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
      <footer class="menu-footer">
        <button type="button" data-role="reset">Reset to defaults</button>
        <button type="button" data-role="play">Play</button>
      </footer>
      <p class="menu-keys">
        <b>WASD</b> move &middot; <b>Space</b> jump &middot; <b>1</b>/<b>2</b>/<b>3</b> teleport
        &middot; <b>R</b> respawn &middot; <b>Esc</b> settings
      </p>
    </div>
  `;
  parent.appendChild(root);

  const rawStatus = root.querySelector<HTMLElement>('[data-role="raw-status"]')!;
  const inputs = Array.from(root.querySelectorAll<HTMLInputElement>("input[data-key]"));

  const render = (current: Readonly<Settings>) => {
    for (const input of inputs) {
      const key = input.dataset.key as keyof Settings | undefined;
      if (!key) continue;
      const value = current[key];
      // Skip the field being typed in, or the cursor jumps to the end on every keystroke.
      if (document.activeElement === input) continue;
      if (typeof value === "boolean") input.checked = value;
      else input.value = String(value);
    }
  };

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
    settings.reset();
    render(settings.current);
  });
  root.querySelector('[data-role="play"]')?.addEventListener("click", onPlay);

  settings.subscribe(render);
  render(settings.current);

  return {
    setVisible(visible: boolean) {
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

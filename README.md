# Airstrafe Arena

Browser-based 3D multiplayer arena shooter: Source-engine-style movement (bhop/surf/air-strafe)
+ Quake-instagib combat.

**Start here:**
- [`CLAUDE.md`](./CLAUDE.md) — project guidance, architecture decisions, coding conventions.
  Read this first, every session.
- [`docs/MOVEMENT_SPEC.md`](./docs/MOVEMENT_SPEC.md) — the movement physics spec.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — client/server split, netcode plan.
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — phased build order with progress checkboxes. Check
  this to see what's next.

## Setup

```bash
npm install
```

## Dev

```bash
npm run dev           # Vite dev server for the browser client (same as dev:client)
npm run dev:server    # server (not implemented until Phase 3, see ROADMAP.md)
```

Then open the printed URL and click the canvas to lock the mouse.

| Key | |
|---|---|
| `WASD` | move |
| `Space` | jump — hold it to keep bhopping (auto-bhop is on by default) |
| `Left Ctrl` | crouch — duck mid-jump for extra height, or land on it at speed to slide |
| `1` / `2` / `3` | teleport to the spawn / bhop staircase / surf platform |
| `R` | respawn |
| `Esc` | settings |

All of these are rebindable — see below.

**Movement tech.** Beyond bhop and surf: **lurch** (tap a strafe key mid-air to swing your
momentum that way, keeping ~99% of your speed — it fires on a fresh press only, so holding
strafe to air-strafe never triggers it), **crouch-jump** (duck mid-jump to clear 18 more units),
**slide** (land holding crouch with speed; downhill slides accelerate), and **ramp slide**
(landing on a descending slope converts your fall into speed along it, so bhopping downhill
compounds). All toggleable and tunable in the settings screen.

The HUD's speed graph is the main tuning instrument: the dashed line is `MAX_GROUND_SPEED`, and
the trace turns blue above it — anything up there came from air strafing.

### Settings

`Esc` opens the settings screen. Movement values there are live — change air acceleration and
the next tick uses it, no reload. They're client-side tuning knobs for now; Phase 3 moves
authority for them to the server.

Sensitivity is 1:1 with Source (`degrees = m_yaw * sensitivity * rawCounts`, `m_yaw` 0.022), so
whatever number you use in CS transfers directly. That parity depends on raw input — the game
asks the browser for unadjusted pointer movement to bypass the OS acceleration curve, and the
settings screen tells you whether it got it. FOV is likewise quoted the Source way: horizontal
at 4:3, widening on wider displays.

### Keybinds

Every action has a **primary and a secondary** slot, so jump can live on both `Space` and
`Wheel Down` at once — hold one for chains, flick the other for timing. Keyboard keys, mouse
buttons and wheel notches are all bindable; a wheel notch registers as exactly one tick of
input, which is what makes wheel-jump work.

Click a slot, then press what you want. `Delete` clears it, `Esc` cancels, or use the trash
button beside the slot. Binding something that's already in use **takes it from wherever it was**
and tells you what it removed, rather than leaving two actions fighting over one key.

## Test

```bash
npm run test          # unit tests for shared movement math
npm run typecheck     # all three packages
```

## Status

Phase 1 built, awaiting playtest sign-off. Movement runs on a 64Hz fixed tick with render
interpolation; collision is Rapier shape casts driving hand-written slide/step integration;
the test map has flat ground, a bhop staircase and a surf ramp. An automated browser run gets a
bhop chain from 320 to ~400 u/s and a surf ride to ~460 u/s with a clean console — but whether
it *feels* right is a human call that hasn't been made yet. See `docs/ROADMAP.md` for the open
tuning questions.

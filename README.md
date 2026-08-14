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
| `Space` | jump (one press per jump — `AUTO_BHOP_ENABLED` is off) |
| `1` / `2` / `3` | teleport to the spawn / bhop staircase / surf platform |
| `R` | respawn |
| `Esc` | release the mouse |

The HUD's speed graph is the main tuning instrument: the dashed line is `MAX_GROUND_SPEED`, and
the trace turns blue above it — anything up there came from air strafing.

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

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
npm run dev:client    # Vite dev server for the browser client
npm run dev:server    # server (not implemented until Phase 3, see ROADMAP.md)
```

## Test

```bash
npm run test          # unit tests for shared movement math
```

## Status

Phase 0 scaffold complete: workspaces build, a bare Three.js scene renders, movement math exists
in `packages/shared` with passing unit tests (ground accelerate, air accelerate/strafe gain,
friction, surface clipping). Phase 1 (actual playable movement — pointer lock, fixed-tick sim
loop, collision, a test map) is next. See `docs/ROADMAP.md`.

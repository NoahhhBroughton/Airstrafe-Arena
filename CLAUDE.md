# CLAUDE.md — Project Guidance

**Project name: Airstrafe Arena**

This file is the source of truth for how this project is built. Read it fully before making
changes. If a decision here seems wrong, flag it in conversation before overriding it — don't
silently deviate.

## What this project is

A browser-based 3D multiplayer arena shooter. Reference feel:

- **Movement:** Source engine movement (CS:S / surf / bhop community mechanics) — air strafing,
  bunny hopping, momentum-based surf ramps. This is the core mechanical identity of the game.
  Everything else is secondary to this feeling right.
- **Combat:** Quake-instagib style — hitscan, one-shot kill, no loadouts/economy. Fast, simple,
  focused entirely on movement + aim.
- **Stretch movement tech:** Titanfall 2 / Apex-style wallrunning, possibly "lurch"-style momentum
  tech. Explicitly deferred — see Roadmap. Do not start on these until base movement + netcode are
  solid and tuned.

## Non-negotiable architecture decisions

These were decided deliberately. Don't re-litigate them without discussion:

1. **Rendering:** Three.js. Not a monolithic engine (no Unity/Godot/PlayCanvas editor). We need a
   fully custom character controller, so an all-in-one engine buys less than it costs.
2. **Physics/collision:** Rapier (WASM). Used for world collision geometry and raycasts. It is
   NOT the source of movement feel — movement (acceleration, air control, friction, surf) is
   hand-written logic on top of Rapier's collision queries. See `docs/MOVEMENT_SPEC.md`.
3. **Movement code is shared, not duplicated.** The exact same TypeScript movement function runs
   on the client (for local prediction) and the server (as authority). It lives in
   `packages/shared` and is imported by both. If you ever find yourself writing movement logic
   twice, stop — factor it into shared instead.
4. **Language:** TypeScript, strict mode, everywhere (client, server, shared).
5. **Networking:** WebSocket to start. Authoritative server, fixed tick rate (64Hz target).
   Client-side prediction + server reconciliation. Do not attempt this until Phase 1 (movement
   prototype) feels good in singleplayer — see Roadmap.
6. **Monorepo layout:** npm workspaces, three packages:
   - `packages/shared` — movement physics, constants, message types, anything both client and
     server need. No rendering code, no networking transport code.
   - `packages/client` — Three.js rendering, input, prediction, UI.
   - `packages/server` — authoritative simulation loop, networking, hit registration.

## Build order (see docs/ROADMAP.md for full detail)

Work through phases in order. Do not jump ahead to networking or combat before movement feels
right — a bad netcode layer on top of untested movement code compounds debugging difficulty
enormously. When starting a session, check `docs/ROADMAP.md` for current phase and update the
checkboxes as items complete.

## Movement physics

`docs/MOVEMENT_SPEC.md` has the actual formulas (ground accelerate, air accelerate/strafe,
friction, jump, surf). Treat it as the spec — implement exactly what's there, and if tuning
constants need to change, update the spec file too so it stays the single source of truth for
"what should this feel like."

## Coding conventions

- No `any` in TypeScript. If a type is genuinely unknown, use `unknown` and narrow it.
- Movement/physics code uses fixed-timestep math (never `deltaTime` from `requestAnimationFrame`
  directly for simulation — accumulate and step at a fixed tick, see ARCHITECTURE.md).
- Keep `packages/shared` free of any `window`, `document`, or Node-only APIs — it must run
  unmodified in both browser and Node.
- Prefer small, testable pure functions for movement math (`applyFriction(vel, ...)`,
  `airAccelerate(vel, wishDir, ...)`) over one giant `updatePlayer()` blob — this makes it
  possible to unit test movement without a renderer or network stack.
- Comment *why* a constant has the value it does when it's not obvious (e.g. why air acceleration
  is capped per-tick) — future tuning sessions need that context.

## What NOT to do

- Don't reach for a third-party "batteries included" multiplayer game framework. The movement
  model here is unusual enough that generic frameworks fight you more than they help.
- Don't use Rapier's built-in kinematic character controller for the player — it doesn't support
  air-strafe acceleration or surf. Use Rapier for collision *queries* (shape casts, raycasts)
  only; movement integration is custom.
- Don't start multiplayer networking, hit registration, or wallrunning before Phase 1 is done and
  actually feels good to play. Ask before skipping ahead.

## Current status

See `docs/ROADMAP.md` — update it as phases complete. As of project creation, nothing is built
yet; Phase 1 (singleplayer movement prototype) is next.

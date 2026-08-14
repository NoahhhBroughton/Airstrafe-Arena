# Roadmap

Work top to bottom. Don't start a phase until the previous one's exit criteria are actually met —
check them honestly, not just "code exists." Update checkboxes as you go; this file is the
persistent memory of project progress across sessions.

## Phase 0 — Project scaffolding
- [ ] npm workspaces set up (`shared`, `client`, `server`) and building/type-checking cleanly
- [ ] Client: blank Three.js scene rendering, dev server running (Vite recommended)
- [ ] Basic flat ground plane + a box to walk into, just to confirm the render loop works
- **Exit criteria:** `npm run dev` opens a browser tab with a 3D scene and no console errors.

## Phase 1 — Singleplayer movement prototype (the most important phase)
- [ ] Pointer lock + mouse look (yaw/pitch, no roll)
- [ ] Fixed-tick simulation loop (see ARCHITECTURE.md) wired to render loop with interpolation
- [ ] Implement `groundAccelerate`, `airAccelerate`, `applyFriction`, `clipVelocity`,
      `airWishSpeed` cap, per `docs/MOVEMENT_SPEC.md`, as pure functions in `packages/shared`
- [ ] Unit tests for the above pure functions
- [ ] Capsule/box collision against static world geometry via Rapier shape casts (ground check,
      wall collision, ceiling)
- [ ] Jump + landing behavior (velocity preserved, no reset)
- [ ] A test map: flat ground, a bhop staircase (small ascending platforms), one surf ramp
- [ ] Debug HUD: current speed, velocity vector, onGround state — essential for tuning
- **Exit criteria:** you can personally bhop a chain of jumps and ride the surf ramp and it feels
  good. This is a subjective, human judgment call — don't skip it or self-certify from code review
  alone. Get actual playtesting in before moving on.

## Phase 2 — Test content
- [ ] A few more surf ramps at different angles
- [ ] A proper bhop course (ramps + gaps requiring strafe timing)
- [ ] Basic map loading from a simple format (glTF scene → Rapier collision generation is a
      reasonable approach) so future maps don't require hand-coded geometry
- **Exit criteria:** movement holds up across varied geometry, not just the original test box.

## Phase 3 — Basic multiplayer (no combat yet)
- [ ] Server package: fixed-tick authoritative sim running the *same* shared movement code
- [ ] WebSocket connection, input message schema (in `packages/shared`)
- [ ] Client-side prediction + server reconciliation per ARCHITECTURE.md
- [ ] Remote player interpolation (see other players moving smoothly)
- [ ] Basic player capsule collision between players (or explicitly decide players don't collide,
      common in arena shooters — decide and document the choice)
- **Exit criteria:** two browser tabs, two players, both can bhop/surf independently and see each
  other move smoothly with no visible rubber-banding under normal conditions.

## Phase 4 — Instagib combat
- [ ] Hitscan raycast on fire input
- [ ] Server-side lag-compensated hit registration per ARCHITECTURE.md
- [ ] One-shot kill, respawn
- [ ] Simple weapon: instant-hit only, no projectile, no falloff (true instagib)
- [ ] Kill feed / basic score tracking
- **Exit criteria:** two players can duel and hits feel like they land where the shooter aimed,
  even under moderate simulated latency.

## Phase 5 — Polish & scale testing
- [ ] More players (aim for whatever your target lobby size is — decide this explicitly)
- [ ] Server performance profiling at target player count
- [ ] Basic matchmaking/lobby flow (even if just a room code to start)
- [ ] Sound, hit feedback, basic UI polish

## Phase 6 — Stretch movement tech (do not start earlier)
- [ ] Wallrunning (Titanfall/Apex-style) — design the detection (wall shape casts) and the
      velocity/gravity modification while wall-running as its own mini-spec before implementing,
      the same way `MOVEMENT_SPEC.md` was written up front
- [ ] Evaluate "lurch" or other momentum tech only after wallrunning is tuned — these compound
      the movement tuning surface a lot, add one at a time

## Explicitly out of scope for now
- Loadouts, weapon variety, economy (instagib is deliberately minimal)
- Mobile/touch support
- Anything requiring dedicated hosting infra beyond a single server process — revisit if the
  project actually gets players

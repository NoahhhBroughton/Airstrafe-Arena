# Roadmap

Work top to bottom. Don't start a phase until the previous one's exit criteria are actually met —
check them honestly, not just "code exists." Update checkboxes as you go; this file is the
persistent memory of project progress across sessions.

## Phase 0 — Project scaffolding ✅
- [x] npm workspaces set up (`shared`, `client`, `server`) and building/type-checking cleanly
- [x] Client: blank Three.js scene rendering, dev server running (Vite recommended)
- [x] Basic flat ground plane + a box to walk into, just to confirm the render loop works
- **Exit criteria:** `npm run dev` opens a browser tab with a 3D scene and no console errors. ✅

## Phase 1 — Singleplayer movement prototype (the most important phase)
- [x] Pointer lock + mouse look (yaw/pitch, no roll)
- [x] Fixed-tick simulation loop (see ARCHITECTURE.md) wired to render loop with interpolation
- [x] Implement `groundAccelerate`, `airAccelerate`, `applyFriction`, `clipVelocity`,
      `airWishSpeed` cap, per `docs/MOVEMENT_SPEC.md`, as pure functions in `packages/shared`
- [x] Unit tests for the above pure functions
- [x] Capsule/box collision against static world geometry via Rapier shape casts (ground check,
      wall collision, ceiling)
- [x] Jump + landing behavior (velocity preserved, no reset)
- [x] A test map: flat ground, a bhop staircase (small ascending platforms), one surf ramp
- [x] Debug HUD: current speed, velocity vector, onGround state — essential for tuning
- [ ] **Playtest sign-off — not yet done.** Everything above is built and verified mechanically
      (automated browser run: bhop chain climbs 320 → ~400 u/s, surf ride reaches ~460 u/s, no
      console errors), but nobody has actually *played* it. See exit criteria.
- **Exit criteria:** you can personally bhop a chain of jumps and ride the surf ramp and it feels
  good. This is a subjective, human judgment call — don't skip it or self-certify from code review
  alone. Get actual playtesting in before moving on.

### Known Phase 1 tuning questions for the playtest
Things measured as working but not judged as *feeling* right — decide these at the keyboard,
then update `docs/MOVEMENT_SPEC.md` with whatever the constants become:
- Surf ramp is short: the drop from the start platform to where the ramp meets the ground is
  ~414 units, so a ride lasts about a second unless you carry speed along its length. If it
  wants to be a real ride, the surf section needs to be taller (which means redoing the access
  ramp too).
- Bhop staircase spacing (260 units) and rise (36) were picked from jump-arc arithmetic, not
  from playing it.
- Mouse sensitivity defaults to 2.0 at Source's `m_yaw` of 0.022 — no in-game way to change it
  yet.
- `AUTO_BHOP_ENABLED` is off, so every jump needs a fresh press. Worth trying both.

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

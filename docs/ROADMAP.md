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

### Settled by the first playtest
- **Air acceleration was far too low.** Shipped at Source's stock 10, which only steers 4.7 u/s
  per tick — "can't properly turn in the air." Now 100, matching what surf/bhop servers run.
  Note it saturates above 64 at our tick rate, so 100 and 1000 are identical; see
  `MOVEMENT_SPEC.md`.
- **Auto-bhop is now on by default.** The original spec called for a fresh press per jump; that
  is not how the reference servers play.
- **Settings screen added** (`Esc`), with live movement tuning, Source-1:1 sensitivity, and raw
  input to bypass OS mouse acceleration.
- **`AIR_WISH_SPEED_CAP` raised 30 → 75.** A deliberate departure from CS feel: strafing is more
  forgiving and builds speed faster. This is the knob that actually governs air control.
- **`AIR_ACCEL` set to 1000**, the familiar bhop-server number. Functionally identical to 100 at
  64 tick (it saturates at 64), but recognisable and still correct if the tick rate rises.
- **Rebindable controls**, two slots per action, keyboard/mouse/wheel, with per-slot clear.
- **Jump height doubled** (`JUMP_IMPULSE` 270 → 382, apex 45 → 91). Apex scales with the square
  of the impulse.
- **Crouch + crouch-jump added.** Not on the original Phase 1 list — see "Scope added during
  Phase 1" below.
- **Two collision bugs found by playtest and fixed:** players launching off flat ground, and
  losing ground state (and therefore auto-bhop) heading downhill. Both written up in
  `MOVEMENT_SPEC.md` since they will reappear if the collision layer is rewritten.
- **Ramp slide implemented.** Landing projects velocity onto the ground plane instead of zeroing
  vertical velocity, so dropping onto a descending ramp converts fall speed into speed along it.

### Scope added during Phase 1 (not in the original plan)
- Settings screen with live movement tuning, Source-1:1 sensitivity, raw input, FOV.
- Rebindable controls.
- Crouch and crouch-jump. Worth noting the original Phase 1 checklist never mentioned ducking at
  all, even though it is core Source movement and crouch-jumping is required to clear geometry on
  most real bhop maps. Flagging in case other base mechanics are missing from the plan rather
  than deliberately deferred — **surf ramp entry/exit while ducked is untested**, and long-jump
  (crouch + jump timing) has not been considered.

### Still open for the playtest
Measured as working but not judged as *feeling* right — decide at the keyboard, then update
`docs/MOVEMENT_SPEC.md` with whatever the constants become:
- **The test map is now scaled for the wrong jump.** Its geometry was laid out for a 45-unit
  apex; the jump is 91 and a crouch-jump clears 109. The staircase (36-unit rises, 260 spacing)
  is trivially clearable, and a jump now covers ~306 units of ground at walk speed rather than
  ~216. Rescaling is a map decision, so it has not been done unilaterally.
- Surf ramp is short: the drop from the start platform to where the ramp meets the ground is
  ~414 units, so a ride lasts about a second unless you carry speed along its length. If it
  wants to be a real ride, the surf section needs to be taller (which means redoing the access
  ramp too).
- `AIR_WISH_SPEED_CAP` is now 75. It is the knob to reach for if strafing still doesn't feel
  right — acceleration is saturated, so this is the only thing that changes air control.
- Verify the sensitivity match with a 360° test against CS rather than trusting it on paper.

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

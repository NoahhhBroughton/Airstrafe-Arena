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

- **Ramp slide fixed properly.** The landing conversion was already correct, but every *jump*
  off a slope was being clipped by the slope it was leaving, destroying it. Downhill bhop now
  compounds (317 → 479 → 658 over two hops instead of decaying to 290).
- **Lurch built, then removed.** Edge-triggering it on a strafe press was wrong: air strafing
  alternates A and D, so every strafe cycle fired one. Written up in `MOVEMENT_SPEC.md` — the
  general point is that no trigger on the strafe keys can coexist with air strafing.
- **Slide** added: crouch while moving fast (from a run or through a landing) launches you to
  `SLIDE_BOOST_SPEED` (750), held for 2 seconds before falling off. It is **aimed with the mouse
  alone** — movement keys do nothing while sliding, and the velocity snaps to your view
  instantly. Two earlier versions are recorded in `MOVEMENT_SPEC.md`: accelerating with the air
  cap (became air strafing on the ground) and rate-limited steering off WASD (felt indirect).
  Downhill slides still accelerate from slope gravity. Boost speed is tunable in settings.
- **Full character rig added** (`character.ts`): head, tapered torso, arms and legs in a joint
  hierarchy, posed for standing, walking, crouching and sliding. Crouching previously had no
  visual tell at all. One rig serves both camera modes — first person hides the head rather than
  using a separate model, so the two views can never disagree.
- **First/third person toggle** (`V`), over-the-shoulder, raycasting its way back so it does not
  end up inside walls. Shoulder side is a setting.
- **Minecraft proportions, 1:1** — 8/12/12 pixels for head/torso/legs against a 72-unit hull, so
  one pixel is 2.25 units and the three stack to exactly 72. Articulation is the deliberate
  departure: elbows and knees, so the body holds a pose rather than swinging rigid planks.
- **Pose transitions are blended**, not switched. Entering a slide at 750 u/s used to snap both
  the body and the weapon into their slide pose in a single frame.
- **Instagib laser weapon added** (`weapon.ts`), viewmodel only — no firing or hits, which stay
  in Phase 4. Built early so movement can be tuned against what the game looks like from behind
  the gun; bob and sway are a large part of how fast movement reads.
- **`castRay` added to `CollisionWorld`.** Needed by the third-person camera, and it is the same
  query Phase 4's hitscan will use.
- **`MAX_GROUND_SPEED` dropped 320 → 250**, widening the gap between running and the movement
  tech. It has to stay above `SLIDE_MIN_SPEED` (200) or sliding out of a run stops working.
- **Air-crouch now visibly moves the camera.** The hull change and the eye-offset change cancel
  exactly, so the view used to stay perfectly still; the camera's duck now eases behind the
  hull's, which makes the pop visible. Cosmetic, render-time only.

### Scope added during Phase 1 (not in the original plan)
- Settings screen with live movement tuning, Source-1:1 sensitivity, raw input, FOV.
- Rebindable controls.
- Crouch and crouch-jump. Worth noting the original Phase 1 checklist never mentioned ducking at
  all, even though it is core Source movement and crouch-jumping is required to clear geometry on
  most real bhop maps. Flagging in case other base mechanics are missing from the plan rather
  than deliberately deferred — **surf ramp entry/exit while ducked is untested**, and long-jump
  (crouch + jump timing) has not been considered.
- **Slide** (and lurch, since removed). Both are Titanfall/Apex-family tech, which the roadmap
  explicitly parks in Phase 6 ("do not start earlier") alongside wallrunning. They were requested
  during Phase 1 and built, so that boundary has moved. Wallrunning is still deferred. Worth
  deciding explicitly whether Phase 6 now means "wallrunning only" or whether more Apex tech is
  expected earlier — each addition compounds the tuning surface, which is precisely why the
  roadmap wanted them serialised, and lurch is a concrete example of one that had to be backed
  out after it turned out to fight an existing mechanic.

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
- The character is greybox: flat-shaded procedural boxes, no textures, no authored animation.
  Bends are approximated by subdividing each bone and sharing the angle across the parts, which
  curves the silhouette but does not deform the surface across a joint the way skinning would.
  Real skinning wants an authored, weighted model (glTF) rather than procedural geometry — an
  asset-pipeline decision, and Phase 2 already plans glTF loading for maps, so worth doing both
  at once.
- Poses are hand-tuned constants rather than animation clips. Fine for four states (idle, walk,
  crouch, slide); it will not scale to combat animations.
- **Looking straight down in first person shows chest, not legs**, and that is geometry rather
  than a bug: legs sit directly under the torso (as they must, or the model looks wrong from
  every angle third person shows), so from directly above the torso occludes them. Games that
  show legs there either stagger the body forward of the camera or rely on the legs swinging out
  during a walk cycle. Worth revisiting only if it actually bothers anyone in play.
- Weapon is a viewmodel only. Firing, hit registration and any recoil or fire animation are
  Phase 4.

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
- [x] Laser weapon *model* — built during Phase 1 so movement could be tuned with it in view.
      See `packages/client/src/weapon.ts`. Everything it does is cosmetic.
- [ ] Hitscan raycast on fire input — `CollisionWorld.castRay` already exists, added for the
      third-person camera
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

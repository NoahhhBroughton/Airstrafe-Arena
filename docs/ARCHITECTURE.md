# Architecture

## Package layout

```
packages/
  shared/   pure movement + physics math, constants, network message schemas, map/collision
            geometry types. No DOM, no Node APIs. Runs identically in browser and server.
  client/   Three.js rendering, input capture (pointer lock, WASD, mouse), local prediction,
            interpolation/render smoothing, UI.
  server/   Node/Bun process. Owns the authoritative simulation. WebSocket connection handling,
            per-client input buffers, hit registration, snapshot broadcast.
```

## Fixed tick simulation

Both client (for prediction) and server (for authority) run the simulation at the same fixed
tick rate (`TICK_DT`, e.g. 1/64s). Never step movement physics using a raw `requestAnimationFrame`
delta — accumulate real elapsed time and consume it in fixed-size steps:

```
let accumulator = 0
function onFrame(frameDt):
    accumulator += frameDt
    while accumulator >= TICK_DT:
        simulateTick(TICK_DT)
        accumulator -= TICK_DT
    render(interpolationAlpha = accumulator / TICK_DT)
```

This keeps movement deterministic and reproducible across client/server regardless of frame rate.

## Client-side prediction + server reconciliation (Phase 3+)

Do not build this until Phase 1 movement is tuned and feels good standalone. When it's time:

1. Client tags each input with a sequence number, applies it locally immediately (prediction),
   and keeps a buffer of `{seq, input}` it has sent but not yet had confirmed.
2. Server runs the same shared movement function against the same input, at its own fixed tick,
   and periodically sends back an authoritative snapshot `{seq, position, velocity, ...}` — the
   last input sequence it has processed for that client.
3. Client, on receiving a snapshot: sets its state to the authoritative snapshot, then **replays**
   every buffered input newer than that snapshot's `seq` through the same shared movement
   function, arriving back at a corrected predicted state. This is why the movement function
   must be a pure, deterministic function of `(state, input) -> state` shared between client and
   server — reconciliation replay only works if both sides compute movement identically.
4. Other players (not the local client) are rendered from interpolated snapshots, not predicted —
   typically ~100ms behind real time, smoothed between the last two received snapshots.

## Hit registration / lag compensation (Phase 4)

Instagib is hitscan. To feel fair despite latency:

1. Server keeps a short rolling history of past authoritative player positions (e.g. last ~1s at
   tick resolution).
2. When a shot arrives from a client, the server rewinds *other* players to where they were at
   the shooter's estimated view time (their RTT/2 in the past), does the raycast against that
   historical state, then restores current state before continuing simulation.
3. This is the standard "server rewinds world to what the shooter saw" lag-compensation approach.
   It has known tradeoffs (a player can be shot "around a corner" from their own perspective) —
   worth knowing going in, not a bug to chase later.

## Networking transport

- Start with WebSocket (simple, reliable-ordered, good enough while netcode itself is being
  built and tuned).
- Revisit WebRTC unreliable/unordered data channels later if WebSocket's head-of-line blocking
  under packet loss becomes a real problem for movement/combat responsiveness — don't add this
  complexity preemptively.

## Anti-cheat posture

Server is authoritative for everything that matters (position for hit detection, damage,
kills). Client prediction is purely a local responsiveness illusion — if client and server
diverge, server wins, always. This falls out naturally from the architecture above; don't ever
trust a client-reported position/hit for anything that affects game state.

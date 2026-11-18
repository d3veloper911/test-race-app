# APEX RUSH

A neon, sunset-soaked pseudo-3D arcade racer that runs in a single browser tab — solo against the
clock, or head-to-head with friends over a shareable invite link.
No frameworks, no build step, no dependencies — just Canvas 2D, ~2,000 lines of JavaScript and a
hand-rolled WebSocket server.

![style](https://img.shields.io/badge/style-synthwave-ff2d7a) ![deps](https://img.shields.io/badge/dependencies-0-38e8ff)

## Run it

**Solo only:** double-click `index.html`.

**Or serve it** (needed for online races):

```bash
npm start          # http://localhost:5173
```

## Controls

| Action | Keys |
| --- | --- |
| Steer | `←` `→` / `A` `D` |
| Accelerate | `↑` / `W` |
| Brake | `↓` / `S` |
| Nitro | `Shift` / `Space` (hold) |
| Pause | `P` / `Esc` (solo only) |
| Mute | `M` |

On touch devices the game switches to auto-throttle and shows on-screen steer, brake and nitro buttons.

## The game

- **3 laps** around a procedurally generated coastal highway — curves, crests, S-bends and rolling hills.
- **Traffic** to weave through (solo). Hitting a car throws you back and kills your speed.
- **Nitro** with a drain/regeneration meter: hold it on the straights, save it for the corners.
- **Off-road** grass slows you down and kicks up dust.
- **Lap timer** with a persistent best lap (`localStorage`), lap banners, top-speed readout.
- **Synthesised audio** — engine drone tied to RPM, nitro whoosh, crash noise and countdown beeps (WebAudio, no assets).
- **Responsive** canvas that rescales with the window and adapts the HUD for small screens.

## Race with friends

1. Run `npm start` and open <http://localhost:5173>.
2. **RACE WITH FRIENDS** → type a name → **CREATE ROOM**.
3. The lobby shows a 4-letter room code and an invitation link (`…/?room=ABCD`).
   Hit **COPY LINK** and send it to whoever you want on the grid.
4. Everyone who opens the link drops straight into your lobby (they just pick a name).
   Up to **8 drivers** per room.
5. The host presses **START RACE**. Everyone gets the same countdown, the same generated track
   and their own physics; rivals show up as ghost cars with nameplates.
6. A live standings panel tracks the running order by lap + track position. After the flag, the
   host can send everyone **BACK TO LOBBY** for another race.

Notes:

- The invite link is built from whatever address you opened the game with. To race with someone on
  another machine, open the game via your LAN address first (e.g. `http://192.168.1.20:5173`), then
  copy the link from the lobby — it will carry that address. The server listens on all interfaces.
- Traffic is disabled online so every driver sees exactly the same road, and best-lap records stay
  a solo-only thing.
- Races can't be paused online (other people are still driving).
- Anybody can host: if the host leaves, the room promotes the next player. A room disappears once
  every player has left it. Rooms only accept new drivers while they're in the lobby.

## How it works

- The road is a list of segments, each with curvature and elevation. Every frame each visible
  segment is projected from world space to screen space with a simple pinhole camera
  (`scale = cameraDepth / z`), drawn back-to-front, and clipped against the previous hill crest.
- Roadside props (palms, neon posts, rocks, chevrons) and cars use the same projection, anchored to
  their segment's scale, so everything shares one perspective.
- The backdrop (sky gradient, striped sun, two mountain ridges, horizon haze) is drawn first and
  parallax-shifts with accumulated curvature, so the world feels like it turns with the road.
- All art is vector drawing at runtime — no image files at all.
- **Online:** physics is client-authoritative. Each client sends its own position at 20 Hz, the
  server broadcasts 15 Hz snapshots of everyone, and remote cars are interpolated between snapshots
  (wrap-aware, so they never jump across the finish line). A `time` ping/pong keeps every client's
  clock aligned with the server so the countdown starts together. The server is a small RFC 6455
  implementation (`server.js`) — no `ws` package, no dependencies.

## Files

```
index.html   markup + HUD / menu / lobby / overlays
style.css    synthwave UI skin, responsive layout
game.js      engine: track generation, projection, physics, traffic, audio, HUD, netcode
server.js    static file server + zero-dependency WebSocket room server (node server.js)
```

## Notes

- Your best lap is stored under `apexrush.best` and your name under `apexrush.name` in `localStorage`.
- There is a small `window.APEX` debug hook (start the race, step frames, snapshot the canvas, poke
  the multiplayer state) used for automated visual checks. Harmless during normal play.

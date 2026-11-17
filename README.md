# APEX RUSH

A neon, sunset-soaked pseudo-3D arcade racer that runs in a single browser tab.
No frameworks, no build step, no dependencies — just Canvas 2D and ~1,400 lines of JavaScript.

![style](https://img.shields.io/badge/style-synthwave-ff2d7a) ![deps](https://img.shields.io/badge/dependencies-0-38e8ff)

## Run it

**Easiest:** double-click `index.html`.

**Or serve it** (recommended, avoids any browser file:// quirks):

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
| Pause | `P` / `Esc` |
| Mute | `M` |

On touch devices the game switches to auto-throttle and shows on-screen steer, brake and nitro buttons.

## The game

- **3 laps** around a procedurally generated coastal highway — curves, crests, S-bends and rolling hills.
- **Traffic** to weave through. Hitting a car throws you back and kills your speed.
- **Nitro** with a drain/regeneration meter: hold it on the straights, save it for the corners.
- **Off-road** grass slows you down and kicks up dust.
- **Lap timer** with a persistent best lap (`localStorage`), lap banners, top-speed readout.
- **Synthesised audio** — engine drone tied to RPM, nitro whoosh, crash noise and countdown beeps (WebAudio, no assets).
- **Responsive** canvas that rescales with the window and adapts the HUD for small screens.

## How it works

- The road is a list of segments, each with curvature and elevation. Every frame each visible
  segment is projected from world space to screen space with a simple pinhole camera
  (`scale = cameraDepth / z`), drawn back-to-front, and clipped against the previous hill crest.
- Roadside props (palms, neon posts, rocks, chevrons) and traffic cars use the same projection,
  anchored to their segment's scale, so everything shares one perspective.
- The backdrop (sky gradient, striped sun, two mountain ridges, horizon haze) is drawn first and
  parallax-shifts with accumulated curvature, so the world feels like it turns with the road.
- All art is vector drawing at runtime — no image files at all.

## Files

```
index.html   markup + HUD / menu / overlays
style.css    synthwave UI skin, responsive layout
game.js      engine: track generation, projection, physics, traffic, audio, HUD
server.js    tiny zero-dependency static server (node server.js)
```

## Notes

- Your best lap is stored under `apexrush.best` in `localStorage`.
- There is a small `window.APEX` debug hook (start the race, step frames, snapshot the canvas) used
  for automated visual checks. Harmless during normal play.

# CRUISE

A driving game with nothing to win. No opponents, no countdown, no position
counter. You pick a car, pick a road, and go and find the limit — the racing
line, the brake points, the exact moment the rear steps out — for as long as you
feel like it.

Three reasons it exists:
1. Practising lines and brake points without a race attached to it.
2. Learning to hold a slide on a car that rewards it.
3. Something nice to have running behind a YouTube Short.

## Run it

```
cd ~/Games/cruise
python3 -m http.server 8137
```
Then open <http://localhost:8137>. No build step, no dependencies — three.js is
vendored in `js/vendor/`.

You can skip the menu with a URL: `?t=harbor&c=gt&go=1` — `t` is the track
(`harbor`, `canyon`, `seawall`, `city`), `c` the car (`silhouette`, `kei`, `gt`),
`sky` 0-3, `cam` (`chase`, `low`, `hood`, `drone`, `tv`, `orbit`), plus `go`,
`auto` and `shorts` as flags.

## Controls

| | |
|---|---|
| W/S or ↑/↓ | throttle, brake (hold brake at a stop to reverse) |
| A/D | steer |
| SPACE | handbrake |
| C | camera — chase, low chase, bumper, drone, trackside, free orbit |
| H / V | hide the HUD / 9:16 framing for vertical video |
| L / B | racing line / brake boards |
| G / P | ghost of your best lap / pace car |
| `[` `]` | pace car speed |
| `,` `.` | grip assist, 0-100% |
| Z | autopilot |
| F | freeze and orbit (photo mode) |
| R / T | back on track / back to the start |
| X | wipe skid marks |
| N | time of day |
| U / M | mph-kmh / sound |
| ESC | menu |

A gamepad works too — analog triggers and stick, A or RB for the handbrake.

## The practice bits

- **The line** is solved from the track shape, not hand-drawn: an iterative
  curvature minimiser inside the track width. It's coloured by what the pedals
  should be doing — **green** power, **amber** hold, **red** brake.
- **Brake boards** stand at 100/50/25 m before every real braking zone, worked
  out from a forward/backward speed-profile pass over that line. Same maths a
  real engineer uses to find a brake point.
- **The ghost** is your own best lap, replayed. The delta next to the lap timer
  is against it.
- **The pace car** drives the line perfectly at whatever percentage you set.
  Chasing something is the fastest way to learn a line — start it at 70% and
  work up.
- **Grip assist** (`,` / `.`) adds yaw damping and a bit of countersteer help.
  At 100% it's very hard to spin; at 0% it's all you.

## Shorts mode

The button on the menu turns on autopilot, 9:16 framing and no HUD, and puts
the camera on the trackside cuts. Hit record and walk away — it will drive
clean laps forever. `N` for night, `C` to change camera while it drives.

## The tracks

| | |
|---|---|
| **HARBOR LOOP** | 1.15 km. A long straight, fast esses over a crest, a 75 m sweeper you can hold sideways the whole way through, one slow 2nd-gear right. |
| **CANYON PASS** | 2.18 km point to point, 110 m of descent, six hairpins. Every one arrives at the end of a downhill straight, which is the hardest kind of brake point to get right. |
| **SEAWALL** | 550 m, wide and slow. The warm-up. Every corner can be taken sideways without much commitment. |
| **THE CITY** | Free roam. ~30 blocks, a waterfront, a skidpad with painted circles out west, and a street circuit routed through it with the same line and boards as the real tracks. |

## The cars

**SILHOUETTE** — RWD coupe, 0-60 in 3.9 s, 131 mph. Rear grip is deliberately
lower than front, so it rotates. The one to learn on.
**KEI** — 780 kg, 92 Nm, 78 mph. Never has enough power to get you out of trouble,
which makes carrying speed the whole game.
**GT** — 1420 kg, 480 Nm, planted. Best for brake-point drills, because it does
the same thing every time.

## How it drives

Bicycle model — one front tyre, one rear — with slip angles through a simplified
Pacejka curve that peaks around 8° and then falls away. That fall-off is why a
drift can sit at a steady angle instead of snapping. Longitudinal weight transfer
means braking loads the front and frees the rear (trail brake and it will rotate),
and the rear tyre has a friction circle, so throttle spends grip that cornering
was using — stamp on it mid-corner and the tail steps out. Engine torque goes
through real gear ratios, so the gearbox matters.

Physics runs at 240 Hz in substeps under a 120 Hz fixed loop.

## Tools

```
node tools/validate.mjs    # track geometry: length, tightest radius, self-intersections, ASCII map
node tools/sim.mjs 0.9     # drive every track with every car, headless, no browser
```
`sim.mjs` is the one that matters: it reports off-road percentage and worst
lateral error per car per track. If a change to the physics or a track breaks
something, that goes non-zero.

## Layout

```
js/car.js      physics — tyre model, weight transfer, gearbox
js/track.js    spline, racing line solver, speed profile, surface lookup
js/tracks.js   the hand-drawn layouts (every corner is a radius I picked)
js/city.js     the free-roam city and its street circuit
js/world.js    terrain, road, kerbs, props, the practice overlays
js/driver.js   the autopilot — pure pursuit + a brake-distance solver
js/carmesh.js  the low-poly car
js/fx.js       skid marks and tyre smoke
js/camera.js   the camera rigs
js/hud.js      timing, telemetry, minimap
```

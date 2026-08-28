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

Bodies are Kenney's CC0 Car Kit (`assets/models`, license inside). The physics
takes wheelbase and tyre size *from the model*, so the wheels sit in the arches.

**Serious** — HACHI (RWD drift hatch, the one to learn on) · GT (heavy, planted,
repeatable) · RALLY (AWD, long travel, gravel-happy) · FORMULA (open wheels,
real downforce, 2.2 g brakes) · HYPER (AWD, absurd, not a drift car)
**Fun** — MUSCLE (all torque, soft, tank-slappers on request) · KART (someone is
driving it, no suspension, 190 kg) · TAXI (front-drive, soft, somewhere to be)
**Silly** — PICKUP (lifted, leans like a boat) · LIMO (5 m wheelbase, turning circle
of a ship) · AMBULANCE (2.5 t, CG a metre up) · VAN (front-drive, full of boxes)

Every car is authored in plain terms in `js/presets.js` — mass, CG height, ride
frequency, damping, grip front/rear, engine, gears, drive — and `build()` turns
that into spring rates, dampers, inertias and brake torque.

## How it drives

Four wheels, four springs, four contact patches. The body is a sprung mass with
heave, pitch and roll; each corner has a spring, a bump/rebound damper, an
anti-roll bar and a bump stop, standing on the same terrain height field the
visual mesh is built from. Load transfer isn't a formula — it falls out of the
springs — so a crest unloads the car, a dip loads it, and the wheels leave the
ground when the maths says they do. Landings land on the springs.

Each tyre gets its own slip angle and slip ratio through a combined-slip magic
formula that peaks at ~0.2 and falls to 0.8 at a full slide (that fall-off is
why a drift holds). Load sensitivity, so a loaded tyre makes less than twice the
grip. Engine torque through real gear ratios and a limited-slip diff; brakes with
per-wheel EBD, ABS and traction control when the aids are on. Ackermann steering.

Physics runs at 300 Hz in substeps under a 120 Hz fixed loop. No collisions with
buildings on the tracks, no rollovers, nothing breaks — the city stops you at the
walls and that's it.

## What the aids slider does (`,` `.`)

0% is raw. Above that: ABS, traction control, engine-drag control, and a yaw
damper scaled to each car's inertia (~1 s time constant at 100%). The autopilot
always drives with everything on.

## Tools

```
node tools/validate.mjs             # track geometry: length, tightest radius, self-intersections, ASCII map
node tools/sim.mjs 0.85             # every car on every track, headless — the gate is 36/36 clean
node tools/sim.mjs 0.85 gt canyon   # one combo
node tools/trace.mjs gt canyon      # half-second timeline; flags the first OFF / SPIN with the tyre numbers
```
`sim.mjs` is the one that matters: it reports off-road percentage, worst lateral
error, spins and air time per car per track. If a change to the physics, a car
or a track breaks something, that goes non-zero. `trace.mjs` is how you find out
*why* — it turned "GT DNF on the canyon" into "weaving at 1 g on the straight,
so the friction circle refused to brake" in one run.

## Layout

```
js/car.js      physics — four-wheel sprung model, tyres, drivetrain, brakes
js/presets.js  the garage — every car in plain terms, built into physics constants
js/terrain.js  ONE height field for the visual terrain and the wheels
js/track.js    spline, racing line solver, speed profile, surface lookup
js/tracks.js   the hand-drawn layouts (every corner is a radius I picked)
js/city.js     the free-roam city and its street circuit
js/world.js    terrain, road, kerbs, props, the practice overlays
js/driver.js   the autopilot — pure pursuit + a brake-distance solver
js/carmesh.js  Kenney GLB bodies, wheels re-hung on the physics
js/fx.js       skid marks and tyre smoke
js/camera.js   the camera rigs
js/hud.js      timing, telemetry, minimap
```

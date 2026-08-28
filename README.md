# CRUISE

A driving game with nothing to win. No opponents, no countdown, no position
counter. You pick a car, pick a road, and go and find the limit — the racing
line, the brake points, the exact moment the rear steps out — for as long as you
feel like it.

Two ways to play it:
- **RACE** — a grid of bots (3 to 11), lights out, item boxes, three laps, a
  results sheet. Contact is real but nothing breaks. Drift to charge a turbo.
- **CRUISE** — the road to yourself, with the racing line, brake boards, your
  ghost and a pace car. For learning lines and holding slides.

And **SHORTS MODE**: a race on autopilot, 9:16, no HUD. Hit record, walk away.

## Screens

Title (a race plays behind it) → HOW (race / cruise / shorts, bots, laps) →
WHAT (the car on a turntable, with stat bars) → WHERE (track outlines, time of
day) → GO. Arrows / WASD / d-pad move, Enter / Space / A pick, Esc / B back.
Mouse and touch work too. Esc in the game brings the screens back.

## Run it

```
cd ~/Games/cruise
python3 -m http.server 8137
```
Then open <http://localhost:8137>. No build step, no dependencies — three.js is
vendored in `js/vendor/`.

You can skip the menu with a URL: `?t=harbor&c=gt&mode=race&bots=7&laps=3&go=1`
— `t` is the track (`harbor`, `canyon`, `seawall`, `city`), `c` the car id from
`js/presets.js`, `mode` race/cruise, `sky` 0-3, `cam` (`chase`, `low`, `hood`,
`drone`, `tv`, `orbit`), plus `go`, `auto` and `shorts` as flags.

## Steering

Your input asks for a *path curvature*, and the curvature is capped by lateral
g: full lock at 20 mph is a hairpin, full lock at 100 mph is a fast sweeper,
never a spin. The keyboard is ramped (0.2 s on, 0.08 s off) so a tap is a nudge.
Countersteer help and a yaw damper sit behind the aids slider (`,` `.`, default
70%). Space is the drift button: rear grip drops and the car is allowed to
rotate harder while it's held.

## The arcade layer

Same tyre model underneath, more of everything on top: grip ×1.55, torque ×3.4,
a real rear wing on every car so a drift car stays a drift car past 120 mph, and
a low CG so the inside wheels don't lift at 1.5 g. HYPER does 0-60 in 1.25 s,
the GT in 1.5, HACHI in 1.9. Tracks are 1.7× bigger and 24-34 m wide.

**Items** (E / Shift / pad X): NITRO · SLICK (a puddle behind you, 22% grip) ·
ZAP (stops the car ahead for a moment and spins it) · SHIELD · MEGA (you are
2.6 t and half again as big for 8 s — bump people). Leaders get bullied, the back
gets rockets.

**Drift turbo**: hold a slide past 16° — the SLIP bar fills through three
colours — straighten up and it shoves you. Everyone gets it, bots too.

**Bots** drive the same physics through the same autopilot, each with its own
pace, its own lane, elbows, mild rubber-band, and an itchy item finger.

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
| R / T | back on track (in a race: rescue with a 1.5 s shield) / restart |
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

## The roster — 23 cars

**Cup** — STREET · COP · LUXE · FLATBED · CAB. Five bodies, one set of numbers
(within a couple of percent on purpose). Pick by looks; the race is decided by
driving. Set the grid to EQUAL and the bots come from your class.
**Serious** — HACHI · GT · RALLY · FORMULA · HYPER.
**Fun** — MUSCLE · KART · KART II · KART III · TAXI.
**Silly** — PICKUP · LIMO · AMBULANCE · VAN · FIRETRUCK · GARBAGE · DELIVERY ·
TRACTOR (top speed of a brisk jog).

Every car has an arcade top speed of its own (a soft limiter) so the field is
gear-limited by design, not by accident.

## The tracks — 7 circuits + the city

HARBOR LOOP · SEAWALL · THE OVAL (two 120 m sweepers, flat out) · AIRFIELD
(four runways, three hairpins, a kink) · THE DOCKS (square corners, night,
handbrake country) · TOUGE (up one face, three stacked summit hairpins, down
the other) · CANYON PASS (point to point, 110 m down). All hand-drawn in
`js/tracks.js`, all validated by `tools/validate.mjs`.

## Elevation, kickers, whoops, tunnels

Every circuit has a height profile now — crests, dips, the touge's 60 m climb —
and features authored on top of the spline as fractions of the lap in
`js/tracks.js`: `jumps` (an eased ramp to a lip, then the road isn't there),
`whoops` (a rhythm section) and `tunnels` (walls, roof, lights). `world.js`
dresses them; the height field is the physics. Cars fly level, land on the
dampers, and the takeoff is capped so nobody hangs for three seconds. Bots line
up straight for a kicker and hold everything in the air.

## The selection screens

The car screen is a showroom: every car rendered live into a grid (from the
real models, class-coloured), the pick on a turntable on a stage that takes the
class colour, a skewed big name, stat bars that animate. The track screen has a
3D diorama of the selected circuit — the road as a ribbon with the hills
exaggerated, slowly turning — plus length, elevation and what's on it.

## Cruise — the open city

CRUISE is the city, full stop: 30 blocks, a waterfront, a skidpad, five cars of
slow traffic to weave through, and a couple of hundred things to hit — cone
slaloms on the boulevard, box stacks at the docks, tyre walls round the pad,
barrels at the junctions. Props are real: mass, friction, tumble, they bounce
off buildings and each other, and a barrel pushes back. `T` puts them back.

## Xbox / gamepad

Standard mapping: left stick steer, RT throttle, LT brake, A or RB drift,
X or LB item, Y camera, Start menu, Back hide HUD. D-pad / A / B on the
screens. Rumble on bumps, landings and nitro where the browser allows it.

## The cars (how they're made)

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
js/driver.js   the autopilot — pure pursuit + a friction-circle brake planner
js/bots.js     the grid: bots on the autopilot with lanes, elbows, items
js/race.js     countdown, laps, standings, car-to-car contact
js/items.js    boxes, five items, puddles
js/carmesh.js  Kenney GLB bodies, wheels re-hung on the physics
js/fx.js       skid marks and tyre smoke
js/camera.js   the camera rigs
js/hud.js      timing, telemetry, minimap
```

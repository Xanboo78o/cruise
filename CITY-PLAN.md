# SAN OOZI — the city rebuild (plan v2)

Adam, 2026-08-28, in order:

> "this is not how a city works."
> "all buildings need variation, this game should feel like youre just a normal
> person, and in a race, a bunch of hillbillies in cars just flying down roads
> semi legally lol … roads also need to be wider and have lines, and actually be
> thick, not just paper thin grey layer with attributes"
> "in the city buildings are RIGHT on the road, like cmon"
> "new plan, all unique houses, all of it, and optimized for a chromebook"

Everything below is a decision unless it's under **Open**. Another Claude owns
the look (textures, filters, materials, post — "realistic-ish, dashcam"); this
plan owns layout, geometry and performance, and leaves clean UVs for them.

## 0. The two constraints are one trick

**Every building unique** and **runs on a Chromebook** sound like enemies. They
aren't, because on a Chromebook the cost is not "different shapes" — it's
**draw calls, lights, shadows and pixels**. Today's city is 30 towers and ~450
houses, each its own mesh with its own material, a point light on every
billboard at night, shadow maps, and 24 traffic cars on 300 Hz physics. That is
already Chromebook-hostile, and it's all *identical* boxes.

So: uniqueness comes from a **building grammar** that gives every lot its own
recipe (shape, height, roof, facade, colour, details — no two alike, checked),
and speed comes from **merging** every building in a 300 m chunk into one
geometry with one shared material. Three thousand different buildings in ~40
draw calls is cheaper than today's 500 identical ones in ~1 000. Instancing
(identical copies) is the wrong tool for "all unique"; merging is the right one.

**Target machine:** a school Chromebook — Celeron N4000-class / Intel UHD 600
or a MediaTek ARM, 4 GB, 1366 × 768, Chrome. **Budget at 60 fps:** ≤ 120 draw
calls, ≤ 1.0 M triangles on screen, ≤ 150 MB GPU memory, **zero** shadow maps,
one directional + one hemisphere light, ≤ 4 point lights near the player,
physics ≤ 3 ms/frame, internal render resolution 0.5–0.75× (the dashcam look
wants 360p anyway — that alone is 4× fewer pixels than 1366 × 768).

## 1. What's wrong (measured off `tools/mapview.html` + a street shot)

| symptom | now | a real city |
|---|---|---|
| downtown blocks | 260 × 260 m, **12 of them** | 80–120 m, **hundreds** (downtown San Diego ≈ 300 at ~90 m) |
| what's in a block | 2–4 towers on a lawn | buildings shoulder to shoulder along every street edge |
| buildings vs the road | walls start where the asphalt stops | parking lane, kerb, wide pavement with trees/lamps/parked cars, then a setback by use |
| districts | rectangles in forest, ~10 % of the land inside the ring | continuous fabric, density fading out, no hard edges |
| suburb streets | two zigzags, no cross-streets | collector loops, curving locals, cul-de-sacs |
| street widths | everything 22 m | a hierarchy (see rule 1) |
| roads | a flat grey ribbon | a kerbed slab with lines |
| the freeway | a rectangle at grade, 90° corners | curved, raised, ramps, overpasses, an interchange |
| intersections | a disc | stop lines, crosswalks, signals, medians |
| land | 6–12 m plateau steps | slopes; streets climb hills |
| buildings | 4 tower patterns, 1 house shape | every one different |
| uses | towers, sheds, houses | + mid-rise, shops, strip malls, gas stations, parking, dealerships, schools, parks, stadium |
| life | lamps, walkers | parked cars everywhere, lights, trees, buses, fences, driveways, signs |
| perf | a material per building, a light per billboard, shadows, 24 cars on full physics | merged chunks, one material, no shadows, cheap traffic |

The bones are fine — coast, mountain, canyon, harbour, venues, ring position.
It's the fabric between them that doesn't exist.

## 2. The rules

1. **Hierarchy, wide.** Freeway 32 · boulevard 36 · avenue 26 · street 18 ·
   alley 9 m of asphalt, each with its own lanes, lines, speed and frontage.
   Races run on the top three.
2. **Small blocks in the middle, bigger going out.** 90 × 110 m downtown,
   140 midtown, 150–200 suburbs, 300–400 industrial.
3. **A gradient, not rectangles.** Towers → mid-rise → shops → houses →
   ranchettes on gravel → forest. Bands overlap and blend.
4. **The road is not the street.** Every road owns a corridor wider than its
   asphalt and nothing builds inside it: parking lane 2.5 m each side + kerb +
   pavement 5–8 m (trees, lamps, bins, bus stops) + verge. Street 18 → 34 m
   corridor; avenue 26 → 46; boulevard 36 → 60 with palm rows; freeway 32 → 60
   of shoulder, embankment, sound walls. Then a **setback by use**: towers
   15–20 m (forecourt plaza, planters, drop-off loop); shops 0 (at the back of
   the pavement, awnings over it); apartments 5; houses 10–14 of lawn and
   driveway; warehouses 20–30 of yard and fence; a dealership's lot *is* its
   frontage. Nothing ever touches the asphalt.
5. **Arterials carry the commerce.** OOZI BOULEVARD out of town is THE STRIP:
   dealerships, tyre shops, motels, gas stations, drive-thrus, the drive-in,
   the kart track, pylon signs. The Oo's car culture, visible.
6. **Streets follow the land.** Grid on the flats, contour streets on the
   hills, the freeway on its own embankment. No plateaus.
7. **The freeway is its own layer.** Embanked, curved, ramps every ~800 m, THE
   STACK where Rim Express crosses the ring, overpasses over the streets it
   crosses; elevated on pillars only for the harbour viaduct and the BAY BRIDGE
   (downtown → docks over the water, 1.2 km, the biggest jump in the game).
8. **Legibility.** From anywhere you see the tower, the bridge, the stadium
   lights, the pier or the canyon gash. You never need the map to get home.
9. **Every building is one of a kind.** All of them — towers, shops, houses,
   sheds. A grammar per lot (§4-D), a registry that rejects any repeat, and the
   landmarks drawn by hand on top.
10. **You're a normal person.** You start at your Oo's house, car in the drive.
    Traffic stops at lights and indicates, buses run, pedestrians cross at
    crosswalks, a cop sits at the gas station, people are at the beach. The
    race is something you *choose* to do in the city.
11. **A race is a street meet.** No walls, no plugged side streets, no arch
    (only at the speedway, airfield and mine, where they'd really be). A meet
    spot — a parking lot, a gas station, the pier lot, the lookout — with the
    Oo and their cars, a flare drop → GO, public roads through live traffic,
    the pack and the checkpoint arrows as guidance, cops if the chaos meter
    fills.
12. **Roads are slabs.** A solid kerbed body: 0.15 m kerb lip the wheels feel,
    crowned surface, pavements a step up, painted lines (centre, lane dashes,
    edge, stop lines, crosswalks, arrows) as thin geometry, gutters.
13. **Chromebook first.** Every system below ships with its low setting as the
    default and gets measured on the real machine before the next one starts.

## 3. The plan of San Oozi

Keep: COAST, mountain, CANYON, SEAWALL ROAD, the pier, touge, mine, canyon
sprint, forest tracks, the venues' positions. Redraw everything inside the ring.

- **DOWNTOWN** — ~100 blocks of 90 × 110 m between HARBOR FRONT and OOZI
  BOULEVARD; the middle 4 × 4 towers, the rest mid-rise; OOZI SQUARE kept as a
  whole block; two boulevards with medians and palms; avenues every 3rd street.
- **MIDTOWN** *(new)* — 3–6 storeys wrapping downtown, 140 m blocks; corner
  shops, apartments, the hospital, the stadium.
- **THE STRIP** *(new)* — the boulevard east and west out of town.
- **WESTSIDE / EASTSIDE** — real suburbs: collector loop, curving locals,
  cul-de-sacs, driveways, fences, a school with a field, a park, a strip mall
  at every collector corner.
- **THE HILLS** *(new)* — contour streets climbing between the suburbs and the
  ring; big houses with views; steep streets down into midtown.
- **HARBOR** — marina, ferry terminal, fish market, the bridge landing.
  **DOCKS** — 400 m container blocks, cranes, tank farm, the drift zone.
- **OOZI BEACH** — the boardwalk plus a small beach town behind it (a 6 × 4
  grid of tiny blocks, surf shops, bars), the pier at its head.
- **INDUSTRIAL / AIRFIELD** — warehouses on the approach road, a parking apron,
  the terminal. **SPEEDWAY** — parking fields, the campground.
- **Outside the ring** density fades: ranchettes on the gravel, a truck stop at
  each exit, then forest.

**Size (decided, because of the Chromebook):** ~100 downtown + ~120 suburb +
~30 industrial blocks ≈ 3 000 buildings. World stays 6 × 4.6 km; the rest is
forest, and forest is cheap. A flat-out lap of the city stays near 2 minutes.

## 4. Systems

- **A. Road hierarchy + slabs** — `spec.js` gets `avenue`, `alley`, `ramp`,
  `bridge`; per-type asphalt width, corridor width, lanes, kerb, median, speed.
  `build.js` roads become solid bodies (crowned deck, kerb walls, pavement
  step) with painted lines as thin geometry and UVs in metres. `terrain.roadY`
  gains the kerb lip so a wheel feels it. Roads merge per chunk like everything
  else.
- **B. Grid primitive** — a hand-written `G({origin, rot, nx, nz, dx, dz,
  type, skip})` that expands into listed streets; every number a hand
  decision, checked in mapview. Curving suburb locals stay hand-drawn point
  lists. (Open 1.)
- **C. Real intersections** — replace the discs: the crossing polygon of two
  slabs, stop lines, crosswalks, signal poles at avenue+ crossings, stop signs
  at locals. Traffic obeys them.
- **D. Blocks → lots → the building grammar.** Block polygons come from the
  street graph, inset by each road's **corridor** half-width (not its asphalt)
  → a use from the density band → lots along each edge → one building per
  lot, facing the street, behind its use's setback. Each building is a recipe
  seeded from its lot id:
  - *mass*: the lot minus setback, split into 1–3 volumes (main, wing, tower
    on podium); tiers and upper setbacks by height;
  - *floors*: from the band (towers 12–40, midtown 3–6, shops 1–2, houses 1–2);
  - *roof*: flat + parapet, plant room, pitched gable, hip, mansard, sawtooth
    (industrial), with chimneys, tanks, antennae, AC units;
  - *facade*: glass, punched windows, brick, stucco, shopfront ground floor;
    bay width, sill height, balconies, fire escape, awnings, entrance canopy;
  - *house*: main + wing + garage + porch, gable/hip/flat, 1–2 storeys, fence,
    driveway, a tree, a car in the drive;
  - *colour*: a 24-colour city palette weighted per district; *sign*: from
    the ADS list on shops and towers.
  That is ~10⁸ combinations. A registry rejects any recipe already used, so
  "no two alike" is a guarantee across all 3 000, not a probability. Landmarks
  (the tower, stadium, hospital, terminal, the square's sign) are drawn by
  hand. Facades are UV'd into **one 2 048² atlas** (window grids, shopfronts,
  brick, stucco, roofs) — uniqueness costs zero draw calls.
- **E. Terrain** — plateaus gone; districts become a max-grade cap (3 %
  downtown, 12 % hills) blended over 300 m. Mesh 8 m near, 32 m far.
- **F. Freeway layer** — embankment mesh where < 4 m above land, pillars where
  higher (viaduct + bridge only); ramps join at grade; streets pass under
  through the embankment.
- **G. Street furniture** — parked cars (Kenney Car Kit, instanced, 3 LODs:
  full / low / a box), signals and lamps instanced per chunk, trees instanced
  near and billboard impostors far, bins/hydrants/fences merged into the chunk.
- **H. The Chromebook renderer** — the load-bearing system:
  - **Chunks**: one merged geometry per 300 m cell per LOD (buildings +
    pavements + furniture + roads), vertex colours + the one atlas → **one
    material for the whole city**. Visible chunks ≈ 25 → ≈ 25 draw calls.
  - **LOD**: LOD0 < 400 m full grammar; LOD1 400–1 200 m the same buildings as
    plain boxes with the atlas; beyond that, fog. Chunks built once on load
    (in a worker if the main thread stalls), cached.
  - **Light**: no shadow maps — baked vertex AO instead (ground floor, under
    eaves, between close buildings). One directional + hemisphere. Night:
    emissive windows in the atlas, lamps as emissive sprites, headlights as
    two spot lights, ≤ 4 real point lights near the player, none on billboards.
  - **Materials**: Lambert everywhere, alpha-test not blending.
  - **Pixels**: internal render scale 0.5–0.75× (the dashcam target), auto
    from measured frame time; `?quality=low|med|high` + auto-detect (GPU
    string, `deviceMemory`, cores).
  - **Physics**: the player on the full 300 Hz model; traffic on a cheap
    kinematic follower except within 60 m of the player; race bots full
    physics but ≤ 6 on low; peds ≤ 120 on low.
  - **Memory**: 3 000 buildings × ~300 tris × 2 LODs ≈ 2 M tris ≈ 60 MB.
  - **Instrument first**: `?stats=1` overlay — fps, draw calls, triangles,
    physics ms, render ms, from `renderer.info`.
- **I. Races as street meets** — `dressing.js` drops walls/plugs/arch except at
  venues; a `meet` per race (spot, parked rivals with their Oo, flare, crowd);
  side streets stay open; traffic keeps flowing; chaos → cops exists already.
  The Oo's homes/jobs re-seed onto the new lots; the player spawns at home.
- **J. Assets** — Kenney CC0 kits for what repeats by nature (cars, lamps,
  signs, trees, cones — Car Kit + City Kit Roads props). Buildings come from
  the grammar, never from a kit: kit pieces are identical by definition.

## 5. Build order — each phase measured on the Chromebook before the next

0. **Instrument + low profile.** `?stats=1` overlay; `?quality=low` that turns
   shadows off, lights down, traffic cheap, render scale 0.6 — on the city as
   it is today. Adam opens the live URL on the Chromebook and reads the
   numbers: that's the baseline.
1. **Chunk renderer.** Merge today's buildings/pavements/lamps into chunk
   meshes with one atlas material + LOD + fog. Prove the budget on the
   existing city *before* redrawing anything. Gate: 60 fps on the Chromebook.
2. **Roads.** Hierarchy, corridors, slabs with lines, real intersections, the
   downtown grid redraw. Gate: mapview reads as a city plan; `sim.mjs` clean.
3. **The grammar.** Blocks → lots → unique buildings: downtown, midtown, the
   Strip. Gate: a `tools/shot.mjs` street shot reads as downtown; no two
   buildings alike (registry count = building count); still 60 fps.
4. **Suburbs + the Hills + terrain.** Plateaus gone, contour streets, unique
   houses with driveways and fences.
5. **Freeway.** Embankment, ramps, the Stack, overpasses, the viaduct, the
   Bay Bridge.
6. **Street life + street meets.** Signals traffic obeys, parked cars, trees,
   buses, pedestrians crossing; walls/plugs/arch out, meets in.
7. **Re-home** the 12 races, challenges, figurines, Oo homes/jobs; re-validate
   with `sim.mjs` + `trace.mjs`; final Chromebook pass on the live URL.

Phases 0–1 first: they're the ones that decide whether the rest is allowed.

**Who touches what** (two Claudes, one repo): this plan owns `world/spec.js`,
`world/districts.js` (→ the grammar), `world/terrain.js`, `world/dressing.js`,
road + chunk geometry in `world/build.js`, `world/races.js`, the stats overlay.
The look Claude owns materials, textures, lighting, `post.js`, sky/fog. Where
both need `build.js`, geometry and material stay in separate functions, and
both check `git status` before touching it.

## 6. Open (Adam's call)

1. **The no-generated-levels rule.** A downtown grid written as one line — "12
   avenues × 9 streets from here, 90 m apart, skip these two for the square" —
   hand-authoring or generating? The alternative is you sketch the street plan
   (paper / iPad) and I trace it into mapview. My vote: hand-listed grids for
   the flat parts, hand-drawn point lists for everything that curves. (The
   building grammar is *dressing*, not layout — the streets and blocks are
   still where a hand put them.)

Decided by me because of the Chromebook, overridable: the size (§3) and the
freeway (rule 7 — elevated only for the viaduct and the bridge).

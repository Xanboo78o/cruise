# SAN OOZI — the city rebuild

Adam, 2026-08-28: *"this is not how a city works."* He's right. This is the master
plan to fix it. Everything below is a decision unless it's under **Open**.

## 1. What's wrong (measured off `tools/mapview.html`)

| symptom | now | a real city |
|---|---|---|
| downtown blocks | 260 × 260 m, **12 of them** | 80–120 m, **hundreds** (downtown San Diego ≈ 300 blocks at ~90 m) |
| what's in a block | 2–4 towers on a lawn | buildings shoulder to shoulder along every street edge |
| districts | rectangles floating in forest, ~10 % of the land inside the ring | continuous fabric; density fades out, no hard edges |
| suburb streets | two zigzags with no cross-streets | collector loops, curving locals, cul-de-sacs, a grid bent by hills |
| street widths | everything 22 m (a 6-lane road) | a hierarchy: freeway 26 · boulevard 30 · avenue 18 · street 12 · alley 7 |
| the freeway | a rectangle at grade with 90° corners | curved, raised, on/off ramps, overpasses, one big interchange |
| intersections | a disc at each polyline vertex | stop lines, crosswalks, signals, medians, turn lanes |
| land | 6–12 m plateau steps between districts | gentle slopes; streets climb hills (SF), never terraces |
| buildings vs the road | walls start where the asphalt stops (a 4.5 m pavement strip, nothing on it) | parking lane, kerb, a wide pavement with trees/lamps/parked cars, then a setback that depends on what the building is |
| uses | towers, sheds, houses | + mid-rise, shops, strip malls, gas stations, parking lots, dealerships, schools, parks, a stadium |
| life | lamps, a few walkers | **parked cars everywhere**, traffic lights, street trees, bus stops, fences, driveways, signs |

The bones are fine — coast, mountain, canyon, harbour, venues, ring position.
It's the **fabric** between them that doesn't exist.

### Adam's second note (same day)

> "all buildings need variation, this game should feel like youre just a normal
> person, and in a race, a bunch of hillbillies in cars just flying down roads
> semi legally lol … roads also need to be wider and have lines, and actually be
> thick, not just paper thin grey layer with attributes"

So, on top of the table: **no two buildings alike**; **you are a normal person in
a normal city** (cruise = ordinary life going on around you); **a race is a
street meet, not a sanctioned event** — no concrete walls, no plugged side
streets, no gate arch: a pack of Oo in their cars flying down public roads
through live traffic, semi-legally, cops optional; and **roads are wide slabs
with lines and kerbs**, not a flat grey ribbon. Another Claude owns the look
(filters, textures, materials, post — "realistic-ish, dashcam"); this plan owns
the geometry and the layout and leaves clean UVs and real surfaces for them.

## 2. How a city works — the eight rules the rebuild follows

1. **Hierarchy.** Freeway → boulevard → avenue → street → alley. Each has its own
   width, markings, speed, and what fronts it. Adam wants wide: freeway 32 ·
   boulevard 36 · avenue 26 · street 18 · alley 9. Races run on the top three.
2. **Small blocks in the middle, bigger going out.** 90 × 110 m downtown, 140 m
   midtown, 150–200 m suburbs, 300–400 m industrial.
3. **A density gradient, not rectangles.** Tower core → mid-rise → low commercial
   → houses → ranchettes on gravel → forest. Bands overlap and blend.
4. **The road is not the street.** Every road owns a corridor much wider than
   its asphalt — the *right of way* — and no building may enter it:
   asphalt + parking lane (2.5 m each side) + kerb + pavement (5–8 m, with
   trees, lamps, bins, bus stops) + verge. Street 18 → corridor 34 m; avenue 26
   → 46 m; boulevard 36 → 60 m with palm rows; freeway 32 → 60 m of shoulder,
   embankment and sound walls. Then a **setback by use** before the wall:
   towers 15–20 m (a forecourt plaza, planters, a drop-off loop); shops 0 m
   (they sit at the back of the pavement, awnings over it); apartments 5 m;
   houses 10–14 m of lawn and driveway; warehouses 20–30 m of yard and fence;
   a dealership's lot *is* its frontage. Buildings face the street, corners
   get the best building, parking goes behind — but nothing ever touches the
   road.
5. **Arterials carry the commerce.** The boulevard out of town is THE STRIP:
   dealerships, tyre shops, motels, gas stations, drive-thrus, a drive-in, the
   kart track. That's where the billboards and the Oo's motorsport culture live.
6. **Streets follow the land.** Grid on the flats, contour streets on the hills,
   the freeway on its own embankment. No plateaus — the hills are the fun part.
7. **The freeway is a separate layer.** Raised, curved, ramps every ~800 m,
   overpasses where it crosses streets, one stack interchange, a viaduct along
   the harbour and a bridge across the bay (San Diego's Coronado).
8. **Legibility** (Kevin Lynch): paths, edges, districts, nodes, landmarks.
   Wherever you are you can see one of: the tower, the bridge, the stadium
   lights, the pier, the canyon gash. You should never need the map to get home.
9. **No two buildings alike.** Silhouette × height × colour × facade × roof ×
   setback × sign, and a rule: nothing repeats within three lots or across the
   street. Corners, mid-block and the ends of a street are different kinds.
10. **You're a normal person.** You start at home (your Oo's house, car in the
    drive), the city is going about its day — traffic that stops at lights and
    indicates, buses, pedestrians crossing at crosswalks, a cop parked at the
    gas station, people at the beach. The race is what you *choose* to do in it.
11. **A race is a street meet.** No walls, no plugs, no arch. A meet spot (a
    parking lot, a gas station, the pier lot, the canyon lookout) with the Oo
    and their cars, engines running, a flare drop → GO; the route is public
    roads through live traffic; you follow the pack and the checkpoint arrows;
    cops notice if the chaos meter fills. Walls only where they'd really be
    (the speedway, the airfield, the mine).
12. **Roads are slabs.** A road is a solid kerbed body, not a decal: 0.15 m
    kerb lip, pavements a step up, crowned surface, painted lines (centre,
    lane dashes, edge, stop lines, crosswalks, turn arrows) as geometry on top,
    gutters and drains. From a dashcam at wheel height the kerb is what sells it.

## 3. The new plan of San Oozi (district by district)

Keep: COAST, the mountain, CANYON, SEAWALL ROAD, the pier, the touge, the mine,
the canyon sprint, forest tracks, the venues' positions. Redraw everything inside
the ring.

- **DOWNTOWN** — the tower core. A 12 × 9 grid of 90 × 110 m blocks between
  HARBOR FRONT and OOZI BOULEVARD (~100 blocks; the middle 4 × 4 are towers,
  the rest mid-rise). OOZI SQUARE stays, as a whole block. Two boulevards with
  medians and palm rows; avenues every 3rd street; alleys mid-block.
- **MIDTOWN** *(new)* — a 3–6 storey band wrapping downtown, blocks 140 m.
  Corner shops, apartment blocks, a hospital, the stadium (a real landmark).
- **THE STRIP** *(new)* — OOZI BOULEVARD east and west out of town: car
  dealerships with flag rows, tyre shops, motels, gas stations, drive-thrus, the
  drive-in, big pylon signs. Parking lots front the road here (it's a car city).
- **WESTSIDE / EASTSIDE** — real suburbs: a collector loop off the boulevard,
  curving locals, cul-de-sacs, blocks 150–200 m, houses with driveways, fences,
  cars in the drive, a school with a field, a park, a strip mall at every
  collector/arterial corner.
- **THE HILLS** *(new)* — between the suburbs and the ring the land climbs;
  contour streets switch back up the slope, big houses with views (La Jolla).
  SF-style steep streets downhill into midtown = jumps without ramps.
- **HARBOR** — the marina (pontoons, boats), the ferry terminal, the fish
  market, the BAY BRIDGE landing. **DOCKS** — container yards in 400 m blocks,
  cranes, tank farm, the drift zone. The bridge links downtown to the docks over
  the water: a 1.2 km signature drive and the biggest jump in the game.
- **OOZI BEACH** — the boardwalk plus a small beach town behind it (Pacific
  Beach: a 6 × 4 grid of tiny blocks, surf shops, bars, the pier at its head).
- **INDUSTRIAL / AIRFIELD** — warehouses in big blocks along the approach road,
  a parking apron, the terminal. **SPEEDWAY** — parking fields, the campground.
- **THE RING** becomes a freeway: curves not corners, 6 m up on an embankment,
  4 interchanges (RIM EXPRESS × ring = THE STACK), ramps every ~800 m,
  overpasses over every street it crosses, the harbour viaduct on pillars.
- **Outside the ring** density fades: ranchettes on the gravel roads, a truck
  stop at each freeway exit, then forest.

## 4. Systems to build (what changes in the code)

- **A. Road hierarchy + road slabs** — `spec.js` gets `avenue`, `alley`, `ramp`,
  `bridge` types; per-type width, lanes, kerb, median, speed. `build.js`
  roads become solid bodies: crowned deck + kerb walls + pavement step, painted
  lines as thin geometry (centre, lane dashes, edge, stop lines, crosswalks,
  arrows), proper UVs (metres along / across) so the look Claude can texture it.
  The physics height (`terrain.roadY`) gains the kerb lip so a wheel feels it.
- **B. Grid primitive** — a hand-written `G({origin, rot, nx, nz, dx, dz, type,
  skip})` that expands into listed streets. Every number is a hand decision,
  checked in mapview; curving suburb locals stay hand-drawn point lists.
  (See Open 1 — this is the one rule I need Adam's read on.)
- **C. Real intersections** — replace the discs: compute the crossing polygon of
  the two ribbons; stop lines, crosswalks, signal poles at avenue+ crossings,
  stop signs at locals. Traffic obeys signals (stop on red).
- **D. Blocks as first-class** — derive block polygons (faces of the street
  graph) → **inset by each road's right-of-way half-width, not its asphalt** →
  each block gets a use from its density band → lots along each edge → a
  building placed per lot, facing the street, behind its use's setback. The
  strip between asphalt and lot line is the pavement system (kerb, parking
  lane, pavement, trees, lamps) and is built per road, not per district. Building kit = ~20 silhouettes
  (slab, tower-on-podium, stepped, L, courtyard, shopfront row, warehouse,
  bungalow, two-storey, garage-front…) × height × 12-colour palette × facade
  (shopfront / windows / brick / stucco / glass) × roof (flat, plant, parapet,
  pitched, awning) × setback × sign, all **instanced** by piece; a no-repeat
  rule within three lots. Parking lots (asphalt + bays + parked cars), gas
  stations, strip malls, dealerships, schools, the stadium are kit pieces too.
  Materials stay simple and UV'd so the look Claude can texture them.
- **E. Terrain** — drop the plateaus. Districts become a max-grade cap (3 %
  downtown, 12 % hills) blended over 300 m; the road cut/fill already works.
- **F. Freeway layer** — an elevated ribbon: embankment mesh where < 4 m above
  land, pillars where higher; ramps join at grade; where a street crosses under
  it gets a tunnel through the embankment. Bridge = deck + pylons over water.
- **G. Street furniture** — parked cars (Kenney Car Kit, instanced — the single
  cheapest "this is a city" signal), signals, crosswalks, palms on boulevards /
  pines on hills, bus stops, hydrants, bins, suburb fences, pylon signs.
- **H. Performance** — everything instanced and chunked per 300 m cell like the
  forest; far blocks drop to flat boxes. Target: ~3 000 buildings + ~2 000
  parked cars + signals at 60 fps, and cheaper still at 360p dashcam.
- **I. Races become street meets** — `dressing.js` drops walls/plugs/arch for
  everything but the real venues; a `meet` per race (spot, parked rivals with
  their Oo, flare, crowd on the pavement); the route stays a `Route` but the
  side streets stay open — the line + checkpoint arrows + the pack are the
  guidance; traffic keeps flowing on the route; chaos → cops already exists.
  Traffic junction table works off the graph already; the Oo's homes/jobs
  re-seed onto the new lots; the player spawns at their Oo's home; challenges
  re-placed.
- **J. Assets** — per *stock assets, not generated*: pull Kenney's CC0 City Kits
  (Commercial, Suburban, Industrial, Roads) before authoring anything; author
  only what the kits lack, in their style, headless in Blender.

## 5. Build order (each phase leaves the game playable and gated)

1. **Road hierarchy + grid primitive + downtown redraw + real intersections.**
   Gate: mapview reads as a city plan; drive it; `sim.mjs quick` clean.
2. **Blocks → lots → building kit, street wall, parking, the Strip.**
   Gate: a headless street-level screenshot reads as downtown at a glance.
3. **Terrain: plateaus gone, the Hills band with contour streets.**
4. **Suburbs redrawn** (collectors, curves, cul-de-sacs, driveways, fences).
5. **Freeway layer**: embanked ring, ramps, the Stack, overpasses, the Bay Bridge.
6. **Street life**: signals traffic obeys, parked cars, trees, bus stops, signs.
7. **Re-home** the 12 races, challenges, figurines, Oo homes/jobs; re-validate
   every race with `sim.mjs` + `trace.mjs`.
8. **Perf pass**; the look (textures, filters, dashcam) is the other Claude's
   track and lands whenever it's ready — the geometry here is built for it.

Phase 1–2 first, then STOP and drive it before touching 3–8.

**Who touches what** (two Claudes in one repo): this plan owns `world/spec.js`,
`world/districts.js`, `world/terrain.js`, `world/dressing.js`, road geometry in
`world/build.js`, `world/races.js`. The look Claude owns materials, textures,
lighting, `post.js`, sky/fog. Where both need `build.js`, geometry and material
stay in separate functions, and both check `git status` before touching it.

## 6. Open (Adam's calls)

1. **The no-generated-levels rule.** A downtown grid written as one line — "12
   avenues × 9 streets from here, 90 m apart, skip these two for the square" —
   is that hand-authoring or generating? The alternative is you sketch the street
   plan (paper / iPad) and I trace it into mapview. My vote: hand-listed grids
   for the flat parts, hand-drawn point lists for everything that curves.
2. **How big.** ~120 downtown blocks + ~150 suburb blocks keeps a flat-out lap
   of the city near your 2-minute call and is about the size of downtown San
   Diego. 300+ blocks is possible but the end-to-end drive doubles.
3. **The freeway.** Fully elevated everywhere (huge payoff, biggest job), or
   embanked at grade with curves and ramps, elevated only for the harbour viaduct
   and the bridge? My vote: the second.
4. ~~Road width vs the arcade~~ — **answered: wider.** Widths in rule 1 are the
   wide set (streets 18 m, avenues 26, boulevards 36, freeway 32); alleys 9.

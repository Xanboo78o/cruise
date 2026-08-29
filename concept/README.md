# concept/ — you draw it, I build it

The maker is there for touch-ups. The real way San Oozi gets designed is this:
you draw on paper or the iPad, the drawing lands in `concept/inbox/`, I read it
and build the world from it with `tools/sculpt.mjs`.

## How to hand a sketch over

- Draw over **`template.png`** (any app). It's the world from above: 6 km wide,
  4.6 km tall, north up, one square = 250 m, sea level = 0. Or draw on paper
  and photograph it — just keep the grid visible.
- On this PC: drop files into `concept/inbox/`.
- From the iPad / phone: open `http://192.168.1.217:8137/concept.html` on the
  wifi, PICK PICTURES. (Needs `sudo ufw allow 8137` once on the PC.)
- Then tell me: "look at concept/inbox". I read pictures directly.

## What to mark on the map

- **Peaks**: a dot with the height — `● 1800`.
- **Ridges**: a line along the crest with a height — `——— 1400`.
- **Valleys / canyons**: a line with a depth — `~~~ −80` (below the land around it).
- **Plateaus / flat pads**: an outline with a height — `[ 300 ]`.
- **Lakes**: an outline with `lake` (the ground goes under sea level → water).
- **The road**: a line. Write what it is (expressway / hill road / gravel /
  street / boulevard) and mark **T** for tunnel, **H** for hairpin, **X** for a
  viewpoint / pull-off, **B** where you want it to bridge.
- **Ground**: shade or write it — pine forest, dry grass, rock, sand, snow.
- **Buildings and places**: a box with a name — `gas station`, `lookout`, `town`.

Rough is fine. Numbers beat neatness: "1800" on a dot tells me more than a
beautiful contour drawing. Then draw a crap ton of concept for the *feel* —
what a viewpoint looks like, how the road hugs the cliff, the tunnel mouth,
the trees. Those don't need a grid at all.

## What happens next

I transcribe the map into a concept file (`concept/*.json`), run

    node tools/sculpt.mjs concept/angeles-crest.json

which writes `assets/city/sanoozi.json` — the terrain from your heights, the
road from your line (it rides the land and bridges the dips on its own), the
ground colours — and you drive it. Then you mark what's wrong on the next
sketch and we go again.

## What the build does on its own

- **Roads connect.** Every loose end in the drawing is joined: snapped onto a
  road it nearly touches, extended to the road it was heading for, and any
  cluster left on its own gets a link road. Decks meet flush at every junction.
  A road never dips under the water (it becomes a causeway).
- **The canyon.** The orange area is a low mesa; the black lines inside it are
  the divots — slot trenches two canyon roads wide with a gravel road on the
  floor, open at the end nearest the streets (a long one is open at both).
- **No terrain clipping.** Roads own the ground beside them (cut walls,
  embankments, bridges); the land is drawn exactly where the wheels stand.
- Check any build with `node tools/worldcheck.mjs assets/city/sanoozi.json map.png`
  — every count except the divots' dead ends should be 0.
- **Buildings and trees.** `node tools/populate.mjs` lines every street with
  buildings that face it — what they are follows how dense the streets are
  right there (a tight grid: towers, shops, apartments; loops: houses; the
  hill: cabins; the shore: beach houses; the red mesa: nothing) plus street
  lamps in town and a few landmarks. It only replaces its own pieces (tagged
  `b:1`), never what you placed by hand. The forest grows in the game itself
  (instanced, thinning to gardens inside town, palms by the water, pines up
  high) — paint extra trees with the FOLIAGE brush wherever you want more.

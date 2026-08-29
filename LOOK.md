# THE LOOK — what changed, where, and how to look at it

**Then, later the same evening:** *"undo the full art of rally change. just name
the filter rally and let the user choose what they like most"* — so **KART is the
default again and RALLY is one of four looks**, picked with the number keys
1-4 while driving ("just let me choose with 1,2,3,4 like before"); the choice
is remembered (`cruise.look`). The RALLY look kept its
upgrade: flat colour everywhere, faceted ground, thick tinted haze, pastel
palettes by hour, faint markings, camera high and back, strong distance blur.

**Little things (all in the lab):** `js/world/birds.js` — flocks of Vs wheeling
at 40-80 m, one instanced draw, wings beating in the vertex shader, they follow
the ground and hop back near the player. Forest trees sway in the vertex shader
from 1.5 m up, phased by position (`WorldBuilder.wind`). Chimneys smoke (the
nearest fourteen, via the existing Smoke system). `pieces.js dress()` — every
house/building gets a door, step, path, porch light, drainpipes, chimney or
rooftop units + parapet + antenna/water tank, awnings, AC units, and seeded yard
and street clutter: bushes, a tree, a picket fence, mailbox, bin, parked car,
window boxes, bench, planters. LOW gets the cheap half (`dense = Q.pbr`).
Terrain has patchwork fields (`cField`).


Adam's brief (2026-08-29): *"mariokart graphics, fully debugging all terrain
clipping, adding textures, optimization, good shaders, and make it all look
nice, not uncanny, and perhaps realistic if its possible"*.

Reading of "Mario Kart": **stylised realism**. The LIGHT is real — a warm sun, a
blue sky fill, soft shadows, bloom on what's bright, a proper tone map — and the
SURFACES are clean: painted, not scanned, saturated but calm, the big shapes
only. That combination is what reads as "nice" instead of "uncanny": photo noise
on toy geometry was the uncanny part.

## Keys and switches

- `1` KART (default) · `2` RALLY · `3` REAL · `4` FLAT · `5` distance blur on/off
- `` ` `` the lab panel: speed feel, blur knobs, and THE FRAME (bloom, grade, vignette)
- URL: `?look=kart|real|rally|flat`, `?post=0` (direct render, no post at all — for A/B),
  `?quality=low|med|high`, `?hour=23`, any knob by name (`?bloom=0.5&vignette=0`)
- Debug for a black frame: `?msaa=0`, `?hdr=0`, `?mips=0`

## What was built

| where | what |
|---|---|
| `js/look/post.js` | The frame, finished: scene → half-float target (4× MSAA at MED/HIGH) → ONE pass: distance blur + bloom + ACES + grade + vignette + sRGB. Replaces `dof.js`. LOW = one pass, no MSAA, no bloom, no blur. |
| `js/look/materials.js` `roadSurface()` | One material for the whole road mesh. Reads `aRoad = (lat, along, halfWidth, kind)` per vertex and draws asphalt / gravel / sand / planks / kerb / concrete / **the terrain's own ground** on the shoulders. Lane markings are drawn in the fragment from lat/along (edge lines, dashed centre, double yellow + lane dashes on 4-lane roads) — no geometry, no z-fighting. |
| `js/look/materials.js` `paint()` | KART's textures: every scan is downsampled, blurred and saturated at load; normal maps halved toward flat. Decided from the look at start-up. |
| `js/look/looks.js` | KART look + `KART_SKIES` palette (day/sunset/dawn/night), per-look post settings, `PALETTES`. |
| `js/world.js` `makeSky` | Gradient + horizon haze in the fog colour + sun disc + drifting value-noise clouds (`clouds` per palette row, `tickSky`). |
| `js/world/water.js` | Shore-aware water: land height baked into a texture over the world → turquoise shallows, deep blue, foam at the shore, ripples → normal, fresnel sky, sun glint. Tinted by the sky palette each frame. |
| `js/world/build.js` | Roads emit `aRoad`; quads now wound so normals point up/out (FrontSide). Trees are multi-part merged geometry (3-tier pines, clustered broadleaf, shaded toward the foot). Piers have per-face vertices. Cover band sits 0.4 m under the mesh. Grass tones brightened. |
| `js/world/pieces.js` | Terrain clipping: a piece sits on the HIGHEST corner of its footprint and a foundation box fills down to the lowest; tree trunks and lamp poles start below ground. |
| `js/world/chunks.js` | City material is MeshStandard at MED/HIGH (Lambert at LOW). |
| `js/main.js` | `Post` in place of `DistanceBlur`; palettes generic; key 5 = blur; `setStylize` before the first material; water tint; glare follows the look's exposure. |
| `tools/spots.mjs` | Prints camera spots on real roads for screenshot batches. `QUICK=1 node tools/shot.mjs …` skips the draw-call breakdown. |

## Two real bugs found on the way

1. Three.js skips tone mapping when rendering into a render target — so with the
   distance blur on, HIGH was never tone-mapped while LOW was. The post pass now
   tone-maps once, for every level.
2. The road shader decoded sRGB *after* multiplying by a (linear) tint colour, so
   the tint was gamma'd twice and the asphalt was ~0.02 — the black roads in every
   HIGH screenshot. Decode first, then a linear gain.

## Not done / next

- Tunnels for the T marks, weather zones, sound — separate tracks.
- Real Chromebook numbers for LOW (the phase-0 gate) still need Adam's machine.
- Night: the four hopping point lights + glow layer are as they were; the KART
  night palette is brighter than REAL's. Headlights as projected cookies would
  be the next step for night.

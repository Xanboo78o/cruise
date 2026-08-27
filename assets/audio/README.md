# Sound

Empty on purpose. The game checks for these files on load and wires up whatever
it finds — with none of them it just runs silent, no errors.

| file | what it should be |
|---|---|
| `engine-loop.ogg` | a seamless engine loop, steady mid revs. Pitch is shifted by rpm in game, so one clean loop covers the whole range. |
| `tire-squeal.ogg` | a seamless tyre scrub/squeal loop. Faded in by how hard the rears are sliding. |
| `wind-loop.ogg` | seamless wind/road noise. Faded in by speed. |
| `gravel-loop.ogg` | seamless gravel/dirt rumble. Plays when you're off the tarmac. |

`.wav` and `.mp3` also work — the loader tries `.ogg`, `.wav`, `.mp3` in that order.

**Where to get them (CC0, no attribution needed):**
- kenney.nl/assets — "Engine Sounds" and the impact/UI packs
- freesound.org, filtered to Creative Commons 0

I can't hear audio, so I can't tell you which of them sounds right — grab a few
candidates, drop one in, drive, swap it if it's wrong. That's the whole workflow.

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

## Music

The radio is a different story: it needs no files at all. Every song is
synthesised live by `js/music.js` from the charts in `js/songs.js` (three
stations: GROUP B, ROCKERS, JUMVAS). Audition, export a WAV, or run the numbers
on `radio.html`; `node tools/musiccheck.mjs all --wav` does the same headlessly.

Cover art goes in `assets/music/covers/<station>/<songId>.png` (square, 512 px
is plenty) — the NOW PLAYING card and the radio page pick it up automatically.

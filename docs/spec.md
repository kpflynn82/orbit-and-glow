<!-- Copied from gamecrafter/prototype-specs/orbit-and-glow.md at commit cb31d62 on 2026-10-16. The gamecrafter copy is the source of truth; update this copy when it changes. -->

# Orbit & Glow — original game spec + Codex art brief

*Stage 4 of the gamecrafter method — the deliverable. An original game built on lessons from
Jelly Busters and its genre, not on their assets. Working title. October 15, 2026.*

**Read with:** `design-docs/gdd-orbit-and-glow.md` (full rules, economy, screens, KPIs) and
`improvements/orbit-and-glow.md` (why each fair choice was made, and what it costs).
**Open calls for Kevin:** the ten decisions in GDD §16 (theme, twist, timing, name, look and more)
plus the repo choice in §4 below — each has a default, so work can start without blocking on them.

---

## 1. The game

**One line:** *Send comets around the night sky, fuse leftovers into new colors, and turn every
picture you clear into a constellation you keep.*

**The fantasy.** You keep a small observatory on a hill. Each night the wind carries a picture of
colored stardust across the sky — a lantern, a whale, a teapot. Your Glimmers (little comet
sprites) sweep it clean, and every speck they clear becomes a star. When the picture is gone, its
stars join up and rise into your sky. Over weeks, your sky fills with everything you've solved.

**How it plays** (detail in GDD §3):
1. Tap the front Glimmer of a launch rail. It circles the oval orbit once and sweeps every dust
   cell of its color it can see. Results depend on the order you launch, never on how fast you tap.
2. Leftovers park in the Crescent Dock (4 slots). Drag two primaries together to **fuse** them into
   a secondary color with their charges added.
3. Clear the dust to win. Get stuck and retry is free and instant; one "Keep Going" per attempt
   (an ad or earned stardust, never real money).

**What makes it its own game:** fusion (leftovers become fuel), the Night Atlas (keep and replay
everything), its look and layout (§2), and a fair money layer (no lives, no forced ads, nothing
sold for money at the moment of loss).

## 2. Originality check (docs/boundaries.md)

We take the **genre mechanics** — shooters on a loop, front-of-lane only, a limited holding row,
determined boards. These are functional ideas, not property. Everything a player *sees, hears or
reads* is ours — including the screen layout, since look and feel is where the legal line sits
(*Tetris v. Xio*).

| Element | Jelly Busters `[OBSERVED]` | Pixel Flow! `[BENCHMARK]` | Orbit & Glow |
|---|---|---|---|
| Setting | Skatepark wrapper | Plain board | Hilltop observatory at night |
| Shooters | Cube jellies with ear-like corners and faces | Cartoon characters and animals | Glimmers — round comet sprites with light tails |
| Target | Cubes forming pictures (incl. a famous painting, a landmark) | Pixel blocks forming pictures | Stardust that turns into stars |
| Track | Wood-rimmed rectangular conveyor | Conveyor | Oval orbit of light |
| Waiting shooters | Straight columns | Straight columns | Curved launch rails |
| Holding row | 5 slots in a straight row | Bench + tray | 4-slot **crescent** Dock with **fusion** |
| Timing | Several on the belt at once, so timing can matter | Matters (timed chains) | Never matters (order-only) |
| After a clear | Picture destroyed | Picture cleared | Picture becomes a kept constellation |
| Look | Soft 3D, beige and daylight brights | Bright daylight | Painterly 2D with glow, deep indigo night |
| Meta | Level number | Level number | Night Atlas, Home Sky, cosmetics |
| Money | Lives, forced ads, 800-coin continue, pass on fail screen, loot boxes | Interstitials on fail, rewarded for lives, purchased continues, remove-ads | Rewarded-only ads, one fair continue, Supporter Pack, cosmetics |

**Rules for the build:**
- No pixel versions of famous paintings or national landmarks. Our pictures are original
  illustrations grouped by chapter theme.
- No cube characters, no ear corners, no skateboards, no wood-rimmed belts, no beige backgrounds.
- No names, UI copy or sounds from either game. "Play On", "Up Next" and "Jelly Pass" are theirs;
  ours are "Keep Going", "Next Glow" and "Sky Pass".
- Level layouts are generated and solved by our own tools from our own pictures.

**The test:** put our first store screenshot next to theirs. If a stranger could think they're the
same game, it isn't done.

## 3. System combination (what ships, what the prototype tests)

| System | Source of the idea | Prototype? |
|---|---|---|
| Orbit, rails, Dock, determined order-only boards | Genre core (keep), timing rule ours | **M1** |
| Fusion | Ours (I-6) | **M2** |
| Elements: Twin, Veiled, Asteroid, Shadow, Comet Gate | Ours, one at a time (learn: steady introduction) | M2 (Twin, Veiled); later |
| Tools: Supernova, Tractor Beam, Extra Dock, Prism | Genre-standard idea, our set; Prism is fusion-specific | M3 |
| Hint / Guide | Ours (I-3) | M2 |
| Night Atlas + Home Sky + replay | Ours (I-5) | **M3** |
| "Next Glow" unlock bar | Learn (endowed progress) | M3 |
| Daily Sky + share card | Ours (I-8) | M4 |
| Glow Streak (mercy) | Learn, made fair (I-7) | M4 |
| Color-blind glyphs | Ours (I-15) | M1 (glyphs on gray boxes) |
| Rewarded ads, IAP, Sky Pass | GDD §10 | Ship only — the prototype fakes the buttons |

## 4. Prototype build plan (web first)

Claude builds the mechanics and code; Codex builds the art; they meet in the repo. Playable in a
phone browser from milestone 1.

| Milestone | What's in it | Done when |
|---|---|---|
| **M1 — Gray box** | Orbit, rails, Dock, order-only resolution, win/stuck (both kinds), free retry, glyphs; 20 hand-made levels using plain colored shapes; the level solver | Kevin plays 20 levels on his phone; the solver agrees with every win and every stuck; the solver finishes on a 16×16 board in seconds |
| **M2 — The twist** | Fusion, Twin and Veiled comets, Hint/Guide; picture-to-level script; 40 levels using Codex's first pictures | Kevin can say whether fusion is fun (the biggest open question) |
| **M3 — The keep** | Home Sky, Night Atlas, replay, tools, Next Glow bar; first-session script (GDD §4) | A new player reaches the first page completion in ~12 minutes |
| **M4 — The feel** | Codex art and animation, chimes and haptics, Daily Sky, Glow Streak | Kevin's feel tuning done on device (GDD §16 #8) |
| **M5 — Test build** | Local analytics log (GDD §13 events), 100 levels | A 10–20 person friends-and-family test of feel and understanding (does fusion click? where do people get stuck?). Retention needs a real soft launch |

**Repo** `[KEVIN CALL]`:
- **A new private repo, `kpflynn82/orbit-and-glow`** (default) — the same setup as `dragongo`, your
  existing prototype repo for the dice-board game: code and art live together, Codex and Claude
  both work in it, and gamecrafter stays design-only.
- **A `prototypes/orbit-and-glow/` folder inside gamecrafter** — one place for everything, but it
  mixes running code into the design repo.

### Level data (one file per level)

Plain JSON (a simple text format) so the game, the solver and the picture script all read the same
thing:

```json
{
  "id": "example-6x6",
  "badge": "normal",
  "canvas": ["..RR..", ".RPPR.", "RPYYPR", "RPYYPR", ".RPPR.", "..RR.."],
  "rails": [
    [{"color": "R", "charge": 9}, {"color": "B", "charge": 4}],
    [{"color": "Y", "charge": 4}, {"color": "R", "charge": 7}]
  ],
  "dock": 4,
  "ring": 4,
  "solver": {"winnable_no_tools": true, "winning_orders": 12, "peak_dock": 3}
}
```

Each `canvas` row is one row of the picture; each letter is a color (R red, Y yellow, B blue,
O orange, G green, P purple, W white, S slate) and "." is empty sky. `rails` are the launch rails,
front comet first. The example shows the format only — its numbers have not been through the solver.

### The solver, in plain words

A small program that plays a level many ways (launch orders and fusions) and reports: can it be won
with no tools, roughly how many different ways win, and how full the Dock gets on the best path.
It is how pillar 1 ("the board never lies") is enforced, and how difficulty is set by numbers
rather than by guessing. Levels it can't win never ship. **Risk:** on large boards, trying every
order can take too long; then it searches until it finds one win (proof that the level is fair)
and *estimates* the number of winning orders. M1 has to prove this works before content is built
on it.

### Picture-to-level pipeline

1. Codex draws a picture at the exact grid size (e.g. 12×12), using only the 8 game colors.
2. A script turns it into the `canvas` rows.
3. A generator deals the dust colors into rails and charges; the solver scores it; the generator
   keeps the layout that hits the target difficulty for that level's badge.
4. A person plays every Tricky and Starfall level before it ships.

## 5. Codex art brief

**Style.** Painterly 2D with glow: hand-painted-looking shapes, soft gradients and bloom (light that
gently spills past the edges), no hard black outlines. Calm and a little magical, aimed at adults
who like cozy games — premium, not toddler-cute. Night scenes lit by the stars and by the Glimmers
themselves. (If Kevin picks the soft-3D option in GDD §16 #6, keep everything below except this
paragraph.)

**Screen layout to draw toward** (portrait phone): the square canvas in the upper half inside an
**oval** orbit of light; the **crescent** Dock curving beneath it; 2–5 **curved launch rails**
fanning up from the observatory dome at the bottom edge. Not a rectangle, not straight rows.

**Palette**

| Role | Hex |
|---|---|
| Sky (top / bottom gradient) | `#0B1026` → `#1E2A5E` |
| Orbit ring | `#A9B8FF` (cool silver-blue glow — kept far from Yellow) |
| Dock | `#2A3570` with `#A9B8FF` rim |
| Red / Yellow / Blue (primaries) | `#FF5A5F` / `#FFD23F` / `#3D8BFF` |
| Orange / Green / Purple (secondaries) | `#FF9F1C` / `#3DDC97` / `#A06CFF` |
| White / Slate (neutrals) | `#D9DDF0` / `#7D8BB0` |
| Star (cleared cell) | `#FFFFFF` core with a pale-cyan halo `#9EE7FF`, drawn smaller than a cell so the dark sky shows around it |

White dust is a full, fuzzy cell; a star is a small, sharp, twinkling point — size and shape keep
them apart, not just color.

**Color-blind glyphs (required):** every color carries a glyph on its Glimmer and a faint pattern on
its dust — Red ●, Yellow ▲, Blue ■, White ◆, Slate ✚. Secondaries show both parent glyphs
(Orange = ● + ▲, Green = ▲ + ■, Purple = ● + ■). This also teaches fusion visually.

**Assets** (PNG with a transparent background, each at two sharpness levels for different phone
screens — "@2x" and "@3x" — unless noted)

| Asset | Count | Notes |
|---|---|---|
| Glimmer sprite | 8 colors | Round body ~1 cell wide, light tail, simple face (2 eyes, small mouth), glyph on the body; idle bob, launch stretch, burst |
| Fusion effect | 1 sheet | Two Glimmers spiral and bloom into one; ~12 frames |
| Dust cell | 8 colors | Soft, fuzzy square with its glyph pattern; must read at a 24×24 grid on a phone |
| Star (cleared cell) | 1 + twinkle | Small 4-point star, 6-frame twinkle |
| Orbit ring | 1 | Oval glowing band, drawn so it stretches to fit any canvas size without distorting |
| Crescent Dock | 1 + 4 slot states | Empty, occupied, fusion-ready (two compatible comets glow), last-slot warning (amber pulse) |
| Launch rails | 1 | Curved rail segment that repeats |
| Home Sky | 1 scene | Hilltop observatory, telescope, lantern, open sky above for constellations |
| Constellation lines | 1 style | Thin silver lines joining stars; a soft illustration fades in behind |
| Badges | 2 | "Tricky" (silver crescent), "Starfall" (gold falling star) |
| Tool icons | 4 | Supernova, Tractor Beam, Extra Dock, Prism |
| App icon | 3 options | (a) a purple Glimmer mid-orbit; (b) two Glimmers fusing into one; (c) a constellation over the observatory dome — all on deep indigo |
| Level pictures | 40 for M2, 100 total by M5 | Chapter 1 "Lanterns & Lights" (lantern, candle, moon, firefly…), then "Sea Creatures"; exact grid sizes per the GDD §5 table; 8 colors only; 1 pixel = 1 cell. M1 needs none |

**Do not:** cube characters, ear-like corners, skateboards, wood-rimmed belts, beige backgrounds,
rectangular tracks, straight shooter columns, famous paintings or landmarks, any text baked into
images.

**Delivery.** Commit to `art/` in the prototype repo as `glimmer_red@2x.png`,
`picture_ch01_l06_12x12.png`, etc. Pictures as exact-size PNGs (no scaling) plus a large preview
for the Atlas.

## 6. Store page concept

- **Icon:** one of the three options above; default (b), because it shows the twist.
- **Screenshot 1:** mid-level, two Glimmers spiraling into one, a half-cleared lantern turning to
  stars. Caption: *Mix comets. Light the sky.*
- **Screenshot 2:** the Home Sky full of constellations. Caption: *Every picture you solve is yours
  to keep.*
- **Screenshot 3:** *No lives. No waiting. Just play.*
- **Video (first 3 seconds):** a fusion, then a lap that clears a whole color. The twist has to be
  readable without sound.

## 7. Next steps

1. **Kevin:** rule on GDD §16 and the repo choice — or accept the defaults.
2. **Firm up the analysis:** one GameTagger play session on Jelly Busters (guest, no spending,
   screen recording only) to measure ads per level, the lives timer, and the pass price.
3. **Build M1** in the prototype repo and play it on a phone.
4. **Codex:** the Glimmer sprite set and chapter 1 pictures, from this brief, ready for M2.

# Lessons

Every bug fixed and every correction from Kevin, one line each, newest at the bottom of each
section. Read this before starting work; the next prototype reads it before it starts.

## Rules and solver

- A win doesn't need every comet: a test that expected "unwinnable" was wrong because the level
  could be won with comets left over. Unwinnable test levels now use a Dock of 0.
- Solver crash ("illegal move dock slot 1"): remembered best moves stored a raw Dock slot number, but
  remembered positions are shared by boards whose Dock holds the same comets in different slots.
  Fix: remember Dock moves by the comet ("R5") and turn them back into a slot per board.
- With charges that add up exactly to the dust (as the M1 generator deals them), the "dead end"
  kind of stuck can't happen: no charge is ever wasted. Only "Dock full" ends M1 levels. Dead end
  matters from M2, when fusion turns red charge into purple.
- Counting every winning order runs out of memory on 16×16 boards with 10+ comets. Big boards now
  get one proven win (found in milliseconds by trying the most promising launches first) plus
  estimates from 10,000 random games, marked `exact: false` in the report.
- Reviewer: `applyMove` checked "Dock full" before "won", so clearing the last dust with charge left
  and a full Dock said Stuck. Fixed with fusion (Kevin approved the M2 plan): a win is checked first.
- Fusion: a comet that finds the Dock full now waits at the gate while a fusion could make room
  (only fusions are allowed until it parks); stuck only when no fusion can help. Dead ends count
  fusion fuel: purple dust can still be cleared while red and blue charge remain.

## Level design

- **Kevin's first playtest (Oct 16): "I could easily just tap the color needed."** He was right: a
  bot playing that way won every try on 17 of 20 levels, including a Starfall. The levels had been
  tuned with a bot that taps at random, and a random tapper loses a lot, so they looked hard. The
  ruler is now the "sensible player" (src/engine/players.ts); Tricky and Starfall must beat it.
- Small comet charges make levels easier, not harder: a comet that can spend all its charge in one
  lap never parks. Difficulty needs comets that can't (big charges, hidden colors), buried behind
  comets you can't use yet, plus a small Dock and, from level 6, fusion.
- The sensible player wins 100% of most random layouts, so the level search had nothing to climb.
  It now also scores a player who slips 25% of the time, accepts equal-score changes and restarts
  when stuck. Three pictures (Teapot, Lighthouse, Butterfly) were redrawn with outlines so order
  matters.
- A mixed color with a single speck can't be split between two parent comets; it keeps its own
  comet (bug that made level 16 unwinnable during the rebuild).
- Difficulty comes mostly from the picture, not the deal. Flat pictures (a solid heart, a solid
  fish) give levels a random tapper can't lose, whatever the Dock size. Colors hidden behind other
  colors (stripes, outlines, rings, spots) are what make order matter. Nine pictures were redrawn
  with layers for this reason; the rule is now in `art/README.md` for Codex.
- The GDD's default Dock of 4 is very forgiving with these rules. Most M1 levels use 3, hard ones 2.
  Dock size is the strongest difficulty dial after the picture. (For Kevin to judge on the phone.)
- Searching layouts with a full solve per try was slow (up to 7 minutes a level). The generator
  now checks each try with one proven win plus 1,500 random games, and fully solves only the pick.
- Reviewer: level 16 should be a breather after Tricky 15 but was the second-hardest normal level.
  Rebuilt it easier (random_win 0.76) before Kevin played it. The generator now refuses to
  overwrite an existing level file without FORCE=1 (it would no longer rebuild levels 5 and 10
  as shipped).

## Game screen

- Shots were timed by one clock and the comet's motion by another; at low frame rates they drifted
  and a shot could fire after the comet had already burst (crash). One tween now drives both.
- Restarting a level stopped every animation, including the background stars' twinkle. Now only
  the level's own animations are stopped.
- Gradient fills only work with WebGL; the sky is now painted once onto a canvas texture so it looks
  the same with either renderer.
- Reviewer: with several comets on the orbit at once, the picture could contradict the rules — a
  later comet firing through a block an earlier one hadn't cleared yet, or an earlier comet passing
  a newly uncovered cell of its color without firing. Results were right; the picture lied. Now one
  comet flies at a time, the others wait by the gate, and the lap speeds up while others wait.
- Reviewer: the comet that can't park hovered on top of the middle Dock slot; it now hovers just
  inside the gate. HUD buttons got tap areas of about 48 points (were about 32).
- A comet with no charge left kept flying an empty lap, which held up the comets waiting behind it.
  It now bursts right after its last hit. (A feel choice for Kevin to judge on the phone.)

## Testing and tooling

- Headless Chromium has no GPU, so WebGL ran at about 6 frames a second. The browser playtest adds
  `?canvas` to use the Canvas renderer (60 fps); real phones use WebGL as normal.
- The browser playtest first checked "did a tap launch a comet?" by counting comets in flight, which
  fails when another comet lands at the same moment. It now counts launches.
- Functions passed to Playwright's `page.evaluate` from files run by `tsx` can pick up a helper
  (`__name`) that doesn't exist in the page. Pass a string of code for anything with inner functions.
- `npm audit` flagged Vitest 3 and vite-plugin-singlefile (through dependencies). Moved to Vitest 5
  and replaced the plugin with a 30-line script (`tools/inline-build.mjs`). Audit is clean.
- Reviewer: the single-file build had no charset, so ≡ and ↻ turned into garbage when a host didn't
  declare UTF-8. The build now escapes every non-ASCII character and checks the file is pure ASCII.
- Reviewer: the bot's "silent doom" count included taps on docked comets that hit nothing. It now
  counts only launches that change the board.
- Reviewer: `npm run dev` didn't print a Network address for phones; it now runs with `--host`.
- `pkill -f <pattern>` also matches the shell running it when the pattern appears in the command;
  stop background jobs by process id instead.

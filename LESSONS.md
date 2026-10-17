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

## Level design

- Difficulty comes mostly from the picture, not the deal. Flat pictures (a solid heart, a solid
  fish) give levels a random tapper can't lose, whatever the Dock size. Colors hidden behind other
  colors (stripes, outlines, rings, spots) are what make order matter. Six pictures were redrawn
  with layers for this reason; the rule is now in `art/README.md` for Codex.
- The GDD's default Dock of 4 is very forgiving with these rules. Most M1 levels use 3, hard ones 2.
  Dock size is the strongest difficulty dial after the picture. (For Kevin to judge on the phone.)
- Searching layouts with a full solve per try was slow (up to 7 minutes a level). The generator
  now checks each try with one proven win plus 1,500 random games, and fully solves only the pick.

## Game screen

- Shots were timed by one clock and the comet's motion by another; at low frame rates they drifted
  and a shot could fire after the comet had already burst (crash). One tween now drives both.
- Restarting a level stopped every animation, including the background stars' twinkle. Now only
  the level's own animations are stopped.
- Gradient fills only work with WebGL; the sky is now painted once onto a canvas texture so it looks
  the same with either renderer.

## Testing and tooling

- Headless Chromium has no GPU, so WebGL ran at about 6 frames a second. The browser playtest adds
  `?canvas` to use the Canvas renderer (60 fps); real phones use WebGL as normal.
- The browser playtest first checked "did a tap launch a comet?" by counting comets in flight, which
  fails when another comet lands at the same moment. It now counts launches.
- Functions passed to Playwright's `page.evaluate` from files run by `tsx` can pick up a helper
  (`__name`) that doesn't exist in the page. Pass a string of code for anything with inner functions.
- `npm audit` flagged Vitest 3 and vite-plugin-singlefile (through dependencies). Moved to Vitest 5
  and replaced the plugin with a 30-line script (`tools/inline-build.mjs`). Audit is clean.

# Orbit & Glow — rules for Claude

A color-sort puzzle prototype from gamecrafter. Web first (TypeScript + Phaser), playable on a
phone from a link. Kevin is the designer and judge; he isn't a programmer, so reports are in plain
words. Read `docs/brief.md` (one page), then `LESSONS.md`, before any change. `docs/spec.md` holds
the rules and the art brief (a copy of `prototype-specs/orbit-and-glow.md` in gamecrafter, which is
the source of truth); the full GDD lives there too (`design-docs/gdd-orbit-and-glow.md`).

## Pillars (from the GDD — every change must keep these true)

1. **The board never lies.** Same board every attempt. The result depends only on the order of
   launches and fusions, never on tap speed. Every shipped level is solver-checked as
   winnable without tools.
2. **Leftovers are fuel, not trash.** The Dock is a workbench (fusion, from level 6).
3. **Everything you solve, you keep.** (Night Atlas, M3.)
4. **Play is never blocked, and loss is never for sale.** Retry is free and instant, always.

## Anti-pillars — this game will not

- have lives, energy or any wait to play;
- show forced (interstitial) ads;
- quietly make a level easier after losses, or harder to sell tools;
- raise the continue price within an attempt, or link to the shop from the stuck screen;
- sell random-content packs;
- punish stepping away.

## Never change without Kevin saying so

- The rules in `src/engine/` (lap order, first-cell-only, parking, fusion, the comet waiting to park,
  both stuck kinds). A rules change means re-solving every level (`npm run solve`) and updating the
  tests in the same commit.
- How difficulty is judged: the "sensible player" in `src/engine/players.ts` (Kevin's playtest showed
  a random-tapping ruler lies). Tricky and Starfall must beat it (tests enforce this).
- Shipped level files `levels/level-*.json` once Kevin has played them — add new levels instead.
- Results never depend on timing. Animation replays a result that is already decided at launch.
- Our own expression only: no names, UI words, sounds, characters or layouts from Jelly Busters,
  Pixel Flow! or any other game (see `docs/spec.md` §2). Pictures are our own illustrations.
- No secrets (API keys, tokens) in the repo or in logs.

## How it fits together

| Folder | What's in it |
|---|---|
| `src/engine/` | The rules (`engine.ts`), the solver (`solver.ts`) and the player models used as difficulty rulers (`players.ts`). Plain TypeScript, no Phaser, so tests, tools and the bot run the exact same rules as the game |
| `src/game/` | The Phaser screen: drawing, animation, HUD, overlays. Never decides an outcome |
| `levels/` | One JSON file per level, each with its solver report |
| `tools/` | `pictures.ts` (gray-box pictures), `generate-levels.ts`, `solve-all.ts`, `bench-16.ts`, `inline-build.mjs` |
| `playtest/` | `bot.ts` (headless rules check + random games), `screens.ts` (plays in a real browser, saves screenshots) |
| `tests/` | Rules tests and level checks (Vitest) |
| `art/` | Codex deliveries (from M2) |

## Commands

```
npm install           once
npm run dev           play locally; a phone on the same Wi-Fi can open the printed Network address
                      (add ?canvas to force the Canvas renderer)
npm test              rules + level tests
npm run solve         re-solve every level and compare with its saved report (WRITE=1 to refresh)
npm run bot           headless bot: solver paths + random games, writes playtest/bot-report.json
npm run build         type-check and build dist/ (what Vercel serves)
npm run screens       after a build: plays every level in a phone-sized browser, saves screenshots
npm run build:single  one self-contained HTML file in dist-single/ (for a shareable phone link)
npm run levels        build any missing level files (ONLY=7 for one level; FORCE=1 to rebuild an
                      existing one — never for a level Kevin has played)
npm run bench         times the solver on three 16x16 boards (the M1 "in seconds" check)
```

## Done means (every change)

- [ ] `npm test` passes.
- [ ] `npm run solve` reports every level matches (or the change re-solved them on purpose).
- [ ] `npm run bot` reports no rules errors.
- [ ] `npm run build` then `npm run screens` passes, and the screenshots were looked at.
- [ ] A line in `LESSONS.md` for every bug fixed or correction from Kevin.
- [ ] A short plain-words report: what changed, what couldn't be done, what Kevin should try.
- [ ] If something can't be done as specified, stop and say so. No silent workarounds.

## Working habits (docs/BUILD_PLAYBOOK.md in gamecrafter)

One system per prompt. Commit before each session. A separate reviewer checks the done-lines; the
builder never approves its own work. Two failed fixes in a row → roll back to the last tag.

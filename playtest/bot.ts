// Headless playtest bot (spec §4, playbook "the bot plays before Kevin does").
//
// For every level it:
//   1. replays the solver's winning path through the real rules engine (must win);
//   2. plays many random games, checking at every step that
//      - "won" appears exactly when the last dust is cleared,
//      - "stuck" never appears with no dust left,
//      - a game never goes on with no progress possible (a lost level must say "Stuck"), and
//      - counting the "silent doom" moves: launches a player made after the level was already
//        lost but before the game said "Stuck" (relaunching a docked comet that hits nothing
//        doesn't count — it changes nothing). These aren't bugs, but a high number means
//        players will feel cheated, so it's a design signal for Kevin.
//
// "sensible-player win" = the main difficulty ruler: a player who launches whatever can hit right
// now, avoids parking and never plans ahead (src/engine/players.ts).
// "random-tapper win" here = picking uniformly among every tappable comet. The solver's
// random_win picks among its distinct useful moves (two identical docked comets count once,
// a docked comet that would hit nothing is skipped), so the two differ by a few points.
//
// Usage: npm run bot            (all levels, 1500 random games each)
//        GAMES=200 npm run bot  (quicker)

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { applyMove, createState, legalMoves } from '../src/engine/engine';
import { Solver, TooManyStates } from '../src/engine/solver';
import { sensibleWinRate } from '../src/engine/players';
import type { GameState, LevelData } from '../src/engine/types';

const GAMES = Number(process.env.GAMES ?? 1500);
const MAX_MOVES = 400;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hasDust = (s: GameState) => s.cells.some((c) => c !== null);

interface Row {
  n: number;
  name: string;
  badge: string;
  pathWins: boolean;
  randomWin: number;
  solverRandomWin: number;
  sensibleWin: number; // the "tap what you can hit" player (src/engine/players.ts)
  stuckDockFull: number;
  stuckDeadEnd: number;
  doomedGames: number; // games that became unwinnable at some point
  silentDoomAvg: number; // average moves made after doom, before "Stuck", in doomed games
  silentDoomMax: number;
  errors: string[];
}

const files = readdirSync('levels').filter((f) => /^level-\d\d\.json$/.test(f)).sort();
const rows: Row[] = [];
let failures = 0;

for (const [i, f] of files.entries()) {
  const lv: LevelData = JSON.parse(readFileSync(`levels/${f}`, 'utf8'));
  // Doom tracking needs the full solve; on boards too big to count it's skipped (reported as n/a).
  const solver = new Solver(400_000);
  let doomCheck = true;
  const lost = (st: GameState): boolean => {
    if (!doomCheck) return false;
    try {
      return solver.node(st).ways === 0;
    } catch (e) {
      if (e instanceof TooManyStates) { doomCheck = false; return false; }
      throw e;
    }
  };
  const errors: string[] = [];

  // 1. The solver's path wins in the engine.
  let s = createState(lv);
  for (const m of lv.solver?.path ?? []) s = applyMove(s, m).state;
  const pathWins = s.status === 'won';
  if (!pathWins) errors.push('solver path does not win');

  // 2. Random games.
  const rand = mulberry32(1000 + i);
  let wins = 0;
  let dockFull = 0;
  let deadEnd = 0;
  let doomed = 0;
  let silentSum = 0;
  let silentMax = 0;
  for (let g = 0; g < GAMES; g++) {
    let st = createState(lv);
    let doomAt = -1; // count of real launches when the level became unwinnable
    let moves = 0; // every tap
    let real = 0; // taps that changed the board
    let lastReal = 0; // tap number of the last one that changed the board
    while (st.status === 'playing' && moves < MAX_MOVES) {
      if (doomAt < 0 && lost(st)) doomAt = real;
      const legal = legalMoves(st);
      if (legal.length === 0) {
        errors.push(`game ${g}: no legal moves but status is "playing"`);
        break;
      }
      const m = legal[Math.floor(rand() * legal.length)];
      const { state: next, result } = applyMove(st, m);
      st = next;
      moves++;
      if (!(m.kind === 'dock' && result.shots.length === 0)) { real++; lastReal = moves; }
      if (st.status === 'won' && hasDust(st)) errors.push(`game ${g}: "won" with dust left`);
      if (st.status === 'playing' && !hasDust(st)) errors.push(`game ${g}: no dust left but not "won"`);
      if (st.status === 'stuck' && !hasDust(st)) errors.push(`game ${g}: "stuck" with no dust left`);
    }
    if (moves >= MAX_MOVES) {
      // 400 taps without an end: if nothing changed the board for the last stretch, the level was
      // lost but never said "Stuck" — a rules bug (the reviewer caught exactly this on Oct 17).
      if (moves - lastReal > 60) errors.push(`game ${g}: no progress possible but not "Stuck"`);
      continue;
    }
    if (st.status === 'won') {
      wins++;
      if (doomAt >= 0 && doomCheck) errors.push(`game ${g}: won after the solver said it was lost`);
    } else {
      if (st.stuckReason === 'dock-full') dockFull++;
      else deadEnd++;
      if (doomAt < 0) doomAt = real; // doomed by the very last move
      doomed++;
      const silent = real - doomAt - 1; // launches after doom, not counting the one that showed "Stuck"
      silentSum += Math.max(0, silent);
      silentMax = Math.max(silentMax, silent);
    }
  }

  const row: Row = {
    n: i + 1,
    name: lv.name,
    badge: lv.badge,
    pathWins,
    randomWin: wins / GAMES,
    solverRandomWin: lv.solver?.random_win ?? NaN,
    sensibleWin: sensibleWinRate(lv, 400),
    stuckDockFull: dockFull,
    stuckDeadEnd: deadEnd,
    doomedGames: doomed,
    silentDoomAvg: doomCheck ? (doomed ? silentSum / doomed : 0) : -1, // -1 = not checked (board too big)
    silentDoomMax: silentMax,
    errors: [...new Set(errors)].slice(0, 5),
  };
  if (row.errors.length) failures++;
  rows.push(row);
  console.log(
    `${String(row.n).padStart(2)} ${row.name.padEnd(11)} ${row.badge.padEnd(8)} path=${pathWins ? 'WIN ' : 'FAIL'} ` +
      `sensible-player win=${(row.sensibleWin * 100).toFixed(0).padStart(3)}%  ` +
      `random-tapper win=${(row.randomWin * 100).toFixed(1).padStart(5)}% (solver random_win ${(row.solverRandomWin * 100).toFixed(1)}%) ` +
      `stuck: dock-full ${dockFull}, dead-end ${deadEnd}; ` +
      (doomCheck ? `silent-doom avg ${row.silentDoomAvg.toFixed(2)} max ${silentMax}` : 'silent-doom n/a (board too big to check)') +
      (row.errors.length ? `  ERRORS: ${row.errors.join('; ')}` : ''),
  );
}

writeFileSync('playtest/bot-report.json', JSON.stringify({ games_per_level: GAMES, levels: rows }, null, 2) + '\n');
console.log(`\n${files.length} levels, ${GAMES} random games each. ${failures ? `${failures} level(s) with errors.` : 'No rules errors.'}`);
console.log('Report written to playtest/bot-report.json');
if (failures) process.exit(1);

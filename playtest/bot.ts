// Headless playtest bot (spec §4, playbook "the bot plays before Kevin does").
//
// For every level it:
//   1. replays the solver's winning path through the real rules engine (must win);
//   2. plays many random games, checking at every step that
//      - "won" appears exactly when the last dust is cleared,
//      - every "stuck" the game reports really is unwinnable (it always should be), and
//      - counting the "silent doom" moves: moves a player made after the level was already
//        lost but before the game said "Stuck". These aren't bugs, but a high number means
//        players will feel cheated, so it's a design signal for Kevin.
//
// Usage: npm run bot            (all levels, 1500 random games each)
//        GAMES=200 npm run bot  (quicker)

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { applyMove, createState, legalMoves } from '../src/engine/engine';
import { Solver } from '../src/engine/solver';
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
  const solver = new Solver();
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
    let doomAt = -1;
    let moves = 0;
    while (st.status === 'playing' && moves < MAX_MOVES) {
      if (doomAt < 0 && solver.node(st).ways === 0) doomAt = moves;
      const legal = legalMoves(st);
      if (legal.length === 0) {
        errors.push(`game ${g}: no legal moves but status is "playing"`);
        break;
      }
      st = applyMove(st, legal[Math.floor(rand() * legal.length)]).state;
      moves++;
      if (st.status === 'won' && hasDust(st)) errors.push(`game ${g}: "won" with dust left`);
      if (st.status === 'playing' && !hasDust(st)) errors.push(`game ${g}: no dust left but not "won"`);
    }
    if (moves >= MAX_MOVES) {
      // Only possible by relaunching docked comets that hit nothing; not a rules bug.
      continue;
    }
    if (st.status === 'won') {
      wins++;
      if (doomAt >= 0) errors.push(`game ${g}: won after the solver said it was lost`);
    } else {
      if (st.stuckReason === 'dock-full') dockFull++;
      else deadEnd++;
      if (doomAt < 0) doomAt = moves; // doomed by the very last move
      doomed++;
      const silent = moves - doomAt - 1; // moves made after doom, not counting the one that showed "Stuck"
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
    stuckDockFull: dockFull,
    stuckDeadEnd: deadEnd,
    doomedGames: doomed,
    silentDoomAvg: doomed ? silentSum / doomed : 0,
    silentDoomMax: silentMax,
    errors: [...new Set(errors)].slice(0, 5),
  };
  if (row.errors.length) failures++;
  rows.push(row);
  console.log(
    `${String(row.n).padStart(2)} ${row.name.padEnd(11)} ${row.badge.padEnd(8)} path=${pathWins ? 'WIN ' : 'FAIL'} ` +
      `random-win=${(row.randomWin * 100).toFixed(1).padStart(5)}% (solver est ${(row.solverRandomWin * 100).toFixed(1)}%) ` +
      `stuck: dock-full ${dockFull}, dead-end ${deadEnd}; silent-doom avg ${row.silentDoomAvg.toFixed(2)} max ${silentMax}` +
      (row.errors.length ? `  ERRORS: ${row.errors.join('; ')}` : ''),
  );
}

writeFileSync('playtest/bot-report.json', JSON.stringify({ games_per_level: GAMES, levels: rows }, null, 2) + '\n');
console.log(`\n${files.length} levels, ${GAMES} random games each. ${failures ? `${failures} level(s) with errors.` : 'No rules errors.'}`);
console.log('Report written to playtest/bot-report.json');
if (failures) process.exit(1);

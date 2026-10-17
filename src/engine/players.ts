// Player models used as difficulty rulers (and, later, for hints).
//
// The "sensible player" plays the way a person does on a first look, one move at a time with no
// planning ahead: launch a comet whose color can be hit right now, preferring one that will use
// up all its charge (so nothing has to park); fuse two docked comets when the new color can be hit
// right now; only launch a comet that hits nothing when there's nothing better to do. Kevin's first
// playtest showed this simple strategy won almost every M1 level, so the level generator now uses
// it as the ruler: Tricky and Starfall levels must beat it, and only early levels may let it win
// every time.

import { applyMove, dustCounts, firstCellAlong, lapSteps, legalMoves } from './engine';
import type { Color, GameState, LevelData, Move } from './types';
import { createState } from './engine';

/** Colors of the cells a comet could hit right now (the first cell along some row or column). */
export function visibleColors(s: GameState): Set<Color> {
  const out = new Set<Color>();
  for (const step of lapSteps(s.w, s.h)) {
    const cell = firstCellAlong(s, step);
    if (cell) out.add(s.cells[cell.y * s.w + cell.x]!);
  }
  return out;
}

function score(s: GameState, m: Move, visible: Set<Color>, dust: Map<Color, number>): number {
  const { state, result } = applyMove(s, m);
  if (state.status === 'won') return 1e6;
  if (state.status === 'stuck') return -1e6;
  if (result.type === 'fuse') {
    const c = result.comet.color;
    if (visible.has(c)) return 900;
    if ((dust.get(c) ?? 0) > 0) return 200;
    return -400;
  }
  if (result.shots.length > 0) return 1000 + (result.leftover === 0 ? 100 : 0) + result.shots.length - (result.held ? 300 : 0);
  if (m.kind === 'dock') return -500; // relaunching a comet that hits nothing does nothing
  return result.held ? -300 : 0; // dig: send a comet that can't hit anything yet
}

/** The sensible player's next move (ties broken at random). */
export function sensibleMove(s: GameState, rand: () => number): Move {
  const visible = visibleColors(s);
  const dust = dustCounts(s);
  let best = -Infinity;
  let pool: Move[] = [];
  for (const m of legalMoves(s)) {
    const v = score(s, m, visible, dust);
    if (v > best) { best = v; pool = [m]; } else if (v === best) pool.push(m);
  }
  return pool[Math.floor(rand() * pool.length)];
}

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

/**
 * Share of games the sensible player wins (ties broken at random), e.g. 0.35. With `slip` > 0 the
 * player makes a random move that often instead (the level generator uses a slipping player to
 * tell apart layouts the sensible player always wins: the ones that punish a slip are closer to a
 * real puzzle).
 */
export function sensibleWinRate(level: LevelData, games = 200, seed = 3, slip = 0): number {
  const rand = mulberry32(seed);
  let wins = 0;
  for (let g = 0; g < games; g++) {
    let s = createState(level);
    for (let n = 0; s.status === 'playing' && n < 300; n++) {
      let m: Move;
      if (slip > 0 && rand() < slip) {
        const legal = legalMoves(s);
        m = legal[Math.floor(rand() * legal.length)];
      } else m = sensibleMove(s, rand);
      s = applyMove(s, m).state;
    }
    if (s.status === 'won') wins++;
  }
  return wins / games;
}

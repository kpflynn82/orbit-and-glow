// The big-board solver path: find one win, estimate the rest.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMove, createState } from '../src/engine/engine';
import { analyzeLevel, findWin, sampleLevel, solveLevel } from '../src/engine/solver';
import type { Comet, LevelData } from '../src/engine/types';

const C = (color: Comet['color'], charge: number): Comet => ({ color, charge });
const level = (canvas: string[], rails: Comet[][], dock = 4): LevelData => ({ id: 't', name: 't', badge: 'normal', canvas, rails, dock, ring: 4 });

function replayWins(lv: LevelData, path: ReturnType<typeof findWin>): boolean {
  let s = createState(lv);
  for (const m of path ?? []) s = applyMove(s, m).state;
  return s.status === 'won';
}

describe('findWin', () => {
  it('finds a winning order that really wins', () => {
    const lv = level(['RRR', 'RBR', 'RRR'], [[C('B', 1), C('R', 8)]]);
    const path = findWin(createState(lv));
    expect(path).not.toBeNull();
    expect(replayWins(lv, path)).toBe(true);
  });

  it('returns null when no order wins', () => {
    // The blue comet must park first, and there is no Dock.
    const lv = level(['RRR', 'RBR', 'RRR'], [[C('B', 1), C('R', 8)]], 0);
    expect(findWin(createState(lv))).toBeNull();
    expect(solveLevel(lv).winnable_no_tools).toBe(false);
  });
});

describe('analyzeLevel', () => {
  it('gives the exact answer on small boards', () => {
    const lv: LevelData = JSON.parse(readFileSync('levels/level-05.json', 'utf8'));
    const exact = solveLevel(lv);
    const r = analyzeLevel(lv);
    expect(r.exact).toBe(true);
    expect(r.winning_orders).toBe(exact.winning_orders);
    expect(r.random_win).toBe(exact.random_win);
  });

  it('random-game estimates land near the exact random_win', () => {
    const lv: LevelData = JSON.parse(readFileSync('levels/level-05.json', 'utf8'));
    const exact = solveLevel(lv).random_win;
    const est = sampleLevel(createState(lv), 10_000).randomWin;
    expect(Math.abs(est - exact)).toBeLessThan(0.03);
  });

  it('falls back to a proven win plus estimates when the board is too big to count', () => {
    const lv: LevelData = JSON.parse(readFileSync('levels/level-10.json', 'utf8'));
    const r = analyzeLevel(lv, 1000); // force the fallback with a tiny cap
    expect(r.exact).toBe(false);
    expect(r.winnable_no_tools).toBe(true);
    expect(replayWins(lv, r.path)).toBe(true);
    expect(r.random_win).toBeGreaterThanOrEqual(0);
    expect(r.random_win).toBeLessThanOrEqual(1);
  });
});

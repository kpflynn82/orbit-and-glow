// The level solver (GDD §5, spec §4 "The solver, in plain words").
//
// It plays a level every possible way (every launch order) and reports: can it be won with no
// tools, how many different launch orders win, how full the Dock gets on the best path, and how
// often a player tapping at random would win. Identical comets sitting in the Dock count as one
// choice, launching a docked comet that would hit nothing (a no-op) is skipped, and fusing the same
// two comets counts once whichever one is dragged onto the other.

import { applyMove, cometFor, createState, dockUsed, legalMoves, previewLap } from './engine';
import type { GameState, LevelData, Move, SolverReport } from './types';
import { sensibleWinRate } from './players';

const WAYS_CAP = 1_000_000;

// Memo entries are shared by states that differ only in which Dock slot holds which comet, so a
// Dock move is remembered by the comet it launches ("R5"), not by its slot number.
type CanonMove = { kind: 'rail'; rail: number } | { kind: 'dock'; comet: string } | { kind: 'fuse'; pair: [string, string] };

const id = (c: { color: string; charge: number }) => `${c.color}${c.charge}`;

interface Node {
  ways: number;
  peak: number; // lowest possible peak Dock use from here to a win (Infinity if no win)
  pWin: number; // win chance for a uniform random player from here
  best: CanonMove | null;
}

function canon(s: GameState, m: Move): CanonMove {
  if (m.kind === 'rail') return m;
  if (m.kind === 'dock') return { kind: 'dock', comet: id(s.dock[m.slot]!) };
  const pair = [id(s.dock[m.from]!), id(s.dock[m.onto]!)].sort() as [string, string];
  return { kind: 'fuse', pair };
}

/** Turn a remembered move back into a real move for this state. */
export function resolveMove(s: GameState, m: CanonMove): Move {
  if (m.kind === 'rail') return m;
  if (m.kind === 'dock') {
    const slot = s.dock.findIndex((c) => c !== null && id(c) === m.comet);
    if (slot < 0) throw new Error(`no docked comet ${m.comet}`);
    return { kind: 'dock', slot };
  }
  const from = s.dock.findIndex((c) => c !== null && id(c) === m.pair[0]);
  const onto = s.dock.findIndex((c, i) => i !== from && c !== null && id(c) === m.pair[1]);
  if (from < 0 || onto < 0) throw new Error(`no docked pair ${m.pair.join('+')}`);
  return { kind: 'fuse', from, onto };
}

export function stateKey(s: GameState): string {
  let cells = '';
  for (const c of s.cells) cells += c ?? '.';
  const rails = s.rails.map((r) => r.length).join(',');
  const dock = s.dock
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map((c) => `${c.color}${c.charge}`)
    .sort()
    .join(',');
  return `${cells}|${rails}|${dock}|${s.holding ? id(s.holding) : ''}`;
}

/** The distinct, useful moves from a state (see file comment). */
export function candidateMoves(s: GameState): Move[] {
  const out: Move[] = [];
  const seenDock = new Set<string>();
  const seenFuse = new Set<string>();
  for (const m of legalMoves(s)) {
    if (m.kind === 'fuse') {
      const k = [id(s.dock[m.from]!), id(s.dock[m.onto]!)].sort().join('+');
      if (seenFuse.has(k)) continue;
      seenFuse.add(k);
    } else if (m.kind === 'dock') {
      const c = cometFor(s, m)!;
      const k = `${c.color}${c.charge}`;
      if (seenDock.has(k)) continue;
      seenDock.add(k);
      if (previewLap(s, c).length === 0) continue; // would hit nothing and just re-park
    }
    out.push(m);
  }
  return out;
}

export class TooManyStates extends Error {}

export class Solver {
  private memo = new Map<string, Node>();
  /** Stop with TooManyStates past this many board states (keeps the level generator fast). */
  constructor(private readonly stateCap = Infinity) {}

  get statesVisited(): number {
    return this.memo.size;
  }

  node(s: GameState): Node {
    if (s.status === 'won') return { ways: 1, peak: 0, pWin: 1, best: null };
    if (s.status === 'stuck') return { ways: 0, peak: Infinity, pWin: 0, best: null };
    const key = stateKey(s);
    const hit = this.memo.get(key);
    if (hit) return hit;

    if (this.memo.size >= this.stateCap) throw new TooManyStates(`more than ${this.stateCap} states`);
    const moves = candidateMoves(s);
    let ways = 0;
    let peak = Infinity;
    let pSum = 0;
    let best: CanonMove | null = null;
    for (const m of moves) {
      const { state: next } = applyMove(s, m);
      const child = this.node(next);
      ways = Math.min(WAYS_CAP, ways + child.ways);
      pSum += child.pWin;
      if (child.ways > 0) {
        const p = Math.max(dockUsed(next), child.peak);
        if (p < peak) { peak = p; best = canon(s, m); }
      }
    }
    const node: Node = { ways, peak, pWin: moves.length ? pSum / moves.length : 0, best };
    this.memo.set(key, node);
    return node;
  }

  /** Follow the lowest-peak winning path from a state. */
  path(s: GameState): Move[] {
    const path: Move[] = [];
    let cur = s;
    while (cur.status === 'playing') {
      const n = this.node(cur);
      if (!n.best) break;
      const m = resolveMove(cur, n.best);
      path.push(m);
      cur = applyMove(cur, m).state;
    }
    return path;
  }
}

export function solveLevel(level: LevelData, stateCap = Infinity): SolverReport {
  const solver = new Solver(stateCap);
  const start = createState(level);
  const root = solver.node(start);
  return {
    winnable_no_tools: root.ways > 0,
    winning_orders: root.ways,
    winning_orders_capped: root.ways >= WAYS_CAP,
    peak_dock: Number.isFinite(root.peak) ? root.peak : -1,
    random_win: Math.round(root.pWin * 10000) / 10000,
    states: solver.statesVisited,
    path: root.ways > 0 ? solver.path(start) : [],
  };
}

// ───────────── Big boards: find one win, estimate the rest (spec §4 "Risk") ─────────────
//
// Counting every winning order explodes on big boards with many comets (a 16×16 board with 12
// comets can have tens of millions of states). For those, the solver:
//   1. searches for ONE winning order, trying the most promising launches first and remembering
//      positions it has proved hopeless — one win is the proof that the level is fair; and
//   2. estimates the rest by playing many random games: the share it wins estimates random_win,
//      and weighting each win by how many choices it passed through estimates how many winning
//      orders exist (Knuth's tree-size estimate). Both are marked as estimates in the report.

/** Look for one winning order. Returns the moves, null if there is none, or throws TooManyStates. */
export function findWin(start: GameState, stateBudget = 1_000_000): Move[] | null {
  const dead = new Set<string>();
  const search = (s: GameState): Move[] | null => {
    if (s.status === 'won') return [];
    if (s.status === 'stuck') return null;
    const key = stateKey(s);
    if (dead.has(key)) return null;
    if (dead.size >= stateBudget) throw new TooManyStates(`more than ${stateBudget} states`);
    const options = candidateMoves(s).map((m) => {
      const { state, result } = applyMove(s, m);
      // Prefer: a win, then not stuck, then no leftover to park, then more dust cleared.
      const score =
        (state.status === 'won' ? 1e6 : 0) + (state.status === 'stuck' ? -1e6 : 0) +
        (result.type === 'fuse' ? 500 : (result.leftover === 0 ? 1000 : 0) + result.shots.length);
      return { m, state, score };
    });
    options.sort((a, b) => b.score - a.score);
    for (const o of options) {
      const rest = search(o.state);
      if (rest) return [o.m, ...rest];
    }
    dead.add(key);
    return null;
  };
  return search(start);
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

/** Random games (uniform over the solver's choices) to estimate random_win and winning orders. */
export function sampleLevel(start: GameState, games = 10_000, seed = 7): { randomWin: number; ordersEstimate: number } {
  const rand = mulberry32(seed);
  let wins = 0;
  let weighted = 0;
  for (let g = 0; g < games; g++) {
    let s = start;
    let weight = 1;
    while (s.status === 'playing') {
      const moves = candidateMoves(s);
      if (moves.length === 0) break;
      weight *= moves.length;
      s = applyMove(s, moves[Math.floor(rand() * moves.length)]).state;
    }
    if (s.status === 'won') {
      wins++;
      weighted += weight;
    }
  }
  return { randomWin: wins / games, ordersEstimate: weighted / games };
}

/**
 * The solver for any board size: an exact count when the board is small enough (under
 * `exactCap` states), otherwise one proven win plus estimates. `report.exact` says which.
 */
export function analyzeLevel(level: LevelData, exactCap = 20_000, searchBudget = 1_000_000): SolverReport {
  try {
    return { ...solveLevel(level, exactCap), exact: true, sensible_win: sensibleWinRate(level) };
  } catch (e) {
    if (!(e instanceof TooManyStates)) throw e;
  }
  const start = createState(level);
  const path = findWin(start, searchBudget);
  if (!path) {
    return { winnable_no_tools: false, winning_orders: 0, winning_orders_capped: false, peak_dock: -1, random_win: 0, states: 0, path: [], exact: false };
  }
  let peak = 0;
  let s = start;
  for (const m of path) {
    s = applyMove(s, m).state;
    peak = Math.max(peak, dockUsed(s));
  }
  const est = sampleLevel(start);
  return {
    winnable_no_tools: true,
    // An estimate; never below 1, because one winning order was found and checked.
    winning_orders: Math.max(1, Math.round(Math.min(est.ordersEstimate, WAYS_CAP))),
    winning_orders_capped: est.ordersEstimate >= WAYS_CAP,
    peak_dock: peak, // on the path found, not necessarily the lowest possible
    random_win: Math.round(est.randomWin * 10000) / 10000,
    states: 0,
    path,
    exact: false,
    sensible_win: sensibleWinRate(level),
  };
}

/** Can this mid-game state still be won? (Used by the playtest bot to check stuck detection.) */
export function canStillWin(s: GameState, solver = new Solver()): boolean {
  return solver.node(s).ways > 0;
}

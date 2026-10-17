// Orbit & Glow rules engine (GDD §3). Pure functions; no rendering.
//
// Plain-words summary of the rules:
// - The picture is a grid of colored dust. Comets wait on launch rails; only the front comet of a
//   rail can be launched. Docked comets can be launched again.
// - A launched comet makes one clockwise lap of the orbit, starting at the bottom center. At every
//   row and column it passes, it looks straight inward; if the FIRST dust cell in that line is its
//   own color, it clears that cell (one charge per cell).
// - Each lap is worked out the moment the comet is launched, in launch order. How fast you tap
//   never changes the result ("order, not timing").
// - Charge left after the lap → the comet parks in the first empty Dock slot. Charge 0 → it bursts.
// - Fusion (levels that allow it): drag one docked primary comet onto another of a different
//   primary color. They become one comet of the mixed color with the charges added
//   (Red 7 + Blue 4 = Purple 11). This always frees a slot.
// - Win: no dust left (checked first, so clearing the last dust always wins).
// - A comet that must park when the Dock is full waits at the gate if a fusion could make room;
//   the player's only moves are then fusions, and it parks as soon as a slot frees up.
// - Stuck: a comet must park, the Dock is full and no fusion can make room; or some color has
//   more dust left than every remaining comet (and every fusion) could ever clear.

import { FUSE } from './types';
import type {
  Color, Comet, FuseResult, GameState, LapStep, LaunchResult, LevelData, Move, MoveResult, Shot,
} from './types';

const lapCache = new Map<string, LapStep[]>();

/**
 * The fixed order in which a comet visits rows and columns on one clockwise lap, starting at the
 * bottom center (where comets enter from the rails): left along the bottom, up the left side,
 * across the top, down the right side, then back along the bottom to the start.
 */
export function lapSteps(w: number, h: number): LapStep[] {
  const key = `${w}x${h}`;
  const cached = lapCache.get(key);
  if (cached) return cached;
  const steps: LapStep[] = [];
  const mid = Math.floor((w - 1) / 2);
  for (let c = mid; c >= 0; c--) steps.push({ side: 'bottom', line: c });
  for (let r = h - 1; r >= 0; r--) steps.push({ side: 'left', line: r });
  for (let c = 0; c < w; c++) steps.push({ side: 'top', line: c });
  for (let r = 0; r < h; r++) steps.push({ side: 'right', line: r });
  for (let c = w - 1; c > mid; c--) steps.push({ side: 'bottom', line: c });
  lapCache.set(key, steps);
  return steps;
}

/** The first dust cell seen along a lap step, or null if the line is clear. */
export function firstCellAlong(state: GameState, step: LapStep): { x: number; y: number } | null {
  const { w, h, cells } = state;
  switch (step.side) {
    case 'bottom':
      for (let y = h - 1; y >= 0; y--) if (cells[y * w + step.line]) return { x: step.line, y };
      return null;
    case 'top':
      for (let y = 0; y < h; y++) if (cells[y * w + step.line]) return { x: step.line, y };
      return null;
    case 'left':
      for (let x = 0; x < w; x++) if (cells[step.line * w + x]) return { x, y: step.line };
      return null;
    case 'right':
      for (let x = w - 1; x >= 0; x--) if (cells[step.line * w + x]) return { x, y: step.line };
      return null;
  }
}

export function parseCanvas(rows: string[]): { w: number; h: number; cells: (Color | null)[] } {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const cells: (Color | null)[] = [];
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`canvas row ${y} has length ${row.length}, expected ${w}`);
    for (const ch of row) {
      if (ch === '.') cells.push(null);
      else if ('RYBOGPWS'.includes(ch)) cells.push(ch as Color);
      else throw new Error(`unknown canvas character "${ch}" in row ${y}`);
    }
  });
  return { w, h, cells };
}

export function createState(level: LevelData): GameState {
  const { w, h, cells } = parseCanvas(level.canvas);
  const state: GameState = {
    w,
    h,
    cells,
    rails: level.rails.map((rail) => rail.map((c) => ({ ...c }))),
    dock: Array.from({ length: level.dock }, () => null),
    status: 'playing',
    stuckReason: null,
    moves: 0,
    fusion: Boolean(level.fusion),
    holding: null,
  };
  return withStatus(state);
}

export function cloneState(s: GameState): GameState {
  return {
    ...s,
    cells: s.cells.slice(),
    rails: s.rails.map((r) => r.slice()),
    dock: s.dock.slice(),
  };
}

/** Comet a launch would send, or null if the move isn't a possible launch. */
export function cometFor(state: GameState, move: Move): Comet | null {
  if (state.holding) return null; // a comet is waiting to park: only fusions are allowed
  if (move.kind === 'rail') return state.rails[move.rail]?.[0] ?? null;
  if (move.kind === 'dock') return state.dock[move.slot] ?? null;
  return null;
}

/** The color two comets make when fused, or null if they can't fuse. */
export function fuseColor(a: Color, b: Color): Color | null {
  return FUSE[a]?.[b] ?? null;
}

/** Can the docked comets in these two slots be fused right now? */
export function canFuse(state: GameState, from: number, onto: number): boolean {
  if (!state.fusion || state.status !== 'playing' || from === onto) return false;
  const a = state.dock[from];
  const b = state.dock[onto];
  return Boolean(a && b && fuseColor(a.color, b.color));
}

function anyFusion(state: GameState): boolean {
  if (!state.fusion) return false;
  for (let i = 0; i < state.dock.length; i++)
    for (let j = i + 1; j < state.dock.length; j++) {
      const a = state.dock[i];
      const b = state.dock[j];
      if (a && b && fuseColor(a.color, b.color)) return true;
    }
  return false;
}

/** Every move the player could make right now. */
export function legalMoves(state: GameState): Move[] {
  if (state.status !== 'playing') return [];
  const moves: Move[] = [];
  if (!state.holding) {
    state.rails.forEach((rail, i) => { if (rail.length > 0) moves.push({ kind: 'rail', rail: i }); });
    state.dock.forEach((c, i) => { if (c) moves.push({ kind: 'dock', slot: i }); });
  }
  if (state.fusion) {
    for (let i = 0; i < state.dock.length; i++)
      for (let j = 0; j < state.dock.length; j++) if (canFuse(state, i, j)) moves.push({ kind: 'fuse', from: i, onto: j });
  }
  return moves;
}

/** Simulate a lap without changing the state: which cells would this comet clear? */
export function previewLap(state: GameState, comet: Comet): Shot[] {
  return runLap(cloneState(state), comet).shots;
}

function runLap(state: GameState, comet: Comet): { shots: Shot[]; leftover: number } {
  const steps = lapSteps(state.w, state.h);
  const shots: Shot[] = [];
  let charge = comet.charge;
  for (let i = 0; i < steps.length && charge > 0; i++) {
    const step = steps[i];
    const cell = firstCellAlong(state, step);
    if (!cell) continue;
    const idx = cell.y * state.w + cell.x;
    if (state.cells[idx] === comet.color) {
      state.cells[idx] = null;
      charge--;
      shots.push({ step: i, side: step.side, line: step.line, x: cell.x, y: cell.y });
    }
  }
  return { shots, leftover: charge };
}

/**
 * Make a move (launch or fuse). Returns the new state (the input is not changed) and what
 * happened, for the animation. Throws if the move isn't legal.
 */
export function applyMove(state: GameState, move: Move): { state: GameState; result: MoveResult } {
  if (state.status !== 'playing') throw new Error('game is over');
  if (move.kind === 'fuse') return applyFuse(state, move);
  const comet = cometFor(state, move);
  if (!comet) throw new Error(`illegal move ${JSON.stringify(move)}`);
  const next = cloneState(state);
  let fromSlot: number | null = null;
  if (move.kind === 'rail') next.rails[move.rail] = next.rails[move.rail].slice(1);
  else { next.dock[move.slot] = null; fromSlot = move.slot; }

  const { shots, leftover } = runLap(next, comet);
  let parkedSlot: number | null = null;
  let held = false;
  next.moves++;

  const noDust = !next.cells.some((c) => c !== null);
  if (leftover > 0 && !noDust) {
    const free = next.dock.indexOf(null);
    if (free >= 0) {
      next.dock[free] = { color: comet.color, charge: leftover };
      parkedSlot = free;
    } else if (anyFusion(next)) {
      next.holding = { color: comet.color, charge: leftover };
      held = true;
    } else {
      next.status = 'stuck';
      next.stuckReason = 'dock-full';
      const result: LaunchResult = { type: 'launch', move, comet, shots, leftover, parkedSlot: null, fromSlot, held: false };
      return { state: next, result };
    }
  }
  const result: LaunchResult = { type: 'launch', move, comet, shots, leftover, parkedSlot, fromSlot, held };
  return { state: withStatus(next), result };
}

function applyFuse(state: GameState, move: { kind: 'fuse'; from: number; onto: number }): { state: GameState; result: FuseResult } {
  if (!canFuse(state, move.from, move.onto)) throw new Error(`illegal move ${JSON.stringify(move)}`);
  const next = cloneState(state);
  const a = next.dock[move.from]!;
  const b = next.dock[move.onto]!;
  const made: Comet = { color: fuseColor(a.color, b.color)!, charge: a.charge + b.charge };
  next.dock[move.onto] = made;
  next.dock[move.from] = null;
  next.moves++;
  let parkedSlot: number | null = null;
  if (next.holding) {
    parkedSlot = next.dock.indexOf(null);
    next.dock[parkedSlot] = next.holding;
    next.holding = null;
  }
  const result: FuseResult = { type: 'fuse', move, comet: made, a, b, fromSlot: move.from, onto: move.onto, shots: [], leftover: 0, parkedSlot };
  return { state: withStatus(next), result };
}

/** Dust left of each color. */
export function dustCounts(state: GameState): Map<Color, number> {
  const m = new Map<Color, number>();
  for (const c of state.cells) if (c) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}

/** Total charge still available for each color (rails + Dock + a comet waiting to park). */
export function chargeCounts(state: GameState): Map<Color, number> {
  const m = new Map<Color, number>();
  const add = (c: Comet | null) => { if (c) m.set(c.color, (m.get(c.color) ?? 0) + c.charge); };
  state.rails.forEach((r) => r.forEach(add));
  state.dock.forEach(add);
  add(state.holding);
  return m;
}

const PRIMARIES: Color[] = ['R', 'Y', 'B'];
const PARENTS: Partial<Record<Color, [Color, Color]>> = { O: ['R', 'Y'], G: ['Y', 'B'], P: ['R', 'B'] };

/**
 * The color that can never be cleared now, or null. Sound (never names a color that could still
 * be cleared), and checked after every move so a lost level says Stuck right away:
 * - a primary or neutral color needs at least its dust in charge of its own color (fusion never
 *   makes a primary);
 * - red, yellow or blue charge beyond what its own dust needs is the only fuel fusion can use;
 * - a mixed color short of charge needs spare fuel from BOTH of its parents (one fusion takes one
 *   of each), and all the mixed colors' shortfalls together can't exceed all the spare fuel.
 */
export function deadEndColor(state: GameState): Color | null {
  const charge = chargeCounts(state);
  const dust = dustCounts(state);
  const have = (c: Color) => charge.get(c) ?? 0;
  const need = (c: Color) => dust.get(c) ?? 0;
  for (const [c, n] of dust) if (!PARENTS[c] && have(c) < n) return c;
  const spare = (p: Color) => Math.max(0, have(p) - need(p));
  let totalShort = 0;
  let worst: Color | null = null;
  for (const [c, n] of dust) {
    const parents = PARENTS[c];
    if (!parents) continue;
    const short = n - have(c);
    if (short <= 0) continue;
    if (!state.fusion) return c;
    const [p, q] = parents;
    if (spare(p) === 0 || spare(q) === 0 || spare(p) + spare(q) < short) return c;
    totalShort += short;
    worst = c;
  }
  if (worst && totalShort > PRIMARIES.reduce((sum, p) => sum + spare(p), 0)) return worst;
  return null;
}

/** Sets won / stuck (dead-end) after a move. Dock-full is set in applyMove. */
function withStatus(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  const dust = dustCounts(state);
  if (dust.size === 0) { state.status = 'won'; state.holding = null; return state; }
  if (deadEndColor(state)) {
    state.status = 'stuck';
    state.stuckReason = 'dead-end';
    return state;
  }
  return state;
}

/** Number of occupied Dock slots. */
export function dockUsed(state: GameState): number {
  return state.dock.reduce((n, c) => n + (c ? 1 : 0), 0);
}

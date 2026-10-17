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
// - Win: no dust left. Stuck: a comet must park and the Dock is full, or some color has more dust
//   left than all remaining comets of that color can clear.

import type {
  Color, Comet, GameState, LapStep, LaunchResult, LevelData, Move, Shot,
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

/** Comet a move would launch, or null if the move isn't possible. */
export function cometFor(state: GameState, move: Move): Comet | null {
  if (move.kind === 'rail') return state.rails[move.rail]?.[0] ?? null;
  return state.dock[move.slot] ?? null;
}

/** Every move the player could make right now. */
export function legalMoves(state: GameState): Move[] {
  if (state.status !== 'playing') return [];
  const moves: Move[] = [];
  state.rails.forEach((rail, i) => { if (rail.length > 0) moves.push({ kind: 'rail', rail: i }); });
  state.dock.forEach((c, i) => { if (c) moves.push({ kind: 'dock', slot: i }); });
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
 * Launch a comet. Returns the new state (the input is not changed) and what happened, for the
 * animation. Throws if the move isn't legal.
 */
export function applyMove(state: GameState, move: Move): { state: GameState; result: LaunchResult } {
  if (state.status !== 'playing') throw new Error('game is over');
  const comet = cometFor(state, move);
  if (!comet) throw new Error(`illegal move ${JSON.stringify(move)}`);
  const next = cloneState(state);
  let fromSlot: number | null = null;
  if (move.kind === 'rail') next.rails[move.rail] = next.rails[move.rail].slice(1);
  else { next.dock[move.slot] = null; fromSlot = move.slot; }

  const { shots, leftover } = runLap(next, comet);
  let parkedSlot: number | null = null;
  next.moves++;

  if (leftover > 0) {
    const free = next.dock.indexOf(null);
    if (free === -1) {
      next.status = 'stuck';
      next.stuckReason = 'dock-full';
      return { state: next, result: { move, comet, shots, leftover, parkedSlot: null, fromSlot } };
    }
    next.dock[free] = { color: comet.color, charge: leftover };
    parkedSlot = free;
  }
  return { state: withStatus(next), result: { move, comet, shots, leftover, parkedSlot, fromSlot } };
}

/** Dust left of each color. */
export function dustCounts(state: GameState): Map<Color, number> {
  const m = new Map<Color, number>();
  for (const c of state.cells) if (c) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}

/** Total charge still available for each color (rails + Dock). */
export function chargeCounts(state: GameState): Map<Color, number> {
  const m = new Map<Color, number>();
  const add = (c: Comet | null) => { if (c) m.set(c.color, (m.get(c.color) ?? 0) + c.charge); };
  state.rails.forEach((r) => r.forEach(add));
  state.dock.forEach(add);
  return m;
}

/** Sets won / stuck (dead-end) after a move. Dock-full is set in applyMove. */
function withStatus(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  const dust = dustCounts(state);
  if (dust.size === 0) { state.status = 'won'; return state; }
  const charge = chargeCounts(state);
  for (const [color, n] of dust) {
    if ((charge.get(color) ?? 0) < n) {
      state.status = 'stuck';
      state.stuckReason = 'dead-end';
      return state;
    }
  }
  return state;
}

/** Number of occupied Dock slots. */
export function dockUsed(state: GameState): number {
  return state.dock.reduce((n, c) => n + (c ? 1 : 0), 0);
}

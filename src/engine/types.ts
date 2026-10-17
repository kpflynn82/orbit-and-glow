// Orbit & Glow — shared types for the rules engine, solver, game screen and tools.
// The engine is pure TypeScript (no Phaser) so tests, the solver and the playtest bot
// all run the exact same rules as the game.

export const COLORS = ['R', 'Y', 'B', 'O', 'G', 'P', 'W', 'S'] as const;
export type Color = (typeof COLORS)[number];

export const COLOR_NAMES: Record<Color, string> = {
  R: 'Red', Y: 'Yellow', B: 'Blue', O: 'Orange', G: 'Green', P: 'Purple', W: 'White', S: 'Slate',
};

export interface Comet {
  color: Color;
  charge: number;
}

export type Badge = 'normal' | 'tricky' | 'starfall';

export type Move = { kind: 'rail'; rail: number } | { kind: 'dock'; slot: number };

export interface SolverReport {
  /** Can the level be won with no tools? */
  winnable_no_tools: boolean;
  /** Distinct winning launch orders (identical comets in the Dock count once). */
  winning_orders: number;
  /** True if counting stopped at the cap. */
  winning_orders_capped: boolean;
  /** Fewest Dock slots in use at once on the best winning path. */
  peak_dock: number;
  /**
   * Chance a player who picks uniformly at random among the solver's distinct useful moves wins
   * (identical docked comets count once; a docked comet that would hit nothing is skipped).
   * A rough difficulty ruler: real players do far better than random.
   */
  random_win: number;
  /** Distinct board states the solver visited. */
  states: number;
  /** A winning path (the one with the lowest peak Dock use), for the bot and hints. */
  path: Move[];
  /**
   * true (or missing) = every order was counted. false = big board: one win was found and proven,
   * and winning_orders / random_win are estimates from random games (winning_orders is at least 1,
   * the order that was found); peak_dock is for the path found.
   */
  exact?: boolean;
}

export interface LevelData {
  id: string;
  name: string;
  badge: Badge;
  /** Picture rows, top to bottom. Each letter is a color; '.' is empty sky. */
  canvas: string[];
  /** Launch rails, each listed front comet first. */
  rails: Comet[][];
  /** Dock slots. */
  dock: number;
  /** How many comets may be flying at once (visual only — results never depend on it). */
  ring: number;
  solver?: SolverReport;
}

export type Side = 'bottom' | 'left' | 'top' | 'right';

/** One stop on a comet's lap: a side of the orbit and the row/column it looks along. */
export interface LapStep {
  side: Side;
  line: number;
}

/** A hit: at lap step `step`, the comet cleared cell (x, y). */
export interface Shot {
  step: number;
  side: Side;
  line: number;
  x: number;
  y: number;
}

export interface LaunchResult {
  move: Move;
  comet: Comet;
  shots: Shot[];
  /** Charge left after the lap (0 = the comet bursts). */
  leftover: number;
  /** The Dock slot it parked in, or null if it burst or couldn't park. */
  parkedSlot: number | null;
  /** The Dock slot it left from, for Dock launches. */
  fromSlot: number | null;
}

export type Status = 'playing' | 'won' | 'stuck';
export type StuckReason = 'dock-full' | 'dead-end';

export interface GameState {
  w: number;
  h: number;
  /** Row-major cells; null = cleared or empty sky. */
  cells: (Color | null)[];
  rails: Comet[][];
  dock: (Comet | null)[];
  status: Status;
  stuckReason: StuckReason | null;
  moves: number;
}

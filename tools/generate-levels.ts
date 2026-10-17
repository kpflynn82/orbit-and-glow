// Builds the M1 level files from the gray-box pictures.
//
// Plain words: for each level we count the dust of each color and split each color's total into
// comets (charges add up exactly, so leftovers matter). We deal the comets onto the rails, then
// improve the deal step by step — swap two comets, move one to another rail, split or merge two
// of the same color — checking after every change how the layout plays. A change is kept if the
// level is still winnable without tools and its difficulty moves toward the level's target. If no
// layout reaches the target with the planned Dock, it tries again with one Dock slot fewer.
// Every saved level stores its full solver report.
//
// Speed: during the search each layout gets a quick check — the solver finds one winning order
// (proof it's fair) and 1,500 random games estimate its difficulty. Only the chosen layout gets
// the full (exact) solve that is saved with the level.
//
// Difficulty number: `random_win`, the chance that a player tapping uniformly at random wins.
// Real players are far better than random, so this is a relative ruler, not a prediction.
//
// Run: npm run levels   (writes levels/level-01.json … level-20.json; ONLY=3,4 for some levels)

import { mkdirSync, writeFileSync } from 'node:fs';
import { createState, firstCellAlong, lapSteps, parseCanvas } from '../src/engine/engine';
import { analyzeLevel, findWin, sampleLevel, TooManyStates } from '../src/engine/solver';
import type { Badge, Color, Comet, LevelData } from '../src/engine/types';
import { PICTURES } from './pictures';

interface Plan {
  picture: string;
  badge: Badge;
  rails: number;
  dock: number;
  charge: [number, number];
  /** Target band for random_win. */
  target: [number, number];
  /** Every winning path must use the Dock at least once (teaches the Dock). */
  minPeak?: number;
  /** Dock size to try if the planned one can't reach the target (default: one fewer, at least 2). */
  altDock?: number;
}

const PLANS: Plan[] = [
  { picture: 'Crescent', badge: 'normal', rails: 2, dock: 4, charge: [7, 12], target: [0.85, 1] },
  { picture: 'Heart', badge: 'normal', rails: 2, dock: 4, charge: [6, 12], target: [0.7, 1] },
  // Level 3 teaches the Dock: every win parks a comet, but with a Dock of 4 it can't be lost.
  { picture: 'Mushroom', badge: 'normal', rails: 3, dock: 4, altDock: 4, charge: [6, 14], target: [0.6, 1], minPeak: 1 },
  { picture: 'Fish', badge: 'normal', rails: 3, dock: 3, charge: [6, 14], target: [0.4, 0.8] },
  { picture: 'Lantern', badge: 'tricky', rails: 3, dock: 2, charge: [4, 9], target: [0.12, 0.35] },
  { picture: 'Apple Tree', badge: 'normal', rails: 3, dock: 3, charge: [6, 14], target: [0.4, 0.8] },
  { picture: 'Teapot', badge: 'normal', rails: 3, dock: 3, charge: [6, 14], target: [0.3, 0.7] },
  { picture: 'Cat', badge: 'normal', rails: 3, dock: 3, charge: [7, 16], target: [0.3, 0.7] },
  { picture: 'Sailboat', badge: 'normal', rails: 3, dock: 3, charge: [6, 14], target: [0.25, 0.65] },
  { picture: 'Owl', badge: 'starfall', rails: 4, dock: 2, charge: [7, 16], target: [0.03, 0.15] },
  { picture: 'Flower', badge: 'normal', rails: 3, dock: 3, charge: [7, 16], target: [0.35, 0.75] },
  { picture: 'Whale', badge: 'normal', rails: 4, dock: 3, charge: [7, 16], target: [0.25, 0.65] },
  { picture: 'House', badge: 'normal', rails: 4, dock: 3, charge: [7, 16], target: [0.2, 0.6] },
  { picture: 'Planet', badge: 'normal', rails: 4, dock: 3, charge: [8, 18], target: [0.2, 0.6] },
  { picture: 'Snail', badge: 'tricky', rails: 4, dock: 3, charge: [7, 16], target: [0.08, 0.25] },
  { picture: 'Kite', badge: 'normal', rails: 4, dock: 3, charge: [8, 18], target: [0.2, 0.55] },
  { picture: 'Cupcake', badge: 'normal', rails: 4, dock: 3, charge: [8, 18], target: [0.15, 0.5] },
  { picture: 'Butterfly', badge: 'normal', rails: 4, dock: 3, charge: [8, 18], target: [0.15, 0.5] },
  { picture: 'Lighthouse', badge: 'normal', rails: 4, dock: 3, charge: [8, 18], target: [0.15, 0.5] },
  { picture: 'Sun', badge: 'starfall', rails: 4, dock: 2, charge: [6, 10], target: [0.02, 0.12] },
];

const STEPS = Number(process.env.STEPS ?? 500);
const STATE_CAP = Number(process.env.STATE_CAP ?? 200_000); // search budget for the one-win proof
const SAMPLES = Number(process.env.SAMPLES ?? 1500);

interface Quick {
  random_win: number;
  usesDock: boolean; // no win is possible without parking at least once
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function split(n: number, [lo, hi]: [number, number], rand: () => number): number[] {
  const parts: number[] = [];
  let left = n;
  while (left > 0) {
    if (left <= hi) { parts.push(left); break; }
    let p = lo + Math.floor(rand() * (hi - lo + 1));
    if (left - p < lo) p = left - lo;
    parts.push(p);
    left -= p;
  }
  return parts;
}

/**
 * How deep each color sits: peel the picture like an onion (cells a lap can see first are layer
 * 0, the next ones layer 1…) and average each color's layer. Deep colors are hidden early on.
 */
function colorDepth(rows: string[]): Map<Color, number> {
  const lv: LevelData = { id: '', name: '', badge: 'normal', canvas: rows, rails: [], dock: 4, ring: 4 };
  const s = createState(lv);
  const layer = new Array<number>(s.cells.length).fill(-1);
  let k = 0;
  while (s.cells.some((c) => c)) {
    const seen = new Set<number>();
    for (const step of lapSteps(s.w, s.h)) {
      const cell = firstCellAlong(s, step);
      if (cell) seen.add(cell.y * s.w + cell.x);
    }
    for (const i of seen) { layer[i] = k; s.cells[i] = null; }
    k++;
  }
  const { cells } = parseCanvas(rows);
  const sum = new Map<Color, [number, number]>();
  cells.forEach((c, i) => {
    if (!c) return;
    const [a, n] = sum.get(c) ?? [0, 0];
    sum.set(c, [a + layer[i], n + 1]);
  });
  return new Map([...sum].map(([c, [a, n]]) => [c, a / n]));
}

function initialDeal(rows: string[], plan: Plan, rand: () => number, bias: number): Comet[][] {
  const { cells } = parseCanvas(rows);
  const counts = new Map<Color, number>();
  for (const c of cells) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  const depth = colorDepth(rows);
  const comets: Comet[] = [];
  for (const [color, n] of counts) for (const ch of split(n, plan.charge, rand)) comets.push({ color, charge: ch });
  // bias > 0: hidden colors tend toward the front (they'll have to wait in the Dock).
  // bias < 0: visible colors first (an easy, almost always winnable start). Plus noise.
  const keyed = comets.map((c) => ({ c, k: -bias * (depth.get(c.color) ?? 0) + rand() * 2.5 }));
  keyed.sort((a, b) => a.k - b.k);
  const rails: Comet[][] = Array.from({ length: plan.rails }, () => []);
  keyed.forEach(({ c }, i) => rails[i % plan.rails].push(c));
  return rails;
}

function cloneRails(r: Comet[][]): Comet[][] {
  return r.map((rail) => rail.map((c) => ({ ...c })));
}

function mutate(rails: Comet[][], plan: Plan, rand: () => number): Comet[][] {
  const r = cloneRails(rails);
  const pick = (n: number) => Math.floor(rand() * n);
  const kind = rand();
  const nonEmpty = () => r.map((x, i) => (x.length ? i : -1)).filter((i) => i >= 0);
  if (kind < 0.45) {
    // swap two comets
    const ra = r[pick(r.length)], rb = r[pick(r.length)];
    if (!ra.length || !rb.length) return r;
    const ia = pick(ra.length), ib = pick(rb.length);
    [ra[ia], rb[ib]] = [rb[ib], ra[ia]];
  } else if (kind < 0.7) {
    // move a comet to another rail (keep every rail non-empty)
    const from = r[pick(r.length)];
    if (from.length < 2) return r;
    const [c] = from.splice(pick(from.length), 1);
    const to = r[pick(r.length)];
    to.splice(pick(to.length + 1), 0, c);
  } else if (kind < 0.85) {
    // split a big comet into two of the same color
    const ri = nonEmpty()[pick(nonEmpty().length)];
    const rail = r[ri];
    const i = pick(rail.length);
    const c = rail[i];
    if (c.charge < plan.charge[0] * 2) return r;
    const a = plan.charge[0] + pick(c.charge - 2 * plan.charge[0] + 1);
    rail.splice(i, 1, { color: c.color, charge: a });
    const to = r[pick(r.length)];
    to.splice(pick(to.length + 1), 0, { color: c.color, charge: c.charge - a });
  } else {
    // merge two comets of the same color (if the result isn't too big)
    const all: [number, number][] = [];
    r.forEach((rail, ri) => rail.forEach((_, ci) => all.push([ri, ci])));
    const [ra, ca] = all[pick(all.length)];
    const c = r[ra][ca];
    const mates = all.filter(([ri, ci]) => (ri !== ra || ci !== ca) && r[ri][ci].color === c.color);
    if (!mates.length) return r;
    const [rb, cb] = mates[pick(mates.length)];
    if (c.charge + r[rb][cb].charge > plan.charge[1] + 2) return r;
    if (r[rb].length < 2) return r;
    c.charge += r[rb][cb].charge;
    r[rb].splice(cb, 1);
  }
  return r;
}

function score(r: Quick | null, plan: Plan): number {
  if (!r) return Infinity;
  if (plan.minPeak && !r.usesDock) return 100 + (1 - r.random_win);
  const [lo, hi] = plan.target;
  if (r.random_win >= lo && r.random_win <= hi) return Math.abs(r.random_win - (lo + hi) / 2) / 10;
  return r.random_win > hi ? r.random_win - hi + 1 : lo - r.random_win + 1;
}

function evaluate(level: LevelData, plan: Plan): Quick | null {
  try {
    const start = createState(level);
    if (!findWin(start, STATE_CAP)) return null;
    // "Uses the Dock" = the same layout with no Dock at all can't be won.
    const usesDock = plan.minPeak ? findWin(createState({ ...level, dock: 0 }), STATE_CAP) === null : true;
    return { random_win: sampleLevel(start, SAMPLES, 11).randomWin, usesDock };
  } catch (e) {
    if (e instanceof TooManyStates) return null;
    throw e;
  }
}

function buildLevel(i: number, plan: Plan, dock: number): { level: LevelData; s: number } {
  const pic = PICTURES.find((p) => p.name === plan.picture);
  if (!pic) throw new Error(`no picture ${plan.picture}`);
  const base = (rails: Comet[][]): LevelData => ({
    id: `ch01-l${String(i + 1).padStart(2, '0')}`,
    name: pic.name,
    badge: plan.badge,
    canvas: pic.rows,
    rails,
    dock,
    ring: 4,
  });
  let best: { rails: Comet[][]; report: Quick; s: number } | null = null;
  // A few fresh starts, then local improvement from the best.
  const biases = [1, 1, 0.5, 0.5, 0, 0, -0.5, -1];
  for (let start = 0; start < biases.length; start++) {
    const rand = rng((i + 1) * 7919 + start);
    const rails = initialDeal(pic.rows, plan, rand, biases[start]);
    const report = evaluate(base(rails), plan);
    const s = score(report, plan);
    if (process.env.DEBUG) console.log(`  start ${start} bias ${biases[start]}: ${report ? `rw=${report.random_win} usesDock=${report.usesDock}` : 'no win found'}`);
    if (report && (!best || s < best.s)) best = { rails, report, s };
  }
  if (!best || !Number.isFinite(best.s)) return { level: base([]), s: Infinity };
  const rand = rng((i + 1) * 104729);
  for (let step = 0; step < STEPS && best.s > 0.02; step++) {
    const rails = mutate(best.rails, plan, rand);
    const report = evaluate(base(rails), plan);
    const s = score(report, plan);
    if (report && s < best.s) best = { rails, report, s };
  }
  return { level: base(best.rails), s: best.s };
}

function main() {
  mkdirSync('levels', { recursive: true });
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',').map(Number)) : null; // e.g. ONLY=3,4
  PLANS.forEach((plan, i) => {
    if (only && !only.has(i + 1)) return;
    const t0 = Date.now();
    let built = buildLevel(i, plan, plan.dock);
    const alt = plan.altDock ?? Math.max(2, plan.dock - 1);
    if (built.s >= 1 && alt !== plan.dock) {
      const second = buildLevel(i, plan, alt);
      if (second.s < built.s) built = second;
    }
    if (!Number.isFinite(built.s)) throw new Error(`no winnable layout for level ${i + 1}`);
    const level: LevelData = { ...built.level, solver: analyzeLevel(built.level, 400_000) };
    const inBand = level.solver!.random_win >= plan.target[0] && level.solver!.random_win <= plan.target[1];
    const file = `levels/level-${String(i + 1).padStart(2, '0')}.json`;
    writeFileSync(file, JSON.stringify(level, null, 2) + '\n');
    const r = level.solver!;
    const { w, h } = parseCanvas(level.canvas);
    const comets = level.rails.reduce((n, rail) => n + rail.length, 0);
    console.log(
      `${String(i + 1).padStart(2)} ${plan.picture.padEnd(11)} ${plan.badge.padEnd(8)} ${w}x${h} ` +
      `rails=${plan.rails} dock=${level.dock} comets=${String(comets).padStart(2)} ` +
      `random_win=${r.random_win.toFixed(3)} target=${plan.target.join('–')} ${inBand ? 'in band' : 'OUT OF BAND'} ` +
      `peak_dock=${r.peak_dock} orders=${r.winning_orders}${r.winning_orders_capped ? '+' : ''} ` +
      `${r.exact === false ? 'ESTIMATED ' : ''}states=${r.states} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
  });
}

main();

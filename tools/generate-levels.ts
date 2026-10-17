// Builds the level files from the gray-box pictures (chapter 1, second version).
//
// Plain words: for each level we count the dust of each color and turn it into comets whose
// charges add up exactly to the dust. In fusion levels, some mixed-color dust (orange, green,
// purple) gets no comets of its own: its charge is given to comets of the two parent colors
// instead, so the player has to park those, fuse them and send the new comet. We deal the comets
// onto the rails, then improve the deal step by step — swap two comets, move one to another rail,
// split or merge two of the same color — checking after every change how the layout plays.
//
// The ruler (since Kevin's first playtest): the "sensible player" in src/engine/players.ts, who
// launches whatever can hit right now, avoids parking and never plans ahead. Each level has a
// target band for how often that player wins: early levels let it win, normal levels make it lose
// sometimes, Tricky and Starfall levels must beat it most of the time. A layout only counts if the
// solver proves it can be won (and, where the plan says so, that winning needs the Dock or a
// fusion). If no layout reaches the target with the planned Dock, it tries one slot fewer.
//
// Speed: during the search each layout gets a quick check (one proven win + 100 sensible-player
// games). Only the chosen layout gets the full solve that is saved with the level.
//
// Run: npm run levels   (writes any missing levels/level-NN.json; ONLY=3,4 for some levels)
// Existing level files are never overwritten unless FORCE=1 — never rebuild a level Kevin has
// played without his OK.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createState, firstCellAlong, lapSteps, parseCanvas } from '../src/engine/engine';
import { sensibleWinRate } from '../src/engine/players';
import { analyzeLevel, findWin, TooManyStates } from '../src/engine/solver';
import type { Badge, Color, Comet, LevelData } from '../src/engine/types';
import { PICTURES } from './pictures';

interface Plan {
  picture: string;
  badge: Badge;
  rails: number;
  dock: number;
  /** Dock size to try if the planned one can't reach the target (default: one fewer, at least 2). */
  altDock?: number;
  charge: [number, number];
  /** Target band for how often the sensible player wins. */
  target: [number, number];
  /** Every win must park a comet at least once (teaches the Dock). */
  minPeak?: number;
  /** Fusion allowed in this level. */
  fusion?: boolean;
  /** Share of each mixed color's dust that must be made by fusion (no comets of its own). */
  viaFusion?: Partial<Record<Color, number>>;
  /** Winning needs at least one fusion. */
  mustFuse?: boolean;
  tip?: string;
  /** Keep the tip until the first fusion (levels that teach fusion). */
  tipUntil?: 'fuse';
}

const PLANS: Plan[] = [
  { picture: 'Crescent', badge: 'normal', rails: 2, dock: 3, charge: [5, 9], target: [0.9, 1],
    tip: 'Clear the picture. Tap a comet: it flies one lap and clears specks of its color it can see.' },
  { picture: 'Heart', badge: 'normal', rails: 2, dock: 3, charge: [5, 9], target: [0.85, 1],
    tip: 'A comet only hits the first speck in each row and column, so the outside clears first.' },
  { picture: 'Mushroom', badge: 'normal', rails: 3, dock: 3, altDock: 3, charge: [3, 7], target: [0.75, 1], minPeak: 1,
    tip: 'A comet with charge left parks in the Dock — tap it later. If the Dock is full, you’re stuck.' },
  { picture: 'Fish', badge: 'normal', rails: 3, dock: 3, charge: [3, 7], target: [0.5, 0.85],
    tip: 'Hidden colors come out as the outside clears. Think about what to send first.' },
  { picture: 'Lantern', badge: 'tricky', rails: 3, dock: 2, charge: [4, 9], target: [0, 0.25],
    tip: 'Tricky: the obvious launch isn’t always the right one.' },
  { picture: 'Apple Tree', badge: 'normal', rails: 3, dock: 3, charge: [3, 8], target: [0.4, 0.95],
    fusion: true, viaFusion: { O: 1 }, mustFuse: true, tipUntil: 'fuse',
    tip: 'New: drag a docked comet onto another to fuse them. Red + Yellow = Orange, charges add.' },
  { picture: 'Cat', badge: 'normal', rails: 3, dock: 3, charge: [3, 8], target: [0.4, 0.85],
    fusion: true, viaFusion: { G: 1 }, mustFuse: true, tipUntil: 'fuse',
    tip: 'Yellow + Blue = Green. Send a comet that can’t hit anything yet and it parks, ready to fuse.' },
  { picture: 'Teapot', badge: 'normal', rails: 3, dock: 3, charge: [4, 9], target: [0.35, 0.8],
    fusion: true, viaFusion: { P: 1 }, mustFuse: true },
  { picture: 'Sailboat', badge: 'normal', rails: 3, dock: 3, charge: [4, 10], target: [0.3, 0.75],
    fusion: true, viaFusion: { O: 1 }, mustFuse: true },
  // Level 10 arrives about ten minutes into a first session: hard, but not zero for every strategy.
  { picture: 'Owl', badge: 'starfall', rails: 4, dock: 2, charge: [3, 8], target: [0.03, 0.12],
    fusion: true, viaFusion: { O: 0.4 },
    tip: 'Starfall: the hardest kind of level. Retry is always free.' },
  { picture: 'Flower', badge: 'normal', rails: 3, dock: 3, charge: [4, 9], target: [0.3, 0.75],
    fusion: true, viaFusion: { G: 1 }, mustFuse: true },
  // No mixed colors in this picture, so no fusion (a fusion could only hurt).
  { picture: 'Whale', badge: 'normal', rails: 4, dock: 3, charge: [3, 8], target: [0.3, 0.75] },
  { picture: 'House', badge: 'normal', rails: 4, dock: 3, charge: [4, 9], target: [0.25, 0.7],
    fusion: true, viaFusion: { G: 1 }, mustFuse: true },
  { picture: 'Planet', badge: 'normal', rails: 4, dock: 3, charge: [4, 9], target: [0.25, 0.7],
    fusion: true, viaFusion: { P: 0.5 }, mustFuse: true },
  { picture: 'Snail', badge: 'tricky', rails: 4, dock: 3, charge: [3, 8], target: [0, 0.25],
    fusion: true, viaFusion: { O: 0.6 }, mustFuse: true },
  // A breather after Tricky level 15.
  { picture: 'Kite', badge: 'normal', rails: 4, dock: 3, altDock: 3, charge: [4, 9], target: [0.6, 0.95],
    fusion: true, viaFusion: { P: 0.4 } },
  { picture: 'Cupcake', badge: 'normal', rails: 4, dock: 3, charge: [4, 9], target: [0.25, 0.7],
    fusion: true, viaFusion: { O: 0.6 }, mustFuse: true },
  { picture: 'Butterfly', badge: 'normal', rails: 4, dock: 3, charge: [4, 9], target: [0.25, 0.7],
    fusion: true, viaFusion: { O: 1, P: 0.3 }, mustFuse: true },
  { picture: 'Lighthouse', badge: 'normal', rails: 4, dock: 3, charge: [4, 9], target: [0.25, 0.7],
    fusion: true, viaFusion: { G: 1 }, mustFuse: true },
  { picture: 'Sun', badge: 'starfall', rails: 4, dock: 2, charge: [3, 8], target: [0, 0.08],
    fusion: true, viaFusion: { O: 0.5 }, mustFuse: true },
];

const STEPS = Number(process.env.STEPS ?? 250);
const STATE_CAP = Number(process.env.STATE_CAP ?? 60_000); // search budget for the one-win proof
const GAMES = Number(process.env.GAMES ?? 100); // sensible-player games per layout during the search

const PARENTS: Partial<Record<Color, [Color, Color]>> = { O: ['R', 'Y'], G: ['Y', 'B'], P: ['R', 'B'] };

interface Quick {
  sensible: number;
  /** Win rate of a sensible player who slips (random move) 25% of the time — a smoother signal. */
  slipping: number;
  usesDock: boolean;
  needsFuse: boolean;
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

/** Total comet charge per color: the dust, with fusion-only mixed colors moved onto their parents. */
function chargePlan(rows: string[], plan: Plan, rand: () => number): Map<Color, number> {
  const { cells } = parseCanvas(rows);
  const dust = new Map<Color, number>();
  for (const c of cells) if (c) dust.set(c, (dust.get(c) ?? 0) + 1);
  const total = new Map<Color, number>();
  const add = (c: Color, n: number) => { if (n > 0) total.set(c, (total.get(c) ?? 0) + n); };
  for (const [c, n] of dust) {
    const share = plan.fusion ? plan.viaFusion?.[c] ?? 0 : 0;
    const parents = PARENTS[c];
    if (!share || !parents || n < 2) { add(c, n); continue; } // a fusion needs at least 1 + 1 charge
    const viaFusion = Math.min(n, Math.max(2, Math.round(n * share)));
    add(c, n - viaFusion);
    const toFirst = Math.max(1, Math.min(viaFusion - 1, Math.round(viaFusion * (0.3 + 0.4 * rand()))));
    add(parents[0], toFirst);
    add(parents[1], viaFusion - toFirst);
  }
  return total;
}

function initialDeal(rows: string[], plan: Plan, rand: () => number, bias: number): Comet[][] {
  const depth = colorDepth(rows);
  const deepest = Math.max(0, ...depth.values()) + 1; // fusion fuel colors aren't in the picture
  const comets: Comet[] = [];
  for (const [color, n] of chargePlan(rows, plan, rand)) for (const ch of split(n, plan.charge, rand)) comets.push({ color, charge: ch });
  // bias > 0: hidden colors tend toward the front (they'll have to wait in the Dock).
  // bias < 0: visible colors first (an easy, almost always winnable start). Plus noise.
  const keyed = comets.map((c) => ({ c, k: -bias * (depth.get(c.color) ?? deepest) + rand() * 2.5 }));
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
  if (!r.usesDock || !r.needsFuse) return 100 + r.sensible;
  const [lo, hi] = plan.target;
  if (r.sensible >= lo && r.sensible <= hi) return Math.abs(r.sensible - (lo + hi) / 2) / 10;
  // Too easy: also reward layouts that punish slips, so the search has a slope to follow even
  // where the sensible player always wins.
  return r.sensible > hi ? r.sensible - hi + 1 + 0.5 * r.slipping : lo - r.sensible + 1;
}

function evaluate(level: LevelData, plan: Plan): Quick | null {
  try {
    const start = createState(level);
    if (start.status !== 'playing' || !findWin(start, STATE_CAP)) return null;
    // "Uses the Dock" = the same layout with no Dock at all can't be won.
    const usesDock = plan.minPeak ? findWin(createState({ ...level, dock: 0 }), STATE_CAP) === null : true;
    // "Needs a fusion" = the same layout with fusion switched off can't be won.
    const needsFuse = plan.mustFuse ? findWin(createState({ ...level, fusion: false }), STATE_CAP) === null : true;
    return { sensible: sensibleWinRate(level, GAMES, 7), slipping: sensibleWinRate(level, GAMES / 2, 8, 0.25), usesDock, needsFuse };
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
    ...(plan.fusion ? { fusion: true } : {}),
    ...(plan.tip ? { tip: plan.tip } : {}),
    ...(plan.tipUntil ? { tipUntil: plan.tipUntil } : {}),
  });
  let best: { rails: Comet[][]; s: number } | null = null;
  // Several fresh starts, then local improvement from the best.
  const biases = [1, 1, 0.5, 0.5, 0, 0, -0.5, -1, 1.5, 2];
  for (let start = 0; start < biases.length; start++) {
    const rand = rng((i + 1) * 7919 + start * 31 + dock);
    const rails = initialDeal(pic.rows, plan, rand, biases[start]);
    const report = evaluate(base(rails), plan);
    const s = score(report, plan);
    if (process.env.DEBUG) console.log(`  start ${start} bias ${biases[start]}: ${report ? `sensible=${report.sensible} dock=${report.usesDock} fuse=${report.needsFuse}` : 'no win found'}`);
    if (report && (!best || s < best.s)) best = { rails, s };
  }
  if (!best || !Number.isFinite(best.s)) return { level: base([]), s: Infinity };
  // Local search. Equal-score changes are accepted too, so the search can wander across flat
  // stretches (e.g. many layouts the sensible player always wins) instead of stopping dead; when
  // it hasn't improved for a while it starts over from a fresh deal.
  const rand = rng((i + 1) * 104729 + dock);
  let cur = best;
  let sinceBetter = 0;
  for (let step = 0; step < STEPS && best.s > 0.02; step++) {
    if (sinceBetter > 60) {
      const rails = initialDeal(pic.rows, plan, rand, rand() * 3 - 0.5);
      const s = score(evaluate(base(rails), plan), plan);
      if (Number.isFinite(s)) cur = { rails, s };
      sinceBetter = 0;
    }
    const rails = mutate(cur.rails, plan, rand);
    const s = score(evaluate(base(rails), plan), plan);
    if (s <= cur.s) cur = { rails, s };
    if (cur.s < best.s) { best = cur; sinceBetter = 0; } else sinceBetter++;
  }
  return { level: base(best.rails), s: best.s };
}

function main() {
  mkdirSync('levels', { recursive: true });
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',').map(Number)) : null; // e.g. ONLY=3,4
  PLANS.forEach((plan, i) => {
    if (only && !only.has(i + 1)) return;
    const file = `levels/level-${String(i + 1).padStart(2, '0')}.json`;
    if (existsSync(file) && !process.env.FORCE) {
      console.log(`${String(i + 1).padStart(2)} ${plan.picture.padEnd(11)} kept (${file} exists; FORCE=1 to rebuild it)`);
      return;
    }
    const t0 = Date.now();
    let built = buildLevel(i, plan, plan.dock);
    const alt = plan.altDock ?? Math.max(2, plan.dock - 1);
    if (built.s >= 1 && alt !== plan.dock) {
      const second = buildLevel(i, plan, alt);
      if (second.s < built.s) built = second;
    }
    if (!Number.isFinite(built.s)) throw new Error(`no winnable layout for level ${i + 1}`);
    const level: LevelData = { ...built.level, solver: analyzeLevel(built.level, 150_000) };
    const r = level.solver!;
    const sw = r.sensible_win ?? NaN;
    const inBand = sw >= plan.target[0] && sw <= plan.target[1];
    writeFileSync(file, JSON.stringify(level, null, 2) + '\n');
    const { w, h } = parseCanvas(level.canvas);
    const comets = level.rails.reduce((n, rail) => n + rail.length, 0);
    console.log(
      `${String(i + 1).padStart(2)} ${plan.picture.padEnd(11)} ${plan.badge.padEnd(8)} ${w}x${h} ` +
      `rails=${plan.rails} dock=${level.dock} comets=${String(comets).padStart(2)} ${plan.fusion ? 'fusion' : '      '} ` +
      `sensible=${(sw * 100).toFixed(0).padStart(3)}% target=${plan.target.map((x) => x * 100).join('–')}% ${inBand ? 'in band' : 'OUT OF BAND'} ` +
      `random=${(r.random_win * 100).toFixed(0)}% peak_dock=${r.peak_dock} ${r.exact === false ? 'ESTIMATED ' : ''}` +
      `(${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
  });
}

// Run only when called as a script (so tools can import the helpers).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();

export { PLANS, initialDeal, mutate, evaluate, score };

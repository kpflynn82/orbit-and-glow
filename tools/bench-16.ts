// M1 done-line check: "the solver finishes on a 16×16 board in seconds".
// Builds a few 16×16 boards (4–5 colors, 9–12 comets, layered so order matters) and times a full
// solve of each (exact count when small; a proven win plus estimates when big). Usage: npm run bench

import { analyzeLevel } from '../src/engine/solver';
import type { Color, Comet, LevelData } from '../src/engine/types';

function rings(colors: Color[], size = 16): string[] {
  // Concentric square bands of color, with a few specks of the next color in each band.
  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    let row = '';
    for (let x = 0; x < size; x++) {
      const d = Math.min(x, y, size - 1 - x, size - 1 - y);
      const band = Math.min(colors.length - 1, Math.floor(d / 2));
      const speck = (x * 7 + y * 3) % 11 === 0 && band + 1 < colors.length;
      row += speck ? colors[band + 1] : colors[band];
    }
    rows.push(row);
  }
  return rows;
}

function deal(rows: string[], comets: number, rails: number): Comet[][] {
  const count = new Map<Color, number>();
  for (const r of rows) for (const ch of r) if (ch !== '.') count.set(ch as Color, (count.get(ch as Color) ?? 0) + 1);
  // Split each color's dust into comets, roughly in proportion to how much of it there is.
  const total = [...count.values()].reduce((a, b) => a + b, 0);
  const list: Comet[] = [];
  for (const [color, n] of count) {
    const k = Math.max(1, Math.round((n / total) * comets));
    for (let i = 0; i < k; i++) list.push({ color, charge: Math.floor(n / k) + (i < n % k ? 1 : 0) });
  }
  // Outer colors first, round-robin onto the rails.
  const out: Comet[][] = Array.from({ length: rails }, () => []);
  list.forEach((c, i) => out[i % rails].push(c));
  return out;
}

const cases: { name: string; colors: Color[]; comets: number; rails: number; dock: number }[] = [
  { name: '16x16, 4 colors, ~9 comets, Dock 3', colors: ['B', 'R', 'Y', 'W'], comets: 9, rails: 4, dock: 3 },
  { name: '16x16, 5 colors, ~11 comets, Dock 3', colors: ['S', 'B', 'R', 'Y', 'W'], comets: 11, rails: 4, dock: 3 },
  { name: '16x16, 5 colors, ~12 comets, Dock 4', colors: ['P', 'B', 'G', 'Y', 'W'], comets: 12, rails: 5, dock: 4 },
];

let worst = 0;
for (const c of cases) {
  const canvas = rings(c.colors);
  const level: LevelData = { id: 'bench', name: c.name, badge: 'normal', canvas, rails: deal(canvas, c.comets, c.rails), dock: c.dock, ring: 4 };
  const t0 = Date.now();
  const r = analyzeLevel(level);
  const secs = (Date.now() - t0) / 1000;
  worst = Math.max(worst, secs);
  const n = level.rails.reduce((a, rail) => a + rail.length, 0);
  console.log(
    `${c.name}: ${n} comets, winnable=${r.winnable_no_tools} ${r.exact ? 'exact' : 'ESTIMATED'} ` +
      `orders=${r.winning_orders}${r.winning_orders_capped ? '+' : ''} random_win=${r.random_win} path=${r.path.length} launches — ${secs.toFixed(1)} s`,
  );
}
console.log(`\nSlowest solve: ${worst.toFixed(1)} s`);

// Re-solve every level file from scratch and check it against the solver report saved in it.
// Run this after hand-editing any level: `npm run solve`. Add `WRITE=1` to refresh the saved reports.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { analyzeLevel } from '../src/engine/solver';
import type { LevelData } from '../src/engine/types';

const files = readdirSync('levels').filter((f) => /^level-\d\d\.json$/.test(f)).sort();
let problems = 0;

for (const f of files) {
  const lv: LevelData = JSON.parse(readFileSync(`levels/${f}`, 'utf8'));
  const t0 = Date.now();
  const r = analyzeLevel(lv, 150_000); // same cap as the generator: exact unless the board is huge
  const old = lv.solver;
  const same =
    old !== undefined &&
    old.winnable_no_tools === r.winnable_no_tools &&
    old.winning_orders === r.winning_orders &&
    old.peak_dock === r.peak_dock &&
    old.random_win === r.random_win &&
    old.sensible_win === r.sensible_win;
  // Big boards: the counts are estimates, but winnability and the sensible player's rate must match.
  const sameEstimate = old !== undefined && old.winnable_no_tools === r.winnable_no_tools && old.sensible_win === r.sensible_win;
  const flag = !r.winnable_no_tools ? 'UNWINNABLE' : !r.exact ? (sameEstimate ? 'ok (estimated: too big to count)' : 'CHANGED') : same ? 'ok' : 'CHANGED';
  if (!flag.startsWith('ok')) problems++;
  console.log(
    `${lv.id} ${lv.name.padEnd(11)} ${lv.badge.padEnd(8)} winnable=${r.winnable_no_tools} ` +
      `orders=${r.winning_orders}${r.winning_orders_capped ? '+' : ''} peak_dock=${r.peak_dock} ` +
      `random_win=${r.random_win.toFixed(3)} states=${r.states} (${((Date.now() - t0) / 1000).toFixed(1)}s) ${flag}`,
  );
  if (process.env.WRITE && r.winnable_no_tools) {
    lv.solver = r;
    writeFileSync(`levels/${f}`, JSON.stringify(lv, null, 2) + '\n');
  }
}

console.log(problems ? `\n${problems} level(s) need attention.` : `\nAll ${files.length} levels match their saved solver reports.`);
if (problems && !process.env.WRITE) process.exit(1);

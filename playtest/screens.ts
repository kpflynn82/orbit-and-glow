// Browser playtest: opens the built game in a phone-sized Chromium window, plays every level
// by tapping the real screen positions of the solver's winning path, and checks the game says
// "won" each time. Also forces one "Stuck" and saves screenshots to playtest/screenshots/.
//
// Usage: npm run build && npm run screens
//        LEVELS=1,5,10 npm run screens   (just some levels)

import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { applyMove, createState, legalMoves } from '../src/engine/engine';
import { Solver } from '../src/engine/solver';
import type { LevelData, Move } from '../src/engine/types';

const DIST = process.env.DIST ?? 'dist';
const SHOTS = 'playtest/screenshots';
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

function serve(): Promise<{ url: string; close: () => void }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = join(DIST, path === '/' ? 'index.html' : path);
    if (!file.startsWith(DIST) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => server.close() });
    }),
  );
}

const files = readdirSync('levels').filter((f) => /^level-\d\d\.json$/.test(f)).sort();
const levels: LevelData[] = files.map((f) => JSON.parse(readFileSync(`levels/${f}`, 'utf8')));
const only = process.env.LEVELS ? new Set(process.env.LEVELS.split(',').map(Number)) : null;

async function waitFor(page: Page, fn: string, timeout = 20000): Promise<void> {
  await page.waitForFunction(fn, undefined, { timeout, polling: 30 });
}

async function tap(page: Page, m: Move): Promise<void> {
  const p = await page.evaluate((mv) => window.__orbit!.screenPoint(mv), m);
  await page.touchscreen.tap(p.x, p.y);
}

/** Play a move list by tapping, as a quick player would: several comets in the air at once. */
async function play(page: Page, lv: LevelData, moves: Move[]): Promise<void> {
  for (const m of moves) {
    if (m.kind === 'dock') await waitFor(page, 'window.__orbit.flying() === 0'); // its comet must have landed
    else await waitFor(page, `window.__orbit.flying() < ${lv.ring}`);
    const before = await page.evaluate(() => window.__orbit!.moves());
    await tap(page, m);
    await waitFor(page, `window.__orbit.moves() > ${before}`, 3000).catch(() => {
      throw new Error(`tap on ${JSON.stringify(m)} did not launch a comet`);
    });
  }
  await waitFor(page, 'window.__orbit.flying() === 0');
}

/** A move list that ends in "Stuck" (found with the engine), for the stuck-screen check. */
function stuckLine(lv: LevelData): Move[] | null {
  const solver = new Solver();
  const walk = (s: ReturnType<typeof createState>, path: Move[]): Move[] | null => {
    if (s.status === 'stuck') return path;
    if (s.status === 'won' || path.length > 30) return null;
    for (const m of legalMoves(s)) {
      const next = applyMove(s, m).state;
      if (next.status !== 'won' && (next.status === 'stuck' || solver.node(next).ways === 0)) {
        const r = walk(next, [...path, m]);
        if (r) return r;
      }
    }
    for (const m of legalMoves(s)) {
      const r = walk(applyMove(s, m).state, [...path, m]);
      if (r) return r;
    }
    return null;
  };
  return walk(createState(lv), []);
}

async function main(): Promise<void> {
  const { url, close } = await serve();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(`${url}?canvas`);
  await waitFor(page, 'window.__orbit && window.__orbit.ready()');
  await page.evaluate(() => window.__orbit!.load(0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/01-level-1-start.png` });

  // Mid-flight shot at normal speed on level 3.
  const lv3 = levels[2];
  await page.evaluate(() => window.__orbit!.load(2));
  await page.waitForTimeout(300);
  await tap(page, lv3.solver!.path[0]);
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${SHOTS}/02-comet-in-flight.png` });
  await waitFor(page, 'window.__orbit.flying() === 0');

  // Quick taps: the first three launches of level 9 tapped fast, so two comets wait by the gate.
  const lv9 = levels[8];
  await page.evaluate(() => window.__orbit!.load(8));
  await page.waitForTimeout(300);
  for (const m of lv9.solver!.path.slice(0, 3)) if (m.kind === 'rail') await tap(page, m);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/02b-comets-waiting-their-turn.png` });
  await waitFor(page, 'window.__orbit.flying() === 0');

  const results: string[] = [];
  let failures = 0;
  for (const [i, lv] of levels.entries()) {
    if (only && !only.has(i + 1)) continue;
    await page.evaluate((n) => { window.__orbit!.load(n); window.__orbit!.speed(5); }, i);
    await page.waitForTimeout(150);
    let status = 'error';
    try {
      await play(page, lv, lv.solver!.path);
      status = await page.evaluate(() => window.__orbit!.status());
    } catch (e) {
      status = `error: ${(e as Error).message}`;
    }
    const ok = status === 'won';
    if (!ok) failures++;
    results.push(`${String(i + 1).padStart(2)} ${lv.name.padEnd(11)} ${ok ? 'WON' : `FAILED (${status})`}`);
    if ([1, 5, 10, 20].includes(i + 1)) {
      await page.evaluate(() => window.__orbit!.speed(1));
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}/${String(i + 3).padStart(2, '0')}-level-${i + 1}-won.png` });
    }
  }

  // Force a "Stuck" on the first level that allows one, and check the stuck screen shows.
  const stuckIdx = levels.findIndex((lv) => (lv.solver?.random_win ?? 1) < 1);
  if (stuckIdx >= 0) {
    const line = stuckLine(levels[stuckIdx]);
    if (line) {
      await page.evaluate((n) => { window.__orbit!.load(n); window.__orbit!.speed(5); }, stuckIdx);
      await page.waitForTimeout(150);
      await play(page, levels[stuckIdx], line);
      const st = await page.evaluate(() => window.__orbit!.status());
      await page.evaluate(() => window.__orbit!.speed(1));
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}/30-stuck-level-${stuckIdx + 1}.png` });
      const ok = st === 'stuck';
      if (!ok) failures++;
      results.push(`stuck check on level ${stuckIdx + 1}: ${ok ? 'shows Stuck' : `FAILED (${st})`}`);
    }
  }

  // Level menu.
  await page.evaluate(() => window.__orbit!.load(0));
  await page.waitForTimeout(200);
  await page.touchscreen.tap(...(await menuPoint(page)));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/31-level-menu.png` });

  console.log(results.join('\n'));
  if (consoleErrors.length) {
    failures++;
    console.log(`\nBrowser errors:\n${consoleErrors.slice(0, 10).join('\n')}`);
  }
  console.log(`\n${failures ? `${failures} problem(s).` : 'All good.'} Screenshots in ${SHOTS}/`);
  await browser.close();
  close();
  if (failures) process.exit(1);
}

async function menuPoint(page: Page): Promise<[number, number]> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  // The ≡ button sits at game (576, 48) on a 720×1280 canvas.
  return [box.x + (576 / 720) * box.width, box.y + (48 / 1280) * box.height];
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Every shipped level must be valid, winnable, and match what the solver recorded for it.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMove, createState, dustCounts, parseCanvas } from '../src/engine/engine';
import type { LevelData } from '../src/engine/types';

const files = readdirSync('levels').filter((f) => /^level-\d\d\.json$/.test(f)).sort();
const levels: LevelData[] = files.map((f) => JSON.parse(readFileSync(`levels/${f}`, 'utf8')));

describe('level set', () => {
  it('has 20 levels with ids in order', () => {
    expect(levels.length).toBe(20);
    levels.forEach((lv, i) => expect(lv.id).toBe(`ch01-l${String(i + 1).padStart(2, '0')}`));
  });

  it('follows the badge rhythm (5 and 15 tricky, 10 and 20 starfall, the rest normal)', () => {
    levels.forEach((lv, i) => {
      const n = i + 1;
      const want = n % 10 === 0 ? 'starfall' : n % 10 === 5 ? 'tricky' : 'normal';
      expect(lv.badge, `level ${n}`).toBe(want);
    });
  });
});

describe.each(levels.map((lv) => [lv.id, lv] as const))('%s', (_id, lv) => {
  it('has a valid picture, rails and Dock', () => {
    expect(() => parseCanvas(lv.canvas)).not.toThrow();
    expect(lv.rails.length).toBeGreaterThan(0);
    expect(lv.dock).toBeGreaterThanOrEqual(2);
    expect(lv.ring).toBeGreaterThanOrEqual(1);
    for (const rail of lv.rails) {
      expect(rail.length).toBeGreaterThan(0);
      for (const c of rail) expect(c.charge).toBeGreaterThan(0);
    }
  });

  it('has enough charge (or fusion fuel) for every color, so it starts playable', () => {
    const dust = dustCounts(createState(lv));
    expect(dust.size).toBeGreaterThan(0);
    expect(createState(lv).status).toBe('playing');
  });

  it('wears an honest badge: Tricky and Starfall beat the sensible player', () => {
    const sw = lv.solver?.sensible_win;
    expect(sw).toBeTypeOf('number');
    if (lv.badge === 'tricky') expect(sw!).toBeLessThanOrEqual(0.3);
    if (lv.badge === 'starfall') expect(sw!).toBeLessThanOrEqual(0.12);
  });

  it('needs a fusion when a mixed color has no comets of its own', () => {
    if (!lv.fusion) return;
    const dust = dustCounts(createState(lv));
    const own = new Set(lv.rails.flat().map((c) => c.color));
    const fusionOnly = ['O', 'G', 'P'].some((c) => dust.has(c as never) && !own.has(c as never));
    if (fusionOnly) expect(lv.solver!.path.some((m) => m.kind === 'fuse')).toBe(true);
  });

  it('is winnable, and the recorded winning path really wins', () => {
    expect(lv.solver?.winnable_no_tools).toBe(true);
    let s = createState(lv);
    for (const m of lv.solver!.path) {
      expect(s.status).toBe('playing');
      s = applyMove(s, m).state;
    }
    expect(s.status).toBe('won');
  });
});

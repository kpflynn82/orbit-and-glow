import { describe, expect, it } from 'vitest';
import { applyMove, createState, lapSteps, legalMoves } from '../src/engine/engine';
import { canStillWin, solveLevel } from '../src/engine/solver';
import type { Comet, LevelData } from '../src/engine/types';

const C = (color: Comet['color'], charge: number): Comet => ({ color, charge });

function level(canvas: string[], rails: Comet[][], dock = 4, fusion = false): LevelData {
  return { id: 't', name: 't', badge: 'normal', canvas, rails, dock, ring: 4, fusion };
}

describe('lap order', () => {
  it('starts at bottom center, goes clockwise, and visits every line from every side once', () => {
    const steps = lapSteps(4, 3);
    expect(steps.map((s) => `${s.side[0]}${s.line}`).join(' ')).toBe(
      'b1 b0 l2 l1 l0 t0 t1 t2 t3 r0 r1 r2 b3 b2',
    );
    expect(steps.length).toBe(2 * (4 + 3));
  });
});

describe('launching', () => {
  it('clears only the first cell it sees in each line', () => {
    // A blue cell boxed in by red can't be seen by a blue comet.
    const s0 = createState(level(['RRR', 'RBR', 'RRR'], [[C('B', 1), C('R', 8)], [C('B', 1)]]));
    const { state: s1, result } = applyMove(s0, { kind: 'rail', rail: 0 });
    expect(result.shots).toHaveLength(0);
    expect(result.leftover).toBe(1);
    expect(result.parkedSlot).toBe(0);
    expect(s1.dock[0]).toEqual(C('B', 1));
  });

  it('a full red lap clears the ring, then the docked blue clears the center', () => {
    let s = createState(level(['RRR', 'RBR', 'RRR'], [[C('B', 1), C('R', 8)]]));
    s = applyMove(s, { kind: 'rail', rail: 0 }).state; // blue parks
    const r = applyMove(s, { kind: 'rail', rail: 0 }); // red clears all 8
    expect(r.result.shots).toHaveLength(8);
    expect(r.result.leftover).toBe(0);
    expect(r.result.parkedSlot).toBeNull();
    s = applyMove(r.state, { kind: 'dock', slot: 0 }).state;
    expect(s.status).toBe('won');
  });

  it('looks along each line once per side, and can clear a column from different sides', () => {
    // 1 row × 1 column of 3 reds: visible from top and bottom (2 shots) — the third is hidden.
    const s0 = createState(level(['R', 'R', 'R'], [[C('R', 3)]]));
    const r = applyMove(s0, { kind: 'rail', rail: 0 });
    // bottom (col 0) → (0,2); left rows 2,1,0 → (0,2) gone so (0,1) via row 1, (0,0) via row 0.
    expect(r.result.shots.length).toBe(3);
    expect(r.state.status).toBe('won');
  });

  it('is deterministic: the same moves always give the same board', () => {
    const lv = level(['RYB', 'YBR', 'BRY'], [[C('R', 3), C('Y', 3)], [C('B', 3)]]);
    const play = () => {
      let s = createState(lv);
      for (const m of [{ kind: 'rail', rail: 1 }, { kind: 'rail', rail: 0 }, { kind: 'rail', rail: 0 }] as const) {
        if (s.status !== 'playing') break;
        s = applyMove(s, m).state;
      }
      return JSON.stringify(s);
    };
    expect(play()).toBe(play());
  });
});

describe('stuck', () => {
  it('is stuck when a comet must park and the Dock is full', () => {
    // Ring of red around a hidden blue; a yellow comet with nothing to hit; one Dock slot.
    let s = createState(level(['RRR', 'RBR', 'RRR'], [[C('B', 1)], [C('Y', 1)], [C('R', 8)]], 1));
    s = applyMove(s, { kind: 'rail', rail: 0 }).state; // blue can't see its cell → parks
    expect(s.status).toBe('playing');
    s = applyMove(s, { kind: 'rail', rail: 1 }).state; // yellow hits nothing → no room to park
    expect(s.status).toBe('stuck');
    expect(s.stuckReason).toBe('dock-full');
  });

  it('is stuck when a color has more dust than charge left (dead end)', () => {
    const ok = createState(level(['RR', 'BB'], [[C('B', 2)], [C('R', 1), C('R', 1)]]));
    expect(ok.status).toBe('playing');
    const d = createState(level(['RR'], [[C('R', 1)]]));
    expect(d.status).toBe('stuck');
    expect(d.stuckReason).toBe('dead-end');
  });

  it('a docked comet relaunched after the board opens up can finish the level', () => {
    let s = createState(level(['RRR', 'RBR', 'RRR'], [[C('B', 1)], [C('R', 8)]]));
    s = applyMove(s, { kind: 'rail', rail: 0 }).state;
    s = applyMove(s, { kind: 'rail', rail: 1 }).state;
    expect(s.dock[0]).toEqual(C('B', 1));
    s = applyMove(s, { kind: 'dock', slot: 0 }).state;
    expect(s.status).toBe('won');
    expect(s.dock.every((c) => c === null)).toBe(true);
  });
});

describe('solver', () => {
  it('finds a win and reports the lowest peak Dock use', () => {
    const r = solveLevel(level(['RRR', 'RBR', 'RRR'], [[C('B', 1)], [C('R', 8)]]));
    expect(r.winnable_no_tools).toBe(true);
    expect(r.peak_dock).toBe(0); // red first, then blue: nothing ever parks
    expect(r.path).toEqual([{ kind: 'rail', rail: 1 }, { kind: 'rail', rail: 0 }]);
    expect(r.winning_orders).toBe(2); // red→blue, or blue (parks)→red→docked blue
  });

  it('says no when a level cannot be won', () => {
    // Blue is in front of red and can't see its cell; with no Dock it has nowhere to go.
    const r = solveLevel(level(['RRR', 'RBR', 'RRR'], [[C('B', 1), C('R', 8)]], 0));
    expect(r.winnable_no_tools).toBe(false);
    expect(r.path).toEqual([]);
    // Win doesn't need every comet: a spare yellow can be left on its rail.
    const r2 = solveLevel(level(['RRR', 'RBR', 'RRR'], [[C('B', 1), C('R', 8)], [C('Y', 1)]], 1));
    expect(r2.winnable_no_tools).toBe(true);
  });

  it('canStillWin agrees with the engine on finished states', () => {
    const lv = level(['RRR', 'RBR', 'RRR'], [[C('B', 1)], [C('R', 8)]]);
    let s = createState(lv);
    s = applyMove(s, { kind: 'rail', rail: 1 }).state;
    expect(canStillWin(s)).toBe(true);
  });
});

describe('fusion', () => {
  it('fuses two docked primaries into the mixed color, charges added, freeing a slot', () => {
    let s = createState(level(['PPP'], [[C('R', 2)], [C('B', 1)]], 2, true));
    s = applyMove(s, { kind: 'rail', rail: 0 }).state; // red sees no red → parks
    s = applyMove(s, { kind: 'rail', rail: 1 }).state; // blue sees no blue → parks
    expect(s.dock).toEqual([C('R', 2), C('B', 1)]);
    const r = applyMove(s, { kind: 'fuse', from: 0, onto: 1 });
    expect(r.result.type).toBe('fuse');
    expect(r.state.dock).toEqual([null, C('P', 3)]);
    s = applyMove(r.state, { kind: 'dock', slot: 1 }).state; // purple clears all three
    expect(s.status).toBe('won');
  });

  it('only fuses different primaries, and only in levels that allow it', () => {
    let s = createState(level(['PPPP'], [[C('R', 2)], [C('R', 1)], [C('B', 1)]], 3, true));
    for (const rail of [0, 1, 2]) s = applyMove(s, { kind: 'rail', rail }).state;
    const fuses = legalMoves(s).filter((m) => m.kind === 'fuse');
    expect(fuses.every((m) => m.kind === 'fuse' && s.dock[m.from]!.color !== s.dock[m.onto]!.color)).toBe(true);
    expect(fuses.length).toBe(4); // each red with the blue, both ways
    let off = createState(level(['RRR'], [[C('B', 1)], [C('Y', 1)], [C('R', 3)]], 2));
    off = applyMove(off, { kind: 'rail', rail: 0 }).state;
    off = applyMove(off, { kind: 'rail', rail: 1 }).state;
    expect(legalMoves(off).some((m) => m.kind === 'fuse')).toBe(false);
  });

  it('a comet that finds the Dock full waits while a fusion can make room, then parks', () => {
    let s = createState(level(['PPP'], [[C('R', 2), C('Y', 1)], [C('B', 1)]], 2, true));
    s = applyMove(s, { kind: 'rail', rail: 0 }).state; // R2 parks
    s = applyMove(s, { kind: 'rail', rail: 0 }).state; // Y1 parks; Dock full
    const r = applyMove(s, { kind: 'rail', rail: 1 }); // B1 must park; R+Y could fuse
    expect(r.result.type === 'launch' && r.result.held).toBe(true);
    expect(r.state.status).toBe('playing');
    expect(r.state.holding).toEqual(C('B', 1));
    expect(legalMoves(r.state).every((m) => m.kind === 'fuse')).toBe(true);
    const f = applyMove(r.state, { kind: 'fuse', from: 0, onto: 1 });
    expect(f.state.holding).toBeNull();
    expect(f.state.dock).toEqual([C('B', 1), C('O', 3)]);
    expect(f.result.parkedSlot).toBe(0);
    // Red went into orange, so the purple can never be made: a dead end.
    expect(f.state.status).toBe('stuck');
    expect(f.state.stuckReason).toBe('dead-end');
  });

  it('is stuck when the Dock is full and no fusion can make room', () => {
    let s = createState(level(['PPP'], [[C('R', 2)], [C('B', 1)]], 1, true));
    s = applyMove(s, { kind: 'rail', rail: 0 }).state;
    s = applyMove(s, { kind: 'rail', rail: 1 }).state;
    expect(s.status).toBe('stuck');
    expect(s.stuckReason).toBe('dock-full');
  });

  it('clearing the last dust always wins, even with charge left and a full Dock', () => {
    const s = applyMove(createState(level(['R'], [[C('R', 2)]], 0)), { kind: 'rail', rail: 0 }).state;
    expect(s.status).toBe('won');
  });

  it('the solver finds a win that needs a fusion', () => {
    const r = solveLevel(level(['PPP'], [[C('R', 2)], [C('B', 1)]], 2, true));
    expect(r.winnable_no_tools).toBe(true);
    expect(r.path.some((m) => m.kind === 'fuse')).toBe(true);
  });
});

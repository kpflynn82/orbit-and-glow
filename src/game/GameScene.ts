// The gray-box play screen (M1). Rules live in ../engine; this file only draws and animates.
//
// Logic is resolved the instant a comet is launched (order, not timing). The animation then
// replays what happened: the comet rides the oval orbit and each shot fires when it passes the
// row or column it hit. All comets fly at the same speed, so what you see always matches the rules.

import Phaser from 'phaser';
import { applyMove, cometFor, createState, lapSteps } from '../engine/engine';
import type { Comet, GameState, LaunchResult, LevelData, Move, Side } from '../engine/types';
import { COLOR_NAMES } from '../engine/types';
import { LEVELS } from '../levels';
import { COLOR_HEX, PAL, drawGlyph, drawStar } from './palette';
import { loadProgress, saveProgress, type Progress } from './progress';

export const GAME_W = 720;
export const GAME_H = 1280;

const LAP_MS = 1900;
const ENTRY_MS = 220;
const PARK_MS = 260;
const FRONT_R = 34;
const BACK_R = 24;

interface Layout {
  cx: number;
  cy: number;
  a: number; // orbit half-width
  b: number; // orbit half-height
  cell: number;
  x0: number;
  y0: number;
  dock: { x: number; y: number }[];
  railX: number[];
  railFrontY: number;
}

interface CellView {
  rect: Phaser.GameObjects.Rectangle;
  glyph: Phaser.GameObjects.Graphics;
  claim: Phaser.GameObjects.Graphics | null;
}

export class GameScene extends Phaser.Scene {
  levelIndex = 0;
  level!: LevelData;
  state!: GameState;
  private L!: Layout;
  private progress: Progress = { completed: [], lastLevel: 0 };
  private inFlight = 0;
  private pendingDock = new Set<number>();
  private cellViews: (CellView | null)[] = [];
  private board!: Phaser.GameObjects.Container;
  private railLayer!: Phaser.GameObjects.Container;
  private dockLayer!: Phaser.GameObjects.Container;
  private fxLayer!: Phaser.GameObjects.Container;
  private hud!: Phaser.GameObjects.Container;
  private dockViews: (Phaser.GameObjects.Container | null)[] = [];
  private dockSlotGfx: Phaser.GameObjects.Graphics[] = [];
  private overlay: Phaser.GameObjects.Container | null = null;
  private generation = 0; // bumps on every level load; stale animations check it
  private skyStars = new Set<unknown>();

  constructor() {
    super('game');
  }

  create(): void {
    this.progress = loadProgress();
    this.drawSky();
    this.board = this.add.container(0, 0);
    this.dockLayer = this.add.container(0, 0);
    this.railLayer = this.add.container(0, 0);
    this.fxLayer = this.add.container(0, 0);
    this.hud = this.add.container(0, 0);
    const start = Math.min(this.progress.lastLevel, LEVELS.length - 1);
    this.loadLevel(start);
  }

  // ───────────────────────────── level setup ─────────────────────────────

  loadLevel(index: number): void {
    this.generation++;
    this.levelIndex = index;
    this.level = LEVELS[index];
    this.state = createState(this.level);
    this.inFlight = 0;
    this.pendingDock.clear();
    // Stop the last level's animations, but keep the background stars twinkling.
    for (const t of this.tweens.getTweens()) {
      if (!t.targets.some((o) => this.skyStars.has(o))) t.stop();
    }
    this.time.removeAllEvents();
    this.overlay?.destroy();
    this.overlay = null;
    for (const layer of [this.board, this.dockLayer, this.railLayer, this.fxLayer, this.hud]) layer.removeAll(true);
    this.progress.lastLevel = index;
    saveProgress(this.progress);
    this.L = this.computeLayout();
    this.drawOrbit();
    this.drawCanvas();
    this.drawDock();
    this.drawRails();
    this.drawHud();
  }

  private computeLayout(): Layout {
    const { w, h } = this.state;
    const cx = GAME_W / 2;
    const cy = 500;
    const a = 330;
    const b = 405;
    const span = 450;
    const cell = Math.floor(span / Math.max(w, h));
    const x0 = cx - (w * cell) / 2;
    const y0 = cy - (h * cell) / 2;
    const n = this.level.dock;
    const spacing = 112;
    const dock = Array.from({ length: n }, (_, i) => {
      const dx = (i - (n - 1) / 2) * spacing;
      return { x: cx + dx, y: 968 - (dx * dx) / 900 }; // a gentle crescent
    });
    const r = this.level.rails.length;
    const railSpacing = r <= 3 ? 170 : 150;
    const railX = Array.from({ length: r }, (_, i) => cx + (i - (r - 1) / 2) * railSpacing);
    return { cx, cy, a, b, cell, x0, y0, dock, railX, railFrontY: 1088 };
  }

  private drawSky(): void {
    // Painted once onto a canvas texture so it looks the same in WebGL and Canvas renderers.
    if (!this.textures.exists('sky')) {
      const tex = this.textures.createCanvas('sky', GAME_W, GAME_H);
      if (tex) {
        const ctx = tex.getContext();
        const grad = ctx.createLinearGradient(0, 0, 0, GAME_H);
        grad.addColorStop(0, `#${PAL.skyTop.toString(16).padStart(6, '0')}`);
        grad.addColorStop(1, `#${PAL.skyBottom.toString(16).padStart(6, '0')}`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, GAME_W, GAME_H);
        tex.refresh();
      }
    }
    this.add.image(0, 0, 'sky').setOrigin(0, 0);
    const rnd = new Phaser.Math.RandomDataGenerator(['orbit']);
    for (let i = 0; i < 60; i++) {
      const s = this.add.circle(rnd.between(0, GAME_W), rnd.between(0, GAME_H), rnd.realInRange(0.6, 1.8), 0xffffff, rnd.realInRange(0.15, 0.6));
      this.skyStars.add(s);
      this.tweens.add({ targets: s, alpha: 0.05, duration: rnd.between(1200, 3200), yoyo: true, repeat: -1, delay: rnd.between(0, 2000) });
    }
  }

  private drawOrbit(): void {
    const { cx, cy, a, b } = this.L;
    const g = this.add.graphics();
    g.lineStyle(14, PAL.orbit, 0.08);
    g.strokeEllipse(cx, cy, a * 2, b * 2, 96);
    g.lineStyle(3, PAL.orbit, 0.75);
    g.strokeEllipse(cx, cy, a * 2, b * 2, 96);
    // entry gate at the bottom center, where comets join the orbit
    g.fillStyle(PAL.orbit, 0.9);
    g.fillCircle(cx, cy + b, 6);
    this.board.add(g);
  }

  private cellCenter(x: number, y: number): { x: number; y: number } {
    const { x0, y0, cell } = this.L;
    return { x: x0 + x * cell + cell / 2, y: y0 + y * cell + cell / 2 };
  }

  private drawCanvas(): void {
    const { w, h, cells } = this.state;
    const { cell } = this.L;
    this.cellViews = cells.map((c, i) => {
      if (!c) return null;
      const { x, y } = this.cellCenter(i % w, Math.floor(i / w));
      const rect = this.add.rectangle(x, y, cell - 2, cell - 2, COLOR_HEX[c]).setAlpha(0.95);
      const glyph = this.add.graphics();
      drawGlyph(glyph, c, x, y, Math.max(3, cell * 0.13), PAL.ink, 0.35);
      this.board.add([rect, glyph]);
      return { rect, glyph, claim: null };
    });
    void h;
  }

  // ───────────────────────────── comets ─────────────────────────────

  private makeComet(c: Comet, r: number): Phaser.GameObjects.Container {
    const cont = this.add.container(0, 0);
    const halo = this.add.circle(0, 0, r * 1.35, COLOR_HEX[c.color], 0.18);
    const body = this.add.circle(0, 0, r, COLOR_HEX[c.color]).setStrokeStyle(2, 0xffffff, 0.6);
    const glyph = this.add.graphics();
    drawGlyph(glyph, c.color, 0, -r * 0.48, r * 0.17, PAL.ink, 0.55);
    const label = this.add
      .text(0, r * 0.12, String(c.charge), { fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: `${Math.round(r * 0.85)}px`, fontStyle: 'bold', color: PAL.inkCss })
      .setOrigin(0.5);
    cont.add([halo, body, glyph, label]);
    cont.setData('label', label);
    cont.setData('charge', c.charge);
    return cont;
  }

  private setCharge(cont: Phaser.GameObjects.Container, n: number): void {
    if (!cont.active) return;
    cont.setData('charge', n);
    (cont.getData('label') as Phaser.GameObjects.Text).setText(String(n));
  }

  private drawRails(): void {
    this.railLayer.removeAll(true);
    const { railX, railFrontY } = this.L;
    this.state.rails.forEach((rail, ri) => {
      const x = railX[ri];
      const g = this.add.graphics();
      g.lineStyle(3, PAL.orbit, 0.18);
      g.beginPath();
      g.moveTo(x, railFrontY + 4);
      g.lineTo(x + (x - this.L.cx) * 0.12, GAME_H - 30);
      g.strokePath();
      this.railLayer.add(g);
      const shown = rail.slice(0, 3);
      shown.forEach((c, k) => {
        const r = k === 0 ? FRONT_R : BACK_R;
        const cy = railFrontY + (k === 0 ? 0 : 58 + (k - 1) * 52);
        const cxk = x + ((x - this.L.cx) * 0.12 * (cy - railFrontY)) / (GAME_H - 30 - railFrontY);
        const comet = this.makeComet(c, r).setPosition(cxk, cy);
        if (k > 0) comet.setAlpha(0.55);
        this.railLayer.add(comet);
        if (k === 0) {
          const hit = this.add.circle(cxk, cy, r + 14, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
          hit.on('pointerdown', () => this.tryMove({ kind: 'rail', rail: ri }));
          this.railLayer.add(hit);
        }
      });
      if (rail.length > 3) {
        const more = this.add
          .text(x, GAME_H - 26, `+${rail.length - 3}`, { fontFamily: 'system-ui, sans-serif', fontSize: '22px', color: PAL.textDim })
          .setOrigin(0.5);
        this.railLayer.add(more);
      }
    });
  }

  private drawDock(): void {
    this.dockLayer.removeAll(true);
    this.dockSlotGfx = [];
    this.dockViews = this.state.dock.map(() => null);
    this.L.dock.forEach((p, i) => {
      const g = this.add.graphics();
      this.dockSlotGfx.push(g);
      this.dockLayer.add(g);
      const hit = this.add.circle(p.x, p.y, FRONT_R + 12, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => {
        if (this.state.dock[i] && !this.pendingDock.has(i)) this.tryMove({ kind: 'dock', slot: i });
      });
      this.dockLayer.add(hit);
    });
    this.refreshDockSlots();
  }

  private refreshDockSlots(): void {
    const used = this.state.dock.filter(Boolean).length;
    const lastFree = this.state.dock.length - used === 1;
    this.L.dock.forEach((p, i) => {
      const g = this.dockSlotGfx[i];
      g.clear();
      const empty = !this.state.dock[i];
      const warn = empty && lastFree && this.state.status === 'playing';
      g.fillStyle(PAL.dock, 0.85);
      g.fillCircle(p.x, p.y, FRONT_R + 8);
      g.lineStyle(3, warn ? PAL.amber : PAL.dockRim, warn ? 0.95 : 0.6);
      g.strokeCircle(p.x, p.y, FRONT_R + 8);
    });
  }

  private drawHud(): void {
    this.hud.removeAll(true);
    const style = { fontFamily: 'system-ui, -apple-system, sans-serif', color: PAL.text } as const;
    const title = this.add.text(28, 26, `${this.levelIndex + 1}  ${this.level.name}`, { ...style, fontSize: '30px', fontStyle: 'bold' });
    this.hud.add(title);
    if (this.level.badge !== 'normal') {
      const label = this.level.badge === 'tricky' ? 'TRICKY' : 'STARFALL';
      const color = this.level.badge === 'tricky' ? 0xc8d0e8 : 0xffd23f;
      const t = this.add.text(32, 68, label, { ...style, fontSize: '18px', fontStyle: 'bold', color: PAL.inkCss }).setPadding(10, 4, 10, 4);
      t.setBackgroundColor(Phaser.Display.Color.IntegerToColor(color).rgba);
      this.hud.add(t);
    }
    const mk = (x: number, label: string, fn: () => void) => {
      const bg = this.add.circle(x, 46, 30, 0xffffff, 0.08).setStrokeStyle(2, PAL.orbit, 0.5).setInteractive({ useHandCursor: true });
      const t = this.add.text(x, 46, label, { ...style, fontSize: '30px' }).setOrigin(0.5);
      bg.on('pointerdown', fn);
      this.hud.add([bg, t]);
    };
    mk(GAME_W - 46, '↻', () => this.loadLevel(this.levelIndex));
    mk(GAME_W - 116, '≡', () => this.showLevelMenu());
  }

  // ───────────────────────────── playing ─────────────────────────────

  /** Positions of tappable things, in game coordinates (used by the playtest bot). */
  pointFor(move: Move): { x: number; y: number } {
    if (move.kind === 'rail') return { x: this.L.railX[move.rail], y: this.L.railFrontY };
    return this.L.dock[move.slot];
  }

  busy(): boolean {
    return this.inFlight > 0;
  }

  flying(): number {
    return this.inFlight;
  }

  /** Speed up animations (playtest bot only). Results never depend on timing. */
  setSpeed(n: number): void {
    this.tweens.timeScale = n;
    this.time.timeScale = n;
  }

  tryMove(move: Move): boolean {
    if (this.overlay || this.state.status !== 'playing') return false;
    const comet = cometFor(this.state, move);
    if (!comet) return false;
    if (this.inFlight >= this.level.ring) {
      this.cameras.main.shake(120, 0.003);
      return false;
    }
    const startPos = this.pointFor(move);
    let launched: Phaser.GameObjects.Container;
    if (move.kind === 'dock') {
      const view = this.dockViews[move.slot];
      launched = view ?? this.makeComet(comet, FRONT_R).setPosition(startPos.x, startPos.y);
      this.dockViews[move.slot] = null;
      this.dockLayer.remove(launched);
    } else {
      launched = this.makeComet(comet, FRONT_R).setPosition(startPos.x, startPos.y);
    }
    this.fxLayer.add(launched);

    const { state, result } = applyMove(this.state, move);
    this.state = state;
    if (result.parkedSlot !== null) this.pendingDock.add(result.parkedSlot);
    this.drawRails();
    this.refreshDockSlots();
    this.animateLaunch(launched, result);
    return true;
  }

  private stepPoint(side: Side, line: number): { x: number; y: number; theta: number } {
    const { cx, cy, a, b } = this.L;
    let x: number;
    let y: number;
    if (side === 'top' || side === 'bottom') {
      x = this.cellCenter(line, 0).x;
      const k = Math.sqrt(Math.max(0, 1 - ((x - cx) / a) ** 2));
      y = side === 'top' ? cy - b * k : cy + b * k;
    } else {
      y = this.cellCenter(0, line).y;
      const k = Math.sqrt(Math.max(0, 1 - ((y - cy) / b) ** 2));
      x = side === 'left' ? cx - a * k : cx + a * k;
    }
    let theta = Math.atan2((y - cy) / b, (x - cx) / a);
    while (theta < Math.PI / 2 - 1e-6) theta += Math.PI * 2;
    while (theta >= Math.PI / 2 + Math.PI * 2) theta -= Math.PI * 2;
    return { x, y, theta };
  }

  private animateLaunch(comet: Phaser.GameObjects.Container, result: LaunchResult): void {
    const gen = this.generation;
    this.inFlight++;
    const { cx, cy, a, b } = this.L;
    const steps = lapSteps(this.state.w, this.state.h);

    // Claimed cells glow faintly until they're hit.
    for (const s of result.shots) {
      const v = this.cellViews[s.y * this.state.w + s.x];
      if (!v) continue;
      const { x, y } = this.cellCenter(s.x, s.y);
      const claim = this.add.graphics();
      claim.lineStyle(2, 0xffffff, 0.7);
      claim.strokeRect(x - this.L.cell / 2 + 2, y - this.L.cell / 2 + 2, this.L.cell - 4, this.L.cell - 4);
      this.board.add(claim);
      v.claim?.destroy();
      v.claim = claim;
    }

    this.tweens.add({
      targets: comet,
      x: cx,
      y: cy + b,
      duration: ENTRY_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (gen !== this.generation) return;
        // Each shot fires when the comet passes its row or column. One tween drives both the
        // motion and the shots, so they can never drift apart (even on a slow phone).
        const shots = result.shots
          .map((s) => ({ s, at: (this.stepPoint(steps[s.step].side, steps[s.step].line).theta - Math.PI / 2) / (Math.PI * 2) }))
          .sort((p, q) => p.at - q.at);
        let next = 0;
        let charge = result.comet.charge;
        const fireUpTo = (v: number) => {
          while (next < shots.length && shots[next].at <= v) {
            const { s } = shots[next++];
            charge--;
            this.setCharge(comet, charge);
            this.fireShot(comet, s.x, s.y);
          }
        };
        this.tweens.addCounter({
          from: 0,
          to: 1,
          duration: LAP_MS,
          onUpdate: (tw) => {
            if (gen !== this.generation) return;
            const v = tw.getValue() ?? 0;
            const th = Math.PI / 2 + v * Math.PI * 2;
            comet.setPosition(cx + a * Math.cos(th), cy + b * Math.sin(th));
            fireUpTo(v);
          },
          onComplete: () => {
            if (gen !== this.generation) return;
            fireUpTo(1);
            this.finishLap(comet, result);
          },
        });
      },
    });
  }

  private fireShot(comet: Phaser.GameObjects.Container, x: number, y: number): void {
    const target = this.cellCenter(x, y);
    const beam = this.add.graphics();
    beam.lineStyle(3, 0xffffff, 0.85);
    beam.beginPath();
    beam.moveTo(comet.x, comet.y);
    beam.lineTo(target.x, target.y);
    beam.strokePath();
    this.fxLayer.add(beam);
    this.tweens.add({ targets: beam, alpha: 0, duration: 160, onComplete: () => beam.destroy() });

    const idx = y * this.state.w + x;
    const v = this.cellViews[idx];
    if (!v) return;
    this.cellViews[idx] = null;
    v.claim?.destroy();
    v.glyph.destroy();
    this.tweens.add({ targets: v.rect, scale: 0.2, alpha: 0, duration: 140, onComplete: () => v.rect.destroy() });
    const star = this.add.graphics();
    drawStar(star, target.x, target.y, Math.max(4, this.L.cell * 0.22));
    star.setAlpha(0);
    this.board.add(star);
    this.tweens.add({ targets: star, alpha: 1, duration: 180 });
  }

  private finishLap(comet: Phaser.GameObjects.Container, result: LaunchResult): void {
    const gen = this.generation;
    if (result.parkedSlot !== null) {
      const slot = result.parkedSlot;
      const p = this.L.dock[slot];
      this.tweens.add({
        targets: comet,
        x: p.x,
        y: p.y,
        duration: PARK_MS,
        ease: 'Quad.easeOut',
        onComplete: () => {
          if (gen !== this.generation) return;
          this.fxLayer.remove(comet);
          this.dockLayer.add(comet);
          this.dockViews[slot] = comet;
          this.pendingDock.delete(slot);
          this.landed();
        },
      });
    } else if (result.leftover > 0) {
      // Couldn't park: the Dock was full. Leave it hovering at the gate, dimmed.
      comet.setAlpha(0.6);
      this.landed();
    } else {
      this.burst(comet.x, comet.y, COLOR_HEX[result.comet.color]);
      comet.destroy();
      this.landed();
    }
  }

  private burst(x: number, y: number, color: number): void {
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      const p = this.add.circle(x, y, 4, i % 2 ? color : 0xffffff, 0.9);
      this.fxLayer.add(p);
      this.tweens.add({ targets: p, x: x + Math.cos(ang) * 40, y: y + Math.sin(ang) * 40, alpha: 0, duration: 380, onComplete: () => p.destroy() });
    }
  }

  private landed(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.refreshDockSlots();
    if (this.inFlight === 0 && this.state.status !== 'playing') this.showEnd();
  }

  // ───────────────────────────── overlays ─────────────────────────────

  /** A dimmed sheet with a box centered at `cy` (the end-of-level box sits low so the picture stays in view). */
  private panel(height: number, cy = GAME_H / 2, shadeAlpha = 0.62): Phaser.GameObjects.Container {
    const c = this.add.container(0, 0);
    const shade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x05081a, shadeAlpha).setInteractive();
    const box = this.add.rectangle(GAME_W / 2, cy, 560, height, 0x161f4a, 0.97).setStrokeStyle(3, PAL.orbit, 0.6);
    c.add([shade, box]);
    return c;
  }

  private button(c: Phaser.GameObjects.Container, x: number, y: number, label: string, primary: boolean, fn: () => void): void {
    const bg = this.add
      .rectangle(x, y, 230, 76, primary ? 0xffd23f : 0x2a3570)
      .setStrokeStyle(2, PAL.orbit, primary ? 0 : 0.6)
      .setInteractive({ useHandCursor: true });
    const t = this.add
      .text(x, y, label, { fontFamily: 'system-ui, sans-serif', fontSize: '30px', fontStyle: 'bold', color: primary ? PAL.inkCss : PAL.text })
      .setOrigin(0.5);
    bg.on('pointerdown', fn);
    c.add([bg, t]);
  }

  private showEnd(): void {
    if (this.overlay) return;
    const won = this.state.status === 'won';
    // Low on the screen so the picture stays visible (and, when stuck, the full Dock above it).
    const cy = won ? GAME_H - 210 : GAME_H - 130;
    const c = this.panel(won ? 340 : 250, cy, 0.4);
    const style = { fontFamily: 'system-ui, sans-serif', color: PAL.text, align: 'center' } as const;
    if (won) {
      if (!this.progress.completed.includes(this.levelIndex)) this.progress.completed.push(this.levelIndex);
      saveProgress(this.progress);
      c.add(this.add.text(GAME_W / 2, cy - 105, 'The sky lights up!', { ...style, fontSize: '42px', fontStyle: 'bold' }).setOrigin(0.5));
      c.add(this.add.text(GAME_W / 2, cy - 50, `${this.level.name} — ${this.state.moves} launches`, { ...style, fontSize: '26px', color: PAL.textDim }).setOrigin(0.5));
      const last = this.levelIndex >= LEVELS.length - 1;
      this.button(c, GAME_W / 2 - 130, cy + 75, 'Replay', false, () => this.loadLevel(this.levelIndex));
      this.button(c, GAME_W / 2 + 130, cy + 75, last ? 'Levels' : 'Next', true, () =>
        last ? this.showLevelMenu() : this.loadLevel(this.levelIndex + 1),
      );
    } else {
      const reason =
        this.state.stuckReason === 'dock-full'
          ? 'A comet had nowhere to park —\nthe Dock was full.'
          : `Not enough ${this.deadColorName()} comets left\nto clear the rest.`;
      c.add(this.add.text(GAME_W / 2, cy - 85, 'Stuck', { ...style, fontSize: '44px', fontStyle: 'bold' }).setOrigin(0.5));
      c.add(this.add.text(GAME_W / 2, cy - 18, reason, { ...style, fontSize: '26px', color: PAL.textDim }).setOrigin(0.5));
      this.button(c, GAME_W / 2 - 130, cy + 72, 'Levels', false, () => this.showLevelMenu());
      this.button(c, GAME_W / 2 + 130, cy + 72, 'Retry', true, () => this.loadLevel(this.levelIndex));
    }
    this.overlay = c;
  }

  private deadColorName(): string {
    const dust = new Map<string, number>();
    for (const c of this.state.cells) if (c) dust.set(c, (dust.get(c) ?? 0) + 1);
    const charge = new Map<string, number>();
    const add = (c: Comet | null) => { if (c) charge.set(c.color, (charge.get(c.color) ?? 0) + c.charge); };
    this.state.rails.forEach((r) => r.forEach(add));
    this.state.dock.forEach(add);
    for (const [c, n] of dust) if ((charge.get(c) ?? 0) < n) return COLOR_NAMES[c as keyof typeof COLOR_NAMES].toLowerCase();
    return '';
  }

  showLevelMenu(): void {
    this.overlay?.destroy();
    const c = this.panel(820);
    c.add(
      this.add
        .text(GAME_W / 2, GAME_H / 2 - 350, 'Levels', { fontFamily: 'system-ui, sans-serif', fontSize: '40px', fontStyle: 'bold', color: PAL.text })
        .setOrigin(0.5),
    );
    LEVELS.forEach((lv, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = GAME_W / 2 + (col - 1.5) * 120;
      const y = GAME_H / 2 - 240 + row * 120;
      const done = this.progress.completed.includes(i);
      const tint = lv.badge === 'starfall' ? 0x5a4a10 : lv.badge === 'tricky' ? 0x3a4366 : 0x2a3570;
      const bg = this.add.rectangle(x, y, 100, 100, tint).setStrokeStyle(3, i === this.levelIndex ? 0xffd23f : PAL.orbit, i === this.levelIndex ? 1 : 0.4).setInteractive({ useHandCursor: true });
      const t = this.add.text(x, y - 6, String(i + 1), { fontFamily: 'system-ui, sans-serif', fontSize: '34px', fontStyle: 'bold', color: PAL.text }).setOrigin(0.5);
      c.add([bg, t]);
      if (done) {
        const g = this.add.graphics();
        drawStar(g, x, y + 32, 9);
        c.add(g);
      }
      bg.on('pointerdown', () => this.loadLevel(i));
    });
    this.button(c, GAME_W / 2, GAME_H / 2 + 340, 'Close', false, () => {
      c.destroy();
      this.overlay = null;
      if (this.state.status !== 'playing' && this.inFlight === 0) this.showEnd();
    });
    this.overlay = c;
  }
}

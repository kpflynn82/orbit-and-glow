// The gray-box play screen (M1). Rules live in ../engine; this file only draws and animates.
//
// Logic is resolved the instant a comet is launched (order, not timing). The animation then
// replays what happened: the comet rides the oval orbit and each shot fires when it passes the
// row or column it hit.
//
// Only one comet is on the orbit at a time. Comets tapped while another is flying wait their turn
// beside the entry gate (up to the level's ring capacity) and the lap speeds up while others wait.
// That keeps the picture honest: the rules resolve each lap against the board as the earlier
// comets leave it, so letting laps overlap on screen would show comets firing through blocks
// that hadn't cleared yet, or passing cells of their color without firing.

import Phaser from 'phaser';
import { applyMove, canFuse, cometFor, createState, deadEndColor, lapSteps } from '../engine/engine';
import type { Comet, FuseResult, GameState, LaunchResult, LevelData, Move, Side } from '../engine/types';
import { COLOR_NAMES } from '../engine/types';
import { LEVELS } from '../levels';
import { COLOR_HEX, PAL, drawGlyph, drawStar } from './palette';
import { loadProgress, saveProgress, type Progress } from './progress';

export const GAME_W = 720;
export const GAME_H = 1280;

const LAP_MS = 1900;
const LAP_FAST_MS = 1150; // when other comets are waiting their turn
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
  private orbitBusy = false;
  private waiting: { comet: Phaser.GameObjects.Container; run: () => void }[] = [];
  // Fusion: dragging a docked comet, fusions still animating, and a comet waiting to park.
  private drag: { slot: number; x0: number; y0: number; moved: boolean } | null = null;
  private fusing = 0;
  private heldView: Phaser.GameObjects.Container | null = null;
  private heldArrived = false;
  private heldSlot: number | null = null;
  private linkGfx: Phaser.GameObjects.Graphics | null = null;
  private tipText: Phaser.GameObjects.Container | null = null;
  private hintText: Phaser.GameObjects.Text | null = null;

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
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onDragMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onDragEnd(p));
    this.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => this.onDragEnd(p));
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
    this.orbitBusy = false;
    this.waiting = [];
    this.drag = null;
    this.fusing = 0;
    this.heldView = null;
    this.heldArrived = false;
    this.heldSlot = null;
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
      // Tap = launch it again. Drag onto another docked comet = fuse (in levels with fusion).
      hit.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
        if (this.overlay || !this.state.dock[i] || this.pendingDock.has(i) || !this.dockViews[i]) return;
        this.drag = { slot: i, x0: ptr.x, y0: ptr.y, moved: false };
      });
      this.dockLayer.add(hit);
    });
    this.linkGfx = this.add.graphics();
    this.dockLayer.addAt(this.linkGfx, 0);
    this.refreshDockSlots();
  }

  private slotAt(x: number, y: number, except: number): number {
    let best = -1;
    let bestD = FRONT_R + 30;
    this.L.dock.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (i !== except && d < bestD) { best = i; bestD = d; }
    });
    return best;
  }

  private onDragMove(p: Phaser.Input.Pointer): void {
    const d = this.drag;
    if (!d) return;
    const view = this.dockViews[d.slot];
    if (!view) { this.drag = null; return; }
    if (!d.moved && this.state.fusion && Math.hypot(p.x - d.x0, p.y - d.y0) > 16) d.moved = true;
    if (d.moved) view.setPosition(p.x, p.y);
  }

  private onDragEnd(p: Phaser.Input.Pointer): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (!d.moved) {
      this.tryMove({ kind: 'dock', slot: d.slot });
      return;
    }
    const target = this.slotAt(p.x, p.y, d.slot);
    if (target >= 0 && this.tryFuse(d.slot, target)) return;
    const view = this.dockViews[d.slot];
    const home = this.L.dock[d.slot];
    if (view) this.tweens.add({ targets: view, x: home.x, y: home.y, duration: 160, ease: 'Quad.easeOut' });
    if (target >= 0 && this.state.dock[target]) {
      if (this.pendingDock.has(target) || this.pendingDock.has(d.slot)) this.showHint('Wait for that comet to land, then fuse.');
      else this.showHint('Only two different colors of Red, Yellow and Blue can fuse.');
    }
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
    // A faint link between docked comets that could fuse (teaches the move).
    const lg = this.linkGfx;
    if (!lg) return;
    lg.clear();
    if (!this.state.fusion || this.state.status !== 'playing') return;
    for (let i = 0; i < this.L.dock.length; i++)
      for (let j = i + 1; j < this.L.dock.length; j++) {
        if (!canFuse(this.state, i, j) || this.pendingDock.has(i) || this.pendingDock.has(j)) continue;
        const a = this.L.dock[i];
        const b = this.L.dock[j];
        lg.lineStyle(4, 0xffffff, this.state.holding ? 0.6 : 0.35);
        if (j === i + 1) {
          lg.beginPath();
          lg.moveTo(a.x, a.y);
          lg.lineTo(b.x, b.y);
          lg.strokePath();
        } else {
          // Not neighbours: arc below the Dock so the link doesn't run through the comet between.
          const mid = new Phaser.Math.Vector2((a.x + b.x) / 2, Math.max(a.y, b.y) + 58 + (j - i) * 6);
          new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(a.x, a.y + FRONT_R), mid, new Phaser.Math.Vector2(b.x, b.y + FRONT_R)).draw(lg, 24);
        }
      }
  }

  private showHint(msg: string): void {
    const t = this.hintText;
    if (!t) return;
    t.setText(msg);
    this.tweens.killTweensOf(t);
    t.setAlpha(1);
    if (!this.state.holding) this.tweens.add({ targets: t, alpha: 0, delay: 2600, duration: 500 });
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
      const bg = this.add.circle(x, 48, 32, 0xffffff, 0.08).setStrokeStyle(2, PAL.orbit, 0.5);
      const t = this.add.text(x, 48, label, { ...style, fontSize: '32px' }).setOrigin(0.5);
      // The tap area is larger than the drawn circle (about 48 points on a phone).
      const hit = this.add.circle(x, 48, 44, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', fn);
      this.hud.add([bg, t, hit]);
    };
    mk(GAME_W - 52, '↻', () => this.loadLevel(this.levelIndex));
    mk(GAME_W - 144, '≡', () => this.showLevelMenu());

    // The level's coach tip, until the first move.
    this.tipText = null;
    if (this.level.tip) {
      const top = this.level.badge !== 'normal' ? 104 : 86;
      const t = this.add.text(GAME_W / 2, top + 14, this.level.tip, {
        ...style, fontSize: '23px', align: 'center', wordWrap: { width: 600 }, lineSpacing: 4,
      }).setOrigin(0.5, 0);
      const bg = this.add.rectangle(GAME_W / 2, top, 640, t.height + 28, 0x0b1026, 0.82).setOrigin(0.5, 0).setStrokeStyle(2, PAL.orbit, 0.35);
      this.tipText = this.add.container(0, 0, [bg, t]);
      this.hud.add(this.tipText);
    }
    // Short messages (Dock full, can't fuse…), between the Dock and the rails.
    this.hintText = this.add.text(GAME_W / 2, 1031, '', { ...style, fontSize: '21px', color: PAL.text, align: 'center' }).setOrigin(0.5).setAlpha(0);
    this.hud.add(this.hintText);
  }

  /** The coach tip fades on the first move — or, on levels that teach fusion, dims and stays
   *  until the first fusion (fusion is often needed many launches in). */
  private fadeTip(trigger: 'launch' | 'fuse' = 'launch'): void {
    const t = this.tipText;
    if (!t) return;
    if (this.level.tipUntil === 'fuse' && trigger !== 'fuse') {
      if (t.alpha > 0.7) this.tweens.add({ targets: t, alpha: 0.6, duration: 400 });
      return;
    }
    this.tipText = null;
    this.tweens.add({ targets: t, alpha: 0, duration: 500, onComplete: () => t.destroy() });
  }

  // ───────────────────────────── playing ─────────────────────────────

  /** Positions of tappable things, in game coordinates (used by the playtest bot). */
  pointFor(move: Move): { x: number; y: number } {
    if (move.kind === 'rail') return { x: this.L.railX[move.rail], y: this.L.railFrontY };
    if (move.kind === 'dock') return this.L.dock[move.slot];
    return this.L.dock[move.from];
  }

  slotPoint(slot: number): { x: number; y: number } {
    return this.L.dock[slot];
  }

  busy(): boolean {
    return this.inFlight > 0 || this.fusing > 0 || (this.heldSlot !== null && this.heldView !== null);
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
    if (move.kind === 'fuse') return this.tryFuse(move.from, move.onto);
    const comet = cometFor(this.state, move);
    if (!comet) {
      if (this.state.holding) {
        this.cameras.main.shake(120, 0.003);
        this.showHint('The Dock is full. Drag two comets together to make room.');
      }
      return false;
    }
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
    this.fadeTip();
    if (result.parkedSlot !== null) this.pendingDock.add(result.parkedSlot);
    this.drawRails();
    this.refreshDockSlots();
    this.animateLaunch(launched, result as LaunchResult);
    return true;
  }

  /** Fuse the docked comet in `from` into the one in `onto` (drag-and-drop or the test hook). */
  tryFuse(from: number, onto: number): boolean {
    if (this.overlay || this.state.status !== 'playing') return false;
    if (!canFuse(this.state, from, onto) || this.pendingDock.has(from) || this.pendingDock.has(onto)) return false;
    const a = this.dockViews[from];
    const b = this.dockViews[onto];
    if (!a || !b) return false;
    const gen = this.generation;
    const { state, result } = applyMove(this.state, { kind: 'fuse', from, onto });
    const fr = result as FuseResult;
    this.state = state;
    this.fadeTip('fuse');
    this.fusing++;
    this.dockViews[from] = null;
    this.pendingDock.add(onto);
    if (fr.parkedSlot !== null) this.pendingDock.add(fr.parkedSlot);
    this.refreshDockSlots();
    const target = this.L.dock[onto];
    this.tweens.add({
      targets: a,
      x: target.x,
      y: target.y,
      scale: 0.7,
      duration: 200,
      ease: 'Quad.easeIn',
      onComplete: () => {
        if (gen !== this.generation) return;
        a.destroy();
        b.destroy();
        const made = this.makeComet(fr.comet, FRONT_R).setPosition(target.x, target.y).setScale(0.5);
        this.dockLayer.add(made);
        this.dockViews[onto] = made;
        this.burst(target.x, target.y, COLOR_HEX[fr.comet.color]);
        this.tweens.add({
          targets: made,
          scale: 1,
          duration: 260,
          ease: 'Back.easeOut',
          onComplete: () => {
            if (gen !== this.generation) return;
            this.pendingDock.delete(onto);
            this.fusing--;
            this.refreshDockSlots();
            if (fr.parkedSlot !== null) this.parkHeld(fr.parkedSlot);
            this.checkEnd();
          },
        });
      },
    });
    return true;
  }

  /** A fusion made room: the comet that was waiting (or is still on its lap) parks in `slot`. */
  private parkHeld(slot: number): void {
    this.heldSlot = slot;
    const view = this.heldView;
    if (!view || !this.heldArrived) return; // it will park when its lap ends (finishLap)
    const gen = this.generation;
    const p = this.L.dock[slot];
    this.tweens.killTweensOf(view);
    this.tweens.add({
      targets: view,
      x: p.x,
      y: p.y,
      alpha: 1,
      scale: 1,
      duration: PARK_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (gen !== this.generation) return;
        this.fxLayer.remove(view);
        this.dockLayer.add(view);
        this.dockViews[slot] = view;
        this.pendingDock.delete(slot);
        this.heldView = null;
        this.heldArrived = false;
        this.heldSlot = null;
        if (this.hintText) this.tweens.add({ targets: this.hintText, alpha: 0, duration: 300 });
        this.refreshDockSlots();
        this.checkEnd();
      },
    });
  }

  private checkEnd(): void {
    if (this.state.status !== 'playing' && this.inFlight === 0 && this.fusing === 0) this.showEnd();
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

  /** Where the k-th waiting comet sits, just inside the orbit above the entry gate. */
  private waitSpot(k: number): { x: number; y: number } {
    return { x: this.L.cx + (k - 1) * 66, y: this.L.cy + this.L.b - 80 };
  }

  private animateLaunch(comet: Phaser.GameObjects.Container, result: LaunchResult): void {
    const gen = this.generation;
    this.inFlight++;

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

    const run = () => this.flyLap(comet, result, gen);
    if (!this.orbitBusy && this.waiting.length === 0) {
      this.orbitBusy = true;
      run();
    } else {
      // Wait beside the gate for the comet ahead to finish its lap.
      const spot = this.waitSpot(this.waiting.length);
      this.waiting.push({ comet, run });
      this.tweens.add({ targets: comet, x: spot.x, y: spot.y, scale: 0.8, duration: ENTRY_MS, ease: 'Quad.easeOut' });
    }
  }

  private nextInLine(): void {
    const next = this.waiting.shift();
    if (!next) return;
    this.orbitBusy = true;
    this.waiting.forEach((w, k) => this.tweens.add({ targets: w.comet, ...this.waitSpot(k), duration: 200, ease: 'Quad.easeOut' }));
    next.run();
  }

  private flyLap(comet: Phaser.GameObjects.Container, result: LaunchResult, gen: number): void {
    const { cx, cy, a, b } = this.L;
    const steps = lapSteps(this.state.w, this.state.h);
    this.tweens.add({
      targets: comet,
      x: cx,
      y: cy + b,
      scale: 1,
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
        let done = false;
        const finish = () => {
          done = true;
          this.orbitBusy = false;
          this.finishLap(comet, result);
          this.nextInLine();
        };
        this.tweens.addCounter({
          from: 0,
          to: 1,
          duration: this.waiting.length > 0 ? LAP_FAST_MS : LAP_MS,
          onUpdate: (tw) => {
            if (gen !== this.generation || done) return;
            const v = tw.getValue() ?? 0;
            const th = Math.PI / 2 + v * Math.PI * 2;
            comet.setPosition(cx + a * Math.cos(th), cy + b * Math.sin(th));
            fireUpTo(v);
            // Out of charge: it bursts right after its last hit instead of finishing the lap.
            if (result.leftover === 0 && next === shots.length) {
              tw.stop();
              finish();
            }
          },
          onComplete: () => {
            if (gen !== this.generation || done) return;
            fireUpTo(1);
            finish();
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
    if (result.held) {
      // The Dock was full but a fusion can make room: wait just inside the gate.
      this.heldView = comet;
      this.heldArrived = true;
      this.landed();
      if (this.heldSlot !== null) {
        this.parkHeld(this.heldSlot);
        return;
      }
      const spot = this.waitSpot(1);
      this.tweens.add({ targets: comet, x: spot.x, y: spot.y, duration: PARK_MS, ease: 'Quad.easeOut' });
      this.tweens.add({ targets: comet, scale: 1.12, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.showHint('The Dock is full. Drag two comets together to make room.');
      this.refreshDockSlots();
      return;
    }
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
      // Couldn't park: the Dock was full. It hovers just inside the gate, dimmed, above the Dock.
      const spot = this.waitSpot(1);
      this.tweens.add({ targets: comet, x: spot.x, y: spot.y, alpha: 0.6, duration: PARK_MS, ease: 'Quad.easeOut' });
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
    this.checkEnd();
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
      c.add(this.add.text(GAME_W / 2, cy - 50, `${this.level.name} — ${this.state.moves} moves`, { ...style, fontSize: '26px', color: PAL.textDim }).setOrigin(0.5));
      const last = this.levelIndex >= LEVELS.length - 1;
      this.button(c, GAME_W / 2 - 130, cy + 75, 'Replay', false, () => this.loadLevel(this.levelIndex));
      this.button(c, GAME_W / 2 + 130, cy + 75, last ? 'Levels' : 'Next', true, () =>
        last ? this.showLevelMenu() : this.loadLevel(this.levelIndex + 1),
      );
    } else {
      const reason =
        this.state.stuckReason === 'dock-full'
          ? 'A comet had nowhere to park —\nthe Dock was full.'
          : this.state.fusion
            ? `Not enough ${this.deadColorName()} left — in comets\nor fusions — to clear the rest.`
            : `Not enough ${this.deadColorName()} comets left\nto clear the rest.`;
      c.add(this.add.text(GAME_W / 2, cy - 85, 'Stuck', { ...style, fontSize: '44px', fontStyle: 'bold' }).setOrigin(0.5));
      c.add(this.add.text(GAME_W / 2, cy - 18, reason, { ...style, fontSize: '26px', color: PAL.textDim }).setOrigin(0.5));
      this.button(c, GAME_W / 2 - 130, cy + 72, 'Levels', false, () => this.showLevelMenu());
      this.button(c, GAME_W / 2 + 130, cy + 72, 'Retry', true, () => this.loadLevel(this.levelIndex));
    }
    this.overlay = c;
  }

  private deadColorName(): string {
    const c = deadEndColor(this.state);
    return c ? COLOR_NAMES[c].toLowerCase() : '';
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

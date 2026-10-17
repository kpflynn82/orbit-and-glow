// Colors and color-blind glyphs from the Codex art brief (prototype spec §5).
import type Phaser from 'phaser';
import type { Color } from '../engine/types';

export const PAL = {
  skyTop: 0x0b1026,
  skyBottom: 0x1e2a5e,
  orbit: 0xa9b8ff,
  dock: 0x2a3570,
  dockRim: 0xa9b8ff,
  star: 0xffffff,
  starHalo: 0x9ee7ff,
  amber: 0xffb347,
  ink: 0x0b1026,
  text: '#F4F1FF',
  textDim: '#A9B8FF',
  inkCss: '#0B1026',
} as const;

export const COLOR_HEX: Record<Color, number> = {
  R: 0xff5a5f,
  Y: 0xffd23f,
  B: 0x3d8bff,
  O: 0xff9f1c,
  G: 0x3ddc97,
  P: 0xa06cff,
  W: 0xd9ddf0,
  S: 0x7d8bb0,
};

type Glyph = 'circle' | 'triangle' | 'square' | 'diamond' | 'plus';

/** Primaries and neutrals have one glyph; secondaries show both parent glyphs (teaches fusion). */
export const GLYPHS: Record<Color, Glyph[]> = {
  R: ['circle'],
  Y: ['triangle'],
  B: ['square'],
  W: ['diamond'],
  S: ['plus'],
  O: ['circle', 'triangle'],
  G: ['triangle', 'square'],
  P: ['circle', 'square'],
};

function drawOne(g: Phaser.GameObjects.Graphics, glyph: Glyph, x: number, y: number, r: number): void {
  switch (glyph) {
    case 'circle':
      g.fillCircle(x, y, r);
      break;
    case 'triangle':
      g.fillTriangle(x, y - r * 1.1, x - r * 1.05, y + r * 0.75, x + r * 1.05, y + r * 0.75);
      break;
    case 'square':
      g.fillRect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
      break;
    case 'diamond':
      g.fillTriangle(x, y - r * 1.15, x - r * 0.9, y, x + r * 0.9, y);
      g.fillTriangle(x, y + r * 1.15, x - r * 0.9, y, x + r * 0.9, y);
      break;
    case 'plus':
      g.fillRect(x - r * 0.35, y - r, r * 0.7, r * 2);
      g.fillRect(x - r, y - r * 0.35, r * 2, r * 0.7);
      break;
  }
}

/** Draw a color's glyph(s) centered at (x, y), each about `r` in radius. */
export function drawGlyph(
  g: Phaser.GameObjects.Graphics, color: Color, x: number, y: number, r: number, fill: number, alpha: number,
): void {
  g.fillStyle(fill, alpha);
  const glyphs = GLYPHS[color];
  if (glyphs.length === 1) drawOne(g, glyphs[0], x, y, r);
  else {
    drawOne(g, glyphs[0], x - r * 1.15, y, r * 0.8);
    drawOne(g, glyphs[1], x + r * 1.15, y, r * 0.8);
  }
}

/** A small four-point star (a cleared dust cell). */
export function drawStar(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, alpha = 1): void {
  g.fillStyle(PAL.starHalo, 0.18 * alpha);
  g.fillCircle(x, y, r * 1.1);
  g.fillStyle(PAL.star, 0.95 * alpha);
  g.fillTriangle(x, y - r, x - r * 0.22, y, x + r * 0.22, y);
  g.fillTriangle(x, y + r, x - r * 0.22, y, x + r * 0.22, y);
  g.fillTriangle(x - r, y, x, y - r * 0.22, x, y + r * 0.22);
  g.fillTriangle(x + r, y, x, y - r * 0.22, x, y + r * 0.22);
}

import Phaser from 'phaser';
import { GAME_H, GAME_W, GameScene } from './game/GameScene';
import type { Move } from './engine/types';

const scene = new GameScene();

// `?canvas` forces the simple Canvas renderer (used by the headless playtest, which has no GPU).
const forceCanvas = new URLSearchParams(window.location.search).has('canvas');

const game = new Phaser.Game({
  type: forceCanvas ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#0b1026',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true },
  scene: [scene],
});

// A small test hook so the playtest bot can find where to tap and read the game state.
// It never changes the rules; it only reports what's on screen.
declare global {
  interface Window {
    __orbit?: {
      ready: () => boolean;
      level: () => number;
      status: () => string;
      busy: () => boolean;
      flying: () => number;
      /** Launches made so far on this level. */
      moves: () => number;
      speed: (n: number) => void;
      load: (i: number) => void;
      /** Where a move's comet sits, in page pixels (for real clicks). */
      screenPoint: (m: Move) => { x: number; y: number };
    };
  }
}

window.__orbit = {
  ready: () => Boolean(scene.state),
  level: () => scene.levelIndex,
  status: () => scene.state?.status ?? 'loading',
  busy: () => scene.busy(),
  flying: () => scene.flying(),
  moves: () => scene.state?.moves ?? 0,
  speed: (n) => scene.setSpeed(n),
  load: (i) => scene.loadLevel(i),
  screenPoint: (m) => {
    const p = scene.pointFor(m);
    const rect = game.canvas.getBoundingClientRect();
    return {
      x: rect.left + (p.x / GAME_W) * rect.width,
      y: rect.top + (p.y / GAME_H) * rect.height,
    };
  },
};

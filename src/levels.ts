// All level files, in order. Built by tools/generate-levels.ts; checked by tests/levels.test.ts.
import type { LevelData } from './engine/types';

const modules = import.meta.glob<LevelData>('../levels/level-*.json', { eager: true, import: 'default' });

export const LEVELS: LevelData[] = Object.keys(modules)
  .sort()
  .map((k) => modules[k]);

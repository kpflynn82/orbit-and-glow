// Per-player progress in this browser. Storage can be missing or blocked (private windows,
// previews), so every read and write is wrapped and the game works without it.
// v2: chapter 1 was rebuilt (honest difficulty + fusion), so old stars don't carry over.
const KEY = 'orbit-glow-progress-v2';

export interface Progress {
  completed: number[]; // level indexes
  lastLevel: number;
}

export function loadProgress(): Progress {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Progress>;
      return { completed: Array.isArray(p.completed) ? p.completed : [], lastLevel: Number(p.lastLevel) || 0 };
    }
  } catch {
    /* storage unavailable */
  }
  return { completed: [], lastLevel: 0 };
}

export function saveProgress(p: Progress): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

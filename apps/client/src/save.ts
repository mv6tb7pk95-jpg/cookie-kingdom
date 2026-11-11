import { migrateState, newGameState, type GameState } from "@ck/shared";

// Same key as before so existing v1 saves are migrated, not lost.
const KEY = "ck_save_v1";

export function loadState(): GameState {
  try {
    const s = localStorage.getItem(KEY);
    if (s) {
      const m = migrateState(JSON.parse(s));
      if (m) return m;
    }
  } catch {
    /* corrupted save: start fresh */
  }
  return newGameState();
}

export function saveState(state: GameState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full etc. */
  }
}

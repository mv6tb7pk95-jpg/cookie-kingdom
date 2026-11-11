import { newGameState, type GameState } from "@ck/shared";

const KEY = "ck_save_v1";

export function loadState(): GameState {
  try {
    const s = localStorage.getItem(KEY);
    if (s) {
      const parsed = JSON.parse(s) as GameState;
      if (parsed.version === 1 && Array.isArray(parsed.buildings) && parsed.resources) return parsed;
    }
  } catch {
    /* 손상된 저장은 무시하고 새로 시작 */
  }
  return newGameState();
}

export function saveState(state: GameState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 저장 공간 부족 등은 무시 */
  }
}

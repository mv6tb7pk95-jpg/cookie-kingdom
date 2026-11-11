import { GRID_SIZE, type BuildingDef } from "./index";

export type ResourceId = "coin" | "crystal" | "material";

export const MAX_LEVEL = 5;
/** 수확하지 않고 쌓아둘 수 있는 최대 생산 주기 수 */
export const STORAGE_CYCLES = 8;

export interface PlacedBuilding {
  uid: string;
  defId: string;
  x: number;
  y: number;
  level: number;
  /** 마지막 수확 기준 시각 (ms epoch) */
  lastCollected: number;
}

export interface OwnedCharacter {
  level: number;
  stars: number;
  shards: number;
}

export interface GachaState {
  pullsTotal: number;
  /** pulls since the last epic-or-better */
  sinceEpic: number;
  /** pulls since the last legendary */
  sinceLegendary: number;
}

export interface GameState {
  version: 2;
  resources: Record<ResourceId, number>;
  buildings: PlacedBuilding[];
  nextId: number;
  roster: Record<string, OwnedCharacter>;
  gacha: GachaState;
  /** stage id -> best star rating (1-3) */
  cleared: Record<string, number>;
  /** character ids sent into battle (max 5) */
  team: string[];
}

export function newGameState(): GameState {
  return {
    version: 2,
    resources: { coin: 500, crystal: 30, material: 0 },
    buildings: [],
    nextId: 1,
    roster: {},
    gacha: { pullsTotal: 0, sinceEpic: 0, sinceLegendary: 0 },
    cleared: {},
    team: [],
  };
}

/** Accepts a v1 or v2 save and returns a v2 state, or null if it is not a usable save. */
export function migrateState(raw: unknown): GameState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const version = s.version;
  if ((version !== 1 && version !== 2) || !s.resources || !Array.isArray(s.buildings)) return null;
  const base = newGameState();
  const buildings = s.buildings as PlacedBuilding[];
  const isV2 = version === 2;
  return {
    version: 2,
    resources: { ...base.resources, ...(s.resources as Partial<Record<ResourceId, number>>) },
    buildings,
    nextId: typeof s.nextId === "number" ? s.nextId : buildings.length + 1,
    roster: isV2 && s.roster && typeof s.roster === "object" ? (s.roster as Record<string, OwnedCharacter>) : {},
    gacha: isV2 && s.gacha ? { ...base.gacha, ...(s.gacha as Partial<GachaState>) } : base.gacha,
    cleared: isV2 && s.cleared && typeof s.cleared === "object" ? (s.cleared as Record<string, number>) : {},
    team: isV2 && Array.isArray(s.team) ? (s.team as string[]) : [],
  };
}

export function findDef(defs: BuildingDef[], id: string): BuildingDef | undefined {
  return defs.find((d) => d.id === id);
}

/** 맵 범위 안이며 다른 건물과 겹치지 않는지 검사 */
export function canPlace(
  state: GameState,
  defs: BuildingDef[],
  def: BuildingDef,
  x: number,
  y: number,
  ignoreUid?: string,
): boolean {
  if (x < 0 || y < 0 || x + def.size.w > GRID_SIZE || y + def.size.h > GRID_SIZE) return false;
  for (const b of state.buildings) {
    if (b.uid === ignoreUid) continue;
    const o = findDef(defs, b.defId);
    if (!o) continue;
    const overlap =
      x < b.x + o.size.w && x + def.size.w > b.x && y < b.y + o.size.h && y + def.size.h > b.y;
    if (overlap) return false;
  }
  return true;
}

export function productionPerCycle(def: BuildingDef, level: number): number {
  if (!def.produces) return 0;
  return Math.floor(def.produces.amount * (1 + 0.5 * (level - 1)));
}

function readyCycles(b: PlacedBuilding, def: BuildingDef, now: number): number {
  if (!def.produces) return 0;
  const ms = def.produces.seconds * 1000;
  return Math.min(STORAGE_CYCLES, Math.floor(Math.max(0, now - b.lastCollected) / ms));
}

/** 지금 수확 가능한 양 (오프라인 경과 시간 포함) */
export function pendingYield(b: PlacedBuilding, def: BuildingDef, now: number): number {
  return readyCycles(b, def, now) * productionPerCycle(def, b.level);
}

/** 수확하고 획득량을 반환 */
export function collectYield(state: GameState, b: PlacedBuilding, def: BuildingDef, now: number): number {
  if (!def.produces) return 0;
  const c = readyCycles(b, def, now);
  if (c === 0) return 0;
  const gained = c * productionPerCycle(def, b.level);
  state.resources[def.produces.resource] += gained;
  b.lastCollected = c >= STORAGE_CYCLES ? now : b.lastCollected + c * def.produces.seconds * 1000;
  return gained;
}

export function upgradeCost(def: BuildingDef, level: number): number {
  return def.cost.coin * level * 2;
}

export function sellRefund(def: BuildingDef): number {
  return Math.floor(def.cost.coin * 0.5);
}

export function placeBuilding(
  state: GameState,
  defs: BuildingDef[],
  def: BuildingDef,
  x: number,
  y: number,
  now: number,
): PlacedBuilding | null {
  if (state.resources.coin < def.cost.coin) return null;
  if (!canPlace(state, defs, def, x, y)) return null;
  state.resources.coin -= def.cost.coin;
  const b: PlacedBuilding = { uid: `b${state.nextId++}`, defId: def.id, x, y, level: 1, lastCollected: now };
  state.buildings.push(b);
  return b;
}

export function upgradeBuilding(state: GameState, def: BuildingDef, b: PlacedBuilding, now: number): boolean {
  if (b.level >= MAX_LEVEL) return false;
  const cost = upgradeCost(def, b.level);
  if (state.resources.coin < cost) return false;
  collectYield(state, b, def, now); // 레벨 변경 전에 쌓인 생산분을 먼저 정산
  state.resources.coin -= cost;
  b.level += 1;
  return true;
}

export function sellBuilding(state: GameState, def: BuildingDef, b: PlacedBuilding): void {
  state.buildings = state.buildings.filter((x) => x.uid !== b.uid);
  state.resources.coin += sellRefund(def);
}

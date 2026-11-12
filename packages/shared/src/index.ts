export type Rarity = "common" | "rare" | "epic" | "legendary";
export type Position = "front" | "middle" | "back";

export interface BuildingDef {
  id: string;
  name: string;
  size: { w: number; h: number };
  produces?: { resource: "coin" | "crystal" | "material"; amount: number; seconds: number };
  cost: { coin: number };
}

export interface CharacterDef {
  id: string;
  name: string;
  rarity: Rarity;
  position: Position;
  element: string;
  hp: number;
  atk: number;
  /** SkillDef.id */
  skill: string;
}

export interface SkillDef {
  id: string;
  name: string;
  /** seconds */
  cooldown: number;
  /** percent of ATK */
  power: number;
  target: "front" | "lowest" | "all";
  /** true: restores ally HP instead of dealing damage */
  heal?: boolean;
}

export interface EnemySpec {
  name: string;
  position: Position;
  hp: number;
  atk: number;
  /** SkillDef.id (optional) */
  skill?: string;
}

export interface StageDef {
  id: string;
  name: string;
  boss?: boolean;
  enemies: EnemySpec[];
  /** granted on every win */
  reward: { coin: number; material: number };
  /** granted once, on the first win */
  firstClear: { crystal: number };
}

export interface HealthResponse {
  ok: true;
  version: string;
}

export const GRID_SIZE = 40;
export const TILE = 64;

export * from "./kingdom";
export * from "./iso";
export * from "./collection";
export * from "./battle";
export * from "./actions";
export * from "./replay";
export * from "./sanitize";

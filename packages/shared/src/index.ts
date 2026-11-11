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
}

export interface HealthResponse {
  ok: true;
  version: string;
}

export const GRID_SIZE = 40;
export const TILE = 64;

export * from "./kingdom";

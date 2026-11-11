import type { CharacterDef, Rarity } from "./index";
import type { GameState, GachaState, OwnedCharacter } from "./kingdom";

export type Rng = () => number;

export const RARITIES: Rarity[] = ["common", "rare", "epic", "legendary"];
/** percent, must sum to 100 */
export const RATES: Record<Rarity, number> = { common: 60, rare: 28, epic: 9, legendary: 3 };
export const PULL_COST = 10;
export const TEN_COST = 100;
/** the Nth pull since the last epic-or-better is guaranteed epic or better */
export const EPIC_PITY = 10;
/** the Nth pull since the last legendary is guaranteed legendary */
export const LEGEND_PITY = 50;
/** shards gained from a duplicate */
export const DUP_SHARDS: Record<Rarity, number> = { common: 10, rare: 15, epic: 25, legendary: 40 };
export const MAX_STARS = 5;
/** shards needed to go from `stars` to `stars + 1` (index = current stars) */
const STAR_COST = [0, 20, 40, 80, 160];

export interface PullResult {
  charId: string;
  rarity: Rarity;
  isNew: boolean;
  /** shards gained (0 for a new character) */
  shards: number;
}

export function rollRarity(g: GachaState, rng: Rng): Rarity {
  if (g.sinceLegendary + 1 >= LEGEND_PITY) return "legendary";
  if (g.sinceEpic + 1 >= EPIC_PITY) {
    return rng() * (RATES.epic + RATES.legendary) < RATES.epic ? "epic" : "legendary";
  }
  let r = rng() * 100;
  for (const k of RARITIES) {
    if (r < RATES[k]) return k;
    r -= RATES[k];
  }
  return "common";
}

export function pickCharacter(defs: CharacterDef[], rarity: Rarity, rng: Rng): CharacterDef {
  const pool = defs.filter((d) => d.rarity === rarity);
  if (pool.length === 0) throw new Error(`no characters with rarity ${rarity}`);
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/** Spends crystals and pulls 1 or 10 times. Returns null (and changes nothing) if the request is invalid or unaffordable. */
export function pull(state: GameState, defs: CharacterDef[], count: number, rng: Rng): PullResult[] | null {
  if (count !== 1 && count !== 10) return null;
  const cost = count === 10 ? TEN_COST : PULL_COST;
  if (state.resources.crystal < cost) return null;
  state.resources.crystal -= cost;

  const out: PullResult[] = [];
  for (let i = 0; i < count; i++) {
    const g = state.gacha;
    const rarity = rollRarity(g, rng);
    const def = pickCharacter(defs, rarity, rng);
    g.pullsTotal += 1;
    g.sinceLegendary = rarity === "legendary" ? 0 : g.sinceLegendary + 1;
    g.sinceEpic = rarity === "epic" || rarity === "legendary" ? 0 : g.sinceEpic + 1;

    const owned = state.roster[def.id];
    if (!owned) {
      state.roster[def.id] = { level: 1, stars: 1, shards: 0 };
      out.push({ charId: def.id, rarity, isNew: true, shards: 0 });
    } else {
      const s = DUP_SHARDS[rarity];
      owned.shards += s;
      out.push({ charId: def.id, rarity, isNew: false, shards: s });
    }
  }
  return out;
}

export const maxLevel = (stars: number): number => 10 * stars;

export function levelUpCost(level: number): { coin: number; material: number } {
  return { coin: 40 * level, material: level };
}

export function levelUp(state: GameState, id: string): "ok" | "max" | "funds" | "unowned" {
  const o = state.roster[id];
  if (!o) return "unowned";
  if (o.level >= maxLevel(o.stars)) return "max";
  const c = levelUpCost(o.level);
  if (state.resources.coin < c.coin || state.resources.material < c.material) return "funds";
  state.resources.coin -= c.coin;
  state.resources.material -= c.material;
  o.level += 1;
  return "ok";
}

export function awakenCost(stars: number): number {
  return stars >= MAX_STARS ? Infinity : STAR_COST[stars];
}

export function awaken(state: GameState, id: string): "ok" | "max" | "shards" | "unowned" {
  const o = state.roster[id];
  if (!o) return "unowned";
  if (o.stars >= MAX_STARS) return "max";
  const cost = awakenCost(o.stars);
  if (o.shards < cost) return "shards";
  o.shards -= cost;
  o.stars += 1;
  return "ok";
}

export function charStats(def: CharacterDef, o: OwnedCharacter): { hp: number; atk: number } {
  const m = (1 + 0.1 * (o.level - 1)) * (1 + 0.2 * (o.stars - 1));
  return { hp: Math.floor(def.hp * m), atk: Math.floor(def.atk * m) };
}

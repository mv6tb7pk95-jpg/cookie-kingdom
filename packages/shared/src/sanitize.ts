import type { GameData } from "./actions";
import { EPIC_PITY, LEGEND_PITY, MAX_STARS, maxLevel } from "./collection";
import { buildTeam } from "./battle";
import {
  MAX_LEVEL, canPlace, findDef, migrateState, newGameState,
  type GameState, type OwnedCharacter, type PlacedBuilding,
} from "./kingdom";

/** Upper bounds applied when a local save is imported for the first time. */
export const IMPORT_CAPS = { coin: 50_000, crystal: 300, material: 1_000, shards: 1_000, buildings: 200 };

const num = (v: unknown, lo: number, hi: number, fallback = lo): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : fallback;

/**
 * Turns an untrusted client save into a valid state: unknown ids are dropped,
 * numbers are clamped to what the rules allow. Returns null if it is not a save at all.
 * The result is still client-supplied progress: see docs/SERVER.md.
 */
export function sanitizeState(raw: unknown, data: GameData, now: number): GameState | null {
  const m = migrateState(raw);
  if (!m) return null;
  const out = newGameState();
  const r = m.resources as unknown as Record<string, unknown>;
  out.resources = {
    coin: num(r.coin, 0, IMPORT_CAPS.coin, 0),
    crystal: num(r.crystal, 0, IMPORT_CAPS.crystal, 0),
    material: num(r.material, 0, IMPORT_CAPS.material, 0),
  };

  for (const b of m.buildings as Partial<PlacedBuilding>[]) {
    if (out.buildings.length >= IMPORT_CAPS.buildings) break;
    if (!b || typeof b.defId !== "string") continue;
    const def = findDef(data.buildings, b.defId);
    if (!def || typeof b.x !== "number" || typeof b.y !== "number") continue;
    const x = Math.floor(b.x);
    const y = Math.floor(b.y);
    if (!canPlace(out, data.buildings, def, x, y)) continue;
    out.buildings.push({
      uid: `b${out.nextId++}`,
      defId: def.id,
      x,
      y,
      level: num(b.level, 1, MAX_LEVEL, 1),
      lastCollected: num(b.lastCollected, 0, now, now),
    });
  }

  for (const [id, o] of Object.entries(m.roster as Record<string, Partial<OwnedCharacter>>)) {
    if (!data.characters.some((c) => c.id === id) || !o) continue;
    const stars = num(o.stars, 1, MAX_STARS, 1);
    out.roster[id] = { stars, level: num(o.level, 1, maxLevel(stars), 1), shards: num(o.shards, 0, IMPORT_CAPS.shards, 0) };
  }

  const g = m.gacha as unknown as Record<string, unknown>;
  out.gacha = {
    pullsTotal: num(g.pullsTotal, 0, 100_000, 0),
    sinceEpic: num(g.sinceEpic, 0, EPIC_PITY - 1, 0),
    sinceLegendary: num(g.sinceLegendary, 0, LEGEND_PITY - 1, 0),
  };

  // stages unlock in order, so a gap ends the imported progress
  for (const st of data.stages) {
    const v = (m.cleared as Record<string, unknown>)[st.id];
    if (typeof v !== "number") break;
    out.cleared[st.id] = num(v, 1, 3, 1);
  }
  out.team = buildTeam(out.roster, data.characters, m.team);
  return out;
}

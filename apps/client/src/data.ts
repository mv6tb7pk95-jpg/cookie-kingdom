import type { BuildingDef } from "@ck/shared";
import raw from "../../../data/buildings.json";

/** buildings.json 로드 및 최소 검증 */
export function loadBuildingDefs(): BuildingDef[] {
  const defs = raw as unknown as BuildingDef[];
  const seen = new Set<string>();
  for (const d of defs) {
    if (!d.id || seen.has(d.id)) throw new Error(`buildings.json: invalid or duplicate id "${d.id}"`);
    seen.add(d.id);
    if (d.size.w < 1 || d.size.h < 1) throw new Error(`buildings.json: bad size for ${d.id}`);
    if (d.cost.coin < 0) throw new Error(`buildings.json: bad cost for ${d.id}`);
    if (d.produces && (d.produces.seconds <= 0 || d.produces.amount <= 0)) {
      throw new Error(`buildings.json: bad production for ${d.id}`);
    }
  }
  return defs;
}

import type { BuildingDef, CharacterDef, SkillDef } from "@ck/shared";
import buildingsRaw from "../../../data/buildings.json";
import charactersRaw from "../../../data/characters.json";
import skillsRaw from "../../../data/skills.json";

/** buildings.json loader with minimal validation */
export function loadBuildingDefs(): BuildingDef[] {
  const defs = buildingsRaw as unknown as BuildingDef[];
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

export function loadSkillDefs(chars: CharacterDef[]): SkillDef[] {
  const skills = skillsRaw as unknown as SkillDef[];
  const ids = new Set<string>();
  for (const s of skills) {
    if (!s.id || ids.has(s.id)) throw new Error(`skills.json: invalid or duplicate id "${s.id}"`);
    ids.add(s.id);
    if (s.cooldown <= 0 || s.power <= 0) throw new Error(`skills.json: bad numbers for ${s.id}`);
  }
  for (const c of chars) if (!ids.has(c.skill)) throw new Error(`characters.json: ${c.id} has unknown skill ${c.skill}`);
  return skills;
}

export function loadCharacterDefs(): CharacterDef[] {
  const defs = charactersRaw as unknown as CharacterDef[];
  const ids = new Set<string>();
  for (const c of defs) {
    if (!c.id || ids.has(c.id)) throw new Error(`characters.json: invalid or duplicate id "${c.id}"`);
    ids.add(c.id);
    if (c.hp <= 0 || c.atk <= 0) throw new Error(`characters.json: bad stats for ${c.id}`);
  }
  for (const r of ["common", "rare", "epic", "legendary"]) {
    if (!defs.some((c) => c.rarity === r)) throw new Error(`characters.json: no ${r} character`);
  }
  return defs;
}

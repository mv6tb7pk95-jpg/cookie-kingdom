import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DUP_SHARDS, EPIC_PITY, LEGEND_PITY, MAX_STARS, PULL_COST, RATES, TEN_COST,
  awaken, awakenCost, charStats, levelUp, levelUpCost, maxLevel, migrateState, newGameState, pull,
  type CharacterDef, type SkillDef,
} from "../src/index";

const dir = join(__dirname, "..", "..", "..", "data");
const chars = JSON.parse(readFileSync(join(dir, "characters.json"), "utf8")) as CharacterDef[];
const skills = JSON.parse(readFileSync(join(dir, "skills.json"), "utf8")) as SkillDef[];

let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("PASS", name);
};
const rich = () => {
  const s = newGameState();
  s.resources.crystal = 1_000_000;
  return s;
};
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

t("data is consistent", () => {
  assert.equal(new Set(chars.map((c) => c.id)).size, chars.length);
  assert.equal(new Set(skills.map((s) => s.id)).size, skills.length);
  for (const r of ["common", "rare", "epic", "legendary"]) assert.ok(chars.some((c) => c.rarity === r), r);
  const sk = new Set(skills.map((s) => s.id));
  for (const c of chars) {
    assert.ok(sk.has(c.skill), c.id);
    assert.ok(c.hp > 0 && c.atk > 0);
  }
  assert.equal(Object.values(RATES).reduce((a, b) => a + b, 0), 100);
});

t("migrate v1 keeps buildings and resources", () => {
  const v1 = { version: 1, resources: { coin: 77, crystal: 3, material: 9 }, buildings: [{ uid: "b1" }], nextId: 2 };
  const m = migrateState(v1)!;
  assert.equal(m.version, 2);
  assert.equal(m.resources.coin, 77);
  assert.equal(m.buildings.length, 1);
  assert.deepEqual(m.roster, {});
  assert.equal(m.gacha.pullsTotal, 0);
});
t("migrate rejects garbage", () => {
  assert.equal(migrateState(null), null);
  assert.equal(migrateState("x"), null);
  assert.equal(migrateState({ version: 9, resources: {}, buildings: [] }), null);
  assert.equal(migrateState({ version: 2 }), null);
});

t("pull rejects unaffordable and invalid counts without changing state", () => {
  const s = newGameState();
  s.resources.crystal = PULL_COST - 1;
  assert.equal(pull(s, chars, 1, () => 0), null);
  s.resources.crystal = 1000;
  assert.equal(pull(s, chars, 5, () => 0), null);
  assert.equal(pull(s, chars, 0, () => 0), null);
  assert.equal(s.resources.crystal, 1000);
  assert.equal(s.gacha.pullsTotal, 0);
});
t("single and ten pull costs", () => {
  const s = newGameState();
  s.resources.crystal = 200;
  pull(s, chars, 10, Math.random);
  assert.equal(s.resources.crystal, 200 - TEN_COST);
  pull(s, chars, 1, Math.random);
  assert.equal(s.resources.crystal, 200 - TEN_COST - PULL_COST);
  assert.equal(s.gacha.pullsTotal, 11);
});

t("hard pity with the worst luck (rng=0)", () => {
  const s = rich();
  for (let i = 1; i <= 50; i++) {
    const r = pull(s, chars, 1, () => 0)![0].rarity;
    const expected = i === 50 ? "legendary" : i % EPIC_PITY === 0 ? "epic" : "common";
    assert.equal(r, expected, `pull ${i}`);
  }
});

t("seeded simulation: pity gaps and rates", () => {
  const s = rich();
  const rng = mulberry32(12345);
  const N = 100_000;
  let gapE = 0, gapL = 0, maxE = 0, maxL = 0, epicPlus = 0, legend = 0;
  const seen = new Set<string>();
  for (let i = 0; i < N; i++) {
    const p = pull(s, chars, 1, rng)![0];
    seen.add(p.charId);
    gapE++; gapL++;
    if (p.rarity === "epic" || p.rarity === "legendary") { epicPlus++; maxE = Math.max(maxE, gapE); gapE = 0; }
    if (p.rarity === "legendary") { legend++; maxL = Math.max(maxL, gapL); gapL = 0; }
  }
  assert.ok(maxE <= EPIC_PITY, `epic gap ${maxE}`);
  assert.ok(maxL <= LEGEND_PITY, `legend gap ${maxL}`);
  const le = legend / N, ee = epicPlus / N;
  console.log(`  legendary rate ${(le * 100).toFixed(2)}%  epic+ rate ${(ee * 100).toFixed(2)}%`);
  assert.ok(le > 0.03 && le < 0.06);
  assert.ok(ee > 0.12 && ee < 0.22);
  assert.equal(seen.size, chars.length);
});

t("duplicates become shards", () => {
  const s = rich();
  const a = pull(s, chars, 1, () => 0)![0];
  assert.equal(a.isNew, true);
  const b = pull(s, chars, 1, () => 0)![0];
  assert.equal(b.isNew, false);
  assert.equal(b.shards, DUP_SHARDS.common);
  assert.equal(s.roster[a.charId].shards, DUP_SHARDS.common);
});

t("level up spends coin and material and respects the cap", () => {
  const s = newGameState();
  s.roster.x = { level: 1, stars: 1, shards: 0 };
  assert.equal(levelUp(s, "nope"), "unowned");
  assert.equal(levelUp(s, "x"), "funds");
  s.resources.coin = 100000;
  s.resources.material = 100000;
  const c = levelUpCost(1);
  assert.equal(levelUp(s, "x"), "ok");
  assert.equal(s.resources.coin, 100000 - c.coin);
  assert.equal(s.resources.material, 100000 - c.material);
  while (s.roster.x.level < maxLevel(1)) assert.equal(levelUp(s, "x"), "ok");
  assert.equal(levelUp(s, "x"), "max");
  assert.ok(s.resources.coin >= 0 && s.resources.material >= 0);
});

t("awaken spends shards and raises the cap", () => {
  const s = newGameState();
  s.roster.x = { level: 1, stars: 1, shards: awakenCost(1) - 1 };
  assert.equal(awaken(s, "x"), "shards");
  s.roster.x.shards += 1 + 5;
  assert.equal(awaken(s, "x"), "ok");
  assert.equal(s.roster.x.stars, 2);
  assert.equal(s.roster.x.shards, 5);
  assert.equal(maxLevel(2), 20);
  s.roster.x.stars = MAX_STARS;
  assert.equal(awaken(s, "x"), "max");
  assert.equal(awaken(s, "nope"), "unowned");
});

t("stats grow with level and stars", () => {
  const c = chars[0];
  const base = charStats(c, { level: 1, stars: 1, shards: 0 });
  assert.equal(base.hp, c.hp);
  const lv = charStats(c, { level: 10, stars: 1, shards: 0 });
  const st = charStats(c, { level: 10, stars: 3, shards: 0 });
  assert.ok(lv.hp > base.hp && lv.atk > base.atk);
  assert.ok(st.hp > lv.hp && st.atk > lv.atk);
});
console.log(`${n} collection tests passed`);

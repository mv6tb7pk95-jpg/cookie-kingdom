import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TIME_LIMIT_TICKS, castSkill, createBattle, defaultTeam, isStageUnlocked, migrateState, newGameState,
  runBattle, settleBattle, starRating, step,
  type CharacterDef, type SkillDef, type StageDef,
} from "../src/index";

const dir = join(__dirname, "..", "..", "..", "data");
const chars = JSON.parse(readFileSync(join(dir, "characters.json"), "utf8")) as CharacterDef[];
const skills = JSON.parse(readFileSync(join(dir, "skills.json"), "utf8")) as SkillDef[];
const stages = JSON.parse(readFileSync(join(dir, "stages.json"), "utf8")) as StageDef[];

let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("PASS", name);
};
const own = (ids: string[], level = 1, stars = 1) => Object.fromEntries(ids.map((i) => [i, { level, stars, shards: 0 }]));
const starter = ["gumdrop_guard", "biscuit_scout", "sprinkle_archer"];
const strong = ["cocoa_paladin", "candycane_duelist", "mint_cryomancer", "honey_healer", "pretzel_brawler"];

t("stage data is consistent", () => {
  assert.equal(stages.length, 10);
  assert.equal(new Set(stages.map((s) => s.id)).size, 10);
  assert.equal(stages.filter((s) => s.boss).length, 1);
  assert.ok(stages[9].boss);
  const sk = new Set(skills.map((s) => s.id));
  for (const s of stages) {
    assert.ok(s.enemies.length >= 1 && s.enemies.length <= 5, s.id);
    for (const e of s.enemies) {
      assert.ok(e.hp > 0 && e.atk > 0, s.id);
      if (e.skill) assert.ok(sk.has(e.skill), `${s.id} ${e.skill}`);
    }
    assert.ok(s.reward.coin > 0 && s.firstClear.crystal >= 0);
  }
});

t("same seed gives an identical battle", () => {
  const roster = own(starter);
  const a = runBattle(createBattle(roster, chars, skills, starter, stages[1], 42));
  const b = runBattle(createBattle(roster, chars, skills, starter, stages[1], 42));
  assert.deepEqual(a, b);
  assert.ok(a.result);
});

t("different seeds can differ but every battle ends", () => {
  const roster = own(starter);
  const ticks = new Set<number>();
  for (let seed = 1; seed <= 30; seed++) {
    const b = runBattle(createBattle(roster, chars, skills, starter, stages[2], seed));
    assert.ok(b.result);
    assert.ok(b.tick <= TIME_LIMIT_TICKS);
    ticks.add(b.tick);
  }
  assert.ok(ticks.size > 1);
});

t("hp never goes below 0 or above max, and the dead stay dead", () => {
  const roster = own(strong, 10, 2);
  const b = createBattle(roster, chars, skills, strong, stages[5], 7);
  const dead = new Set<string>();
  while (!b.result) {
    for (const e of step(b)) if (e.t === "death") { assert.ok(!dead.has(e.uid)); dead.add(e.uid); }
    for (const u of b.units) {
      assert.ok(u.hp >= 0 && u.hp <= u.maxHp);
      if (dead.has(u.uid)) assert.equal(u.hp, 0);
    }
  }
});

t("starter team wins early stages, loses to the boss", () => {
  const roster = own(starter);
  for (const i of [0, 1, 2]) {
    for (let seed = 1; seed <= 10; seed++) assert.equal(runBattle(createBattle(roster, chars, skills, starter, stages[i], seed)).result, "win", `${stages[i].id}`);
  }
  assert.equal(runBattle(createBattle(roster, chars, skills, starter, stages[9], 1)).result, "lose");
});

t("a strong team beats the boss", () => {
  const roster = own(strong, 30, 3);
  let wins = 0;
  for (let seed = 1; seed <= 20; seed++) if (runBattle(createBattle(roster, chars, skills, strong, stages[9], seed)).result === "win") wins++;
  assert.ok(wins >= 18, `wins ${wins}/20`);
});

t("manual skill needs a ready cooldown and auto off keeps skills idle", () => {
  const roster = own(starter);
  const b = createBattle(roster, chars, skills, starter, stages[0], 3, false);
  assert.equal(castSkill(b, "a0"), false);
  assert.equal(castSkill(b, "e0"), false);
  assert.equal(castSkill(b, "nope"), false);
  const used: string[] = [];
  for (let i = 0; i < 40 && !b.result; i++) for (const e of step(b)) if (e.t === "skill") used.push(e.from);
  assert.deepEqual(used, []);
  const ally = b.units.find((u) => u.uid === "a0")!;
  while (ally.skillCd > 0 && !b.result) step(b);
  if (!b.result) {
    assert.equal(castSkill(b, "a0"), true);
    const ev = step(b);
    assert.ok(ev.some((e) => e.t === "skill" && e.from === "a0"));
    assert.equal(castSkill(b, "a0"), false);
  }
});

t("healer skill restores ally hp", () => {
  const ids = ["honey_healer", "gumdrop_guard"];
  const roster = own(ids);
  const b = createBattle(roster, chars, skills, ids, { ...stages[0], enemies: [{ name: "Dummy", position: "front", hp: 999999, atk: 1 }] }, 5);
  const tank = b.units.find((u) => u.defId === "gumdrop_guard")!;
  tank.hp = 100;
  let healed = false;
  for (let i = 0; i < 200 && !healed; i++) for (const e of step(b)) if (e.t === "skill" && e.heal) healed = true;
  assert.ok(healed);
  assert.ok(tank.hp > 100);
});

t("settle: rewards, first clear bonus once, losses change nothing", () => {
  const s = newGameState();
  s.roster = own(starter);
  const win = runBattle(createBattle(s.roster, chars, skills, starter, stages[0], 1));
  assert.equal(win.result, "win");
  const before = { ...s.resources };
  const r1 = settleBattle(s, stages[0], win);
  assert.ok(r1.firstClear && r1.crystal === stages[0].firstClear.crystal);
  assert.equal(s.resources.coin, before.coin + stages[0].reward.coin);
  assert.equal(s.resources.crystal, before.crystal + stages[0].firstClear.crystal);
  assert.ok(s.cleared[stages[0].id] >= 1);
  const mid = { ...s.resources };
  const r2 = settleBattle(s, stages[0], win);
  assert.equal(r2.firstClear, false);
  assert.equal(s.resources.crystal, mid.crystal);
  assert.equal(s.resources.coin, mid.coin + stages[0].reward.coin);
  const lose = runBattle(createBattle(s.roster, chars, skills, starter, stages[9], 1));
  const snap = JSON.stringify(s);
  assert.equal(settleBattle(s, stages[9], lose).stars, 0);
  assert.equal(JSON.stringify(s), snap);
});

t("stars, unlocking and default team", () => {
  const s = newGameState();
  assert.equal(isStageUnlocked(s, stages, 0), true);
  assert.equal(isStageUnlocked(s, stages, 1), false);
  s.cleared[stages[0].id] = 1;
  assert.equal(isStageUnlocked(s, stages, 1), true);
  assert.equal(isStageUnlocked(s, stages, 2), false);
  const roster = own(chars.map((c) => c.id));
  const team = defaultTeam(roster, chars);
  assert.equal(team.length, 5);
  assert.ok(team.includes("eclipse_truffle") && team.includes("aurora_meringue"));
  assert.equal(defaultTeam({}, chars).length, 0);
  const b = createBattle(own(starter), chars, skills, starter, stages[0], 1);
  assert.equal(starRating(b), 0);
});

t("old v2 saves without battle fields migrate", () => {
  const m = migrateState({ version: 2, resources: { coin: 1, crystal: 1, material: 1 }, buildings: [], roster: {} })!;
  assert.deepEqual(m.cleared, {});
  assert.deepEqual(m.team, []);
});
console.log(`${n} battle tests passed`);

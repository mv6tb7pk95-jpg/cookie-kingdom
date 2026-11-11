import type { CharacterDef, EnemySpec, Position, SkillDef, StageDef } from "./index";
import type { GameState, OwnedCharacter } from "./kingdom";
import { charStats } from "./collection";

/** The engine is tick based and has no timers: the client decides how many ticks to run per frame. */
export const TICK_RATE = 10; // ticks per simulated second
export const ATTACK_INTERVAL = 10; // ticks between basic attacks
export const TIME_LIMIT_TICKS = 90 * TICK_RATE;
export const TEAM_SIZE = 5;
export const CRIT_CHANCE = 0.1;
export const CRIT_MULT = 1.5;

export type Side = "ally" | "enemy";

export interface Combatant {
  uid: string;
  side: Side;
  /** CharacterDef.id for allies, undefined for enemies */
  defId?: string;
  name: string;
  position: Position;
  slot: number;
  maxHp: number;
  hp: number;
  atk: number;
  skill?: { name: string; cooldown: number; power: number; target: SkillDef["target"]; heal: boolean };
  skillCd: number;
  atkCd: number;
  /** manual cast requested, consumed on the next tick */
  queued: boolean;
}

export interface BattleState {
  tick: number;
  /** mulberry32 state, so a battle is fully reproducible from (team, stage, seed) */
  rng: number;
  units: Combatant[];
  /** allies cast their skills automatically when ready */
  auto: boolean;
  result: "win" | "lose" | null;
}

export interface Hit {
  to: string;
  amount: number;
  crit: boolean;
}

export type BattleEvent =
  | { t: "attack"; from: string; to: string; amount: number; crit: boolean }
  | { t: "skill"; from: string; name: string; heal: boolean; hits: Hit[] }
  | { t: "death"; uid: string }
  | { t: "end"; result: "win" | "lose" };

const POS_RANK: Record<Position, number> = { front: 0, middle: 1, back: 2 };

export function nextRandom(b: BattleState): number {
  b.rng = (b.rng + 0x6d2b79f5) | 0;
  let x = Math.imul(b.rng ^ (b.rng >>> 15), 1 | b.rng);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

const toTicks = (sec: number) => Math.round(sec * TICK_RATE);

function makeSkill(s: SkillDef | undefined): Combatant["skill"] {
  return s ? { name: s.name, cooldown: toTicks(s.cooldown), power: s.power, target: s.target, heal: !!s.heal } : undefined;
}

function makeUnit(base: Omit<Combatant, "skillCd" | "atkCd" | "queued" | "hp">): Combatant {
  return { ...base, hp: base.maxHp, skillCd: base.skill ? Math.round(base.skill.cooldown / 2) : 0, atkCd: ATTACK_INTERVAL, queued: false };
}

/** Ally list from roster ids (unowned/duplicate ids are skipped, capped at TEAM_SIZE). */
export function buildTeam(roster: Record<string, OwnedCharacter>, defs: CharacterDef[], ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (out.length >= TEAM_SIZE) break;
    if (roster[id] && !out.includes(id) && defs.some((d) => d.id === id)) out.push(id);
  }
  return out;
}

/** Strongest owned characters, used when the player has not picked a team yet. */
export function defaultTeam(roster: Record<string, OwnedCharacter>, defs: CharacterDef[]): string[] {
  const power = (d: CharacterDef) => {
    const s = charStats(d, roster[d.id]);
    return s.hp / 10 + s.atk;
  };
  return defs
    .filter((d) => roster[d.id])
    .sort((a, b) => power(b) - power(a))
    .slice(0, TEAM_SIZE)
    .map((d) => d.id);
}

export function createBattle(
  roster: Record<string, OwnedCharacter>,
  defs: CharacterDef[],
  skills: SkillDef[],
  teamIds: string[],
  stage: StageDef,
  seed: number,
  auto = true,
): BattleState {
  const units: Combatant[] = [];
  const ids = buildTeam(roster, defs, teamIds);
  ids.forEach((id, i) => {
    const d = defs.find((c) => c.id === id)!;
    const st = charStats(d, roster[id]);
    units.push(
      makeUnit({
        uid: `a${i}`,
        side: "ally",
        defId: id,
        name: d.name,
        position: d.position,
        slot: i,
        maxHp: st.hp,
        atk: st.atk,
        skill: makeSkill(skills.find((s) => s.id === d.skill)),
      }),
    );
  });
  stage.enemies.forEach((e: EnemySpec, i) => {
    units.push(
      makeUnit({
        uid: `e${i}`,
        side: "enemy",
        name: e.name,
        position: e.position,
        slot: i,
        maxHp: e.hp,
        atk: e.atk,
        skill: makeSkill(e.skill ? skills.find((s) => s.id === e.skill) : undefined),
      }),
    );
  });
  return { tick: 0, rng: seed | 0, units, auto, result: null };
}

const alive = (b: BattleState, side: Side) => b.units.filter((u) => u.side === side && u.hp > 0);

function frontMost(list: Combatant[]): Combatant | undefined {
  return [...list].sort((a, c) => POS_RANK[a.position] - POS_RANK[c.position] || a.slot - c.slot)[0];
}

function lowestHp(list: Combatant[]): Combatant | undefined {
  return [...list].sort((a, c) => a.hp - c.hp || a.slot - c.slot)[0];
}

/** Manual cast. Returns false if the unit cannot cast right now. */
export function castSkill(b: BattleState, uid: string): boolean {
  const u = b.units.find((v) => v.uid === uid);
  if (!u || b.result || u.hp <= 0 || u.side !== "ally" || !u.skill || u.skillCd > 0) return false;
  u.queued = true;
  return true;
}

/** Advances one tick. All actions of a tick are decided first and applied together, so neither side acts first. */
export function step(b: BattleState): BattleEvent[] {
  const events: BattleEvent[] = [];
  if (b.result) return events;
  b.tick += 1;

  interface Effect {
    from: Combatant;
    to: Combatant;
    amount: number;
    crit: boolean;
    heal: boolean;
    skill: boolean;
  }
  const effects: Effect[] = [];
  const casts: { from: Combatant; name: string; heal: boolean; effects: Effect[] }[] = [];

  const roll = (u: Combatant, power: number) => {
    const crit = nextRandom(b) < CRIT_CHANCE;
    return { crit, amount: Math.max(1, Math.round(((u.atk * power) / 100) * (crit ? CRIT_MULT : 1))) };
  };

  for (const u of b.units) {
    if (u.hp <= 0) continue;
    if (u.skillCd > 0) u.skillCd -= 1;
    if (u.atkCd > 0) u.atkCd -= 1;
    const foes = alive(b, u.side === "ally" ? "enemy" : "ally");
    const friends = alive(b, u.side);
    if (foes.length === 0) continue;

    const castNow = !!u.skill && u.skillCd <= 0 && (u.side === "enemy" || b.auto || u.queued);
    if (castNow && u.skill) {
      const sk = u.skill;
      u.skillCd = sk.cooldown;
      u.atkCd = ATTACK_INTERVAL;
      u.queued = false;
      const pool = sk.heal ? friends : foes;
      const targets =
        sk.target === "all" ? pool : [sk.target === "lowest" ? lowestHp(pool)! : sk.heal ? lowestHp(pool)! : frontMost(pool)!];
      const mine: Effect[] = targets.map((t) => ({ from: u, to: t, ...roll(u, sk.power), heal: sk.heal, skill: true }));
      effects.push(...mine);
      casts.push({ from: u, name: sk.name, heal: sk.heal, effects: mine });
    } else if (u.atkCd <= 0) {
      u.atkCd = ATTACK_INTERVAL;
      const t = frontMost(foes)!;
      effects.push({ from: u, to: t, ...roll(u, 100), heal: false, skill: false });
    }
  }

  const wasAlive = new Set(b.units.filter((u) => u.hp > 0).map((u) => u.uid));
  for (const e of effects) {
    if (e.heal) {
      if (e.to.hp > 0) e.to.hp = Math.min(e.to.maxHp, e.to.hp + e.amount);
    } else {
      e.to.hp = Math.max(0, e.to.hp - e.amount);
    }
  }

  for (const e of effects) {
    if (!e.skill) events.push({ t: "attack", from: e.from.uid, to: e.to.uid, amount: e.amount, crit: e.crit });
  }
  for (const c of casts) {
    events.push({
      t: "skill",
      from: c.from.uid,
      name: c.name,
      heal: c.heal,
      hits: c.effects.map((e) => ({ to: e.to.uid, amount: e.amount, crit: e.crit })),
    });
  }
  for (const u of b.units) if (wasAlive.has(u.uid) && u.hp <= 0) events.push({ t: "death", uid: u.uid });

  const allies = alive(b, "ally").length;
  const enemies = alive(b, "enemy").length;
  if (allies === 0) b.result = "lose";
  else if (enemies === 0) b.result = "win";
  else if (b.tick >= TIME_LIMIT_TICKS) b.result = "lose";
  if (b.result) events.push({ t: "end", result: b.result });
  return events;
}

/** Runs to completion (tests, simulations, server-side verification). */
export function runBattle(b: BattleState): BattleState {
  while (!b.result) step(b);
  return b;
}

/** 0 = lost, otherwise 1-3 depending on how many allies survived. */
export function starRating(b: BattleState): number {
  if (b.result !== "win") return 0;
  const total = b.units.filter((u) => u.side === "ally").length;
  const left = alive(b, "ally").length;
  if (left === total) return 3;
  return left * 2 >= total ? 2 : 1;
}

export function isStageUnlocked(state: GameState, stages: StageDef[], index: number): boolean {
  return index === 0 || !!state.cleared[stages[index - 1]?.id];
}

export interface Settlement {
  stars: number;
  coin: number;
  material: number;
  crystal: number;
  firstClear: boolean;
}

/** Applies the outcome of a finished battle to the save. Losses change nothing. */
export function settleBattle(state: GameState, stage: StageDef, b: BattleState): Settlement {
  const stars = starRating(b);
  const none: Settlement = { stars: 0, coin: 0, material: 0, crystal: 0, firstClear: false };
  if (stars === 0) return none;
  const first = !state.cleared[stage.id];
  const s: Settlement = {
    stars,
    coin: stage.reward.coin,
    material: stage.reward.material,
    crystal: first ? stage.firstClear.crystal : 0,
    firstClear: first,
  };
  state.resources.coin += s.coin;
  state.resources.material += s.material;
  state.resources.crystal += s.crystal;
  state.cleared[stage.id] = Math.max(state.cleared[stage.id] ?? 0, stars);
  return s;
}

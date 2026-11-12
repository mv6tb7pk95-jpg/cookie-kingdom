import type { BuildingDef, CharacterDef, SkillDef, StageDef } from "./index";
import {
  canPlace, collectYield, findDef, placeBuilding, sellBuilding, upgradeBuilding,
  type GameState, type OwnedCharacter,
} from "./kingdom";
import { awaken, levelUp, pull, type Rng } from "./collection";
import { TEAM_SIZE, buildTeam, defaultTeam, isStageUnlocked, settleBattle } from "./battle";
import { simulateReplay, type BattleInput } from "./replay";

export interface GameData {
  buildings: BuildingDef[];
  characters: CharacterDef[];
  skills: SkillDef[];
  stages: StageDef[];
}

export type Action =
  | { type: "build"; defId: string; x: number; y: number }
  | { type: "move"; uid: string; x: number; y: number }
  | { type: "upgrade"; uid: string }
  | { type: "sell"; uid: string }
  | { type: "harvest"; uid: string }
  | { type: "gacha"; count: number }
  | { type: "levelUp"; id: string }
  | { type: "awaken"; id: string }
  | { type: "setTeam"; team: string[] }
  | { type: "battleStart"; stageId: string }
  | { type: "battleEnd"; inputs: BattleInput[]; claimed?: "win" | "lose"; abort?: boolean };

/** A battle the server (or the local fallback) has started and not yet settled. */
export interface PendingBattle {
  stageId: string;
  seed: number;
  team: string[];
  /** roster entries of the team members at the moment the battle started */
  roster: Record<string, OwnedCharacter>;
  startedAt: number;
}

export interface ActionContext {
  data: GameData;
  /** ms epoch used for production timers */
  now: number;
  /** needed by "gacha" */
  rng?: Rng;
  /** needed by "battleStart" */
  seed?: number;
  pending?: PendingBattle | null;
}

export type Outcome =
  | { ok: true; state: GameState; pending: PendingBattle | null; result?: unknown }
  | { ok: false; error: string };

const fail = (error: string): Outcome => ({ ok: false, error });
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && Math.abs(v) < 1e6;
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

/**
 * The single rule entry point used by the client (prediction) and the server (authority).
 * It never mutates `state`: it works on a copy and returns the new state only on success.
 */
export function applyAction(state: GameState, action: unknown, ctx: ActionContext): Outcome {
  if (!action || typeof action !== "object") return fail("bad_action");
  const a = action as Record<string, unknown>;
  const s: GameState = structuredClone(state);
  const pending = ctx.pending ?? null;
  const done = (result?: unknown, nextPending: PendingBattle | null = pending): Outcome => ({
    ok: true, state: s, pending: nextPending, result,
  });
  const find = (uid: unknown) => (isId(uid) ? s.buildings.find((b) => b.uid === uid) : undefined);

  switch (a.type) {
    case "build": {
      if (!isId(a.defId) || !isInt(a.x) || !isInt(a.y)) return fail("bad_action");
      const def = findDef(ctx.data.buildings, a.defId);
      if (!def) return fail("unknown_building");
      const b = placeBuilding(s, ctx.data.buildings, def, a.x, a.y, ctx.now);
      return b ? done({ uid: b.uid }) : fail("cannot_build");
    }
    case "move": {
      if (!isInt(a.x) || !isInt(a.y)) return fail("bad_action");
      const b = find(a.uid);
      if (!b) return fail("unknown_building");
      const def = findDef(ctx.data.buildings, b.defId);
      if (!def || !canPlace(s, ctx.data.buildings, def, a.x, a.y, b.uid)) return fail("cannot_move");
      b.x = a.x;
      b.y = a.y;
      return done();
    }
    case "upgrade": {
      const b = find(a.uid);
      const def = b && findDef(ctx.data.buildings, b.defId);
      if (!b || !def) return fail("unknown_building");
      return upgradeBuilding(s, def, b, ctx.now) ? done() : fail("cannot_upgrade");
    }
    case "sell": {
      const b = find(a.uid);
      const def = b && findDef(ctx.data.buildings, b.defId);
      if (!b || !def) return fail("unknown_building");
      sellBuilding(s, def, b);
      return done();
    }
    case "harvest": {
      const b = find(a.uid);
      const def = b && findDef(ctx.data.buildings, b.defId);
      if (!b || !def) return fail("unknown_building");
      const gained = collectYield(s, b, def, ctx.now);
      return gained > 0 ? done({ gained }) : fail("nothing_to_harvest");
    }
    case "gacha": {
      if (!ctx.rng) return fail("rng_unavailable");
      if (!isInt(a.count)) return fail("bad_action");
      const res = pull(s, ctx.data.characters, a.count, ctx.rng);
      return res ? done({ pulls: res }) : fail("cannot_pull");
    }
    case "levelUp": {
      if (!isId(a.id)) return fail("bad_action");
      const r = levelUp(s, a.id);
      return r === "ok" ? done() : fail(`level_${r}`);
    }
    case "awaken": {
      if (!isId(a.id)) return fail("bad_action");
      const r = awaken(s, a.id);
      return r === "ok" ? done() : fail(`awaken_${r}`);
    }
    case "setTeam": {
      if (!Array.isArray(a.team) || a.team.length > TEAM_SIZE || !a.team.every(isId)) return fail("bad_action");
      const team = buildTeam(s.roster, ctx.data.characters, a.team as string[]);
      if (team.length !== a.team.length) return fail("invalid_team");
      s.team = team;
      return done();
    }
    case "battleStart": {
      if (!isId(a.stageId)) return fail("bad_action");
      if (typeof ctx.seed !== "number") return fail("seed_unavailable");
      const idx = ctx.data.stages.findIndex((st) => st.id === a.stageId);
      if (idx < 0) return fail("unknown_stage");
      if (!isStageUnlocked(s, ctx.data.stages, idx)) return fail("stage_locked");
      let team = buildTeam(s.roster, ctx.data.characters, s.team);
      if (team.length === 0) team = defaultTeam(s.roster, ctx.data.characters);
      if (team.length === 0) return fail("no_team");
      const roster: Record<string, OwnedCharacter> = {};
      for (const id of team) roster[id] = { ...s.roster[id] };
      const p: PendingBattle = { stageId: a.stageId, seed: ctx.seed | 0, team, roster, startedAt: ctx.now };
      return done({ stageId: p.stageId }, p);
    }
    case "battleEnd": {
      if (!pending) return fail("no_battle");
      if (a.abort === true) return done({ aborted: true }, null);
      const stage = ctx.data.stages.find((st) => st.id === pending.stageId);
      if (!stage) return fail("unknown_stage");
      const v = simulateReplay(pending, a.inputs, ctx.data, ctx.now);
      if (!v.ok) return fail(v.error);
      const result = v.battle.result;
      if (a.claimed !== undefined && a.claimed !== result) return fail("replay_mismatch");
      const settlement = settleBattle(s, stage, v.battle);
      return done({ result, settlement }, null);
    }
    default:
      return fail("unknown_action");
  }
}

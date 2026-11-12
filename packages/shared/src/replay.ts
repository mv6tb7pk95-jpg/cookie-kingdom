import type { PendingBattle, GameData } from "./actions";
import { TICK_RATE, castSkill, createBattle, step, type BattleState } from "./battle";

/** Highest client playback speed (x3). A battle cannot be reported finished faster than this allows. */
export const MAX_SPEED = 3;
export const MAX_INPUTS = 500;
/** elapsed time is measured server-side (start to receipt), so latency only adds time; slack covers rounding */
export const TIME_SLACK_MS = 250;

/** Only player decisions are recorded; everything else follows from (team, stage, seed). */
export type BattleInput =
  | { tick: number; kind: "cast"; uid: string }
  | { tick: number; kind: "auto"; on: boolean };

export type ReplayResult = { ok: true; battle: BattleState } | { ok: false; error: string };

export const minDurationMs = (ticks: number): number => (ticks / (TICK_RATE * MAX_SPEED)) * 1000;

function validInputs(inputs: unknown): inputs is BattleInput[] {
  if (!Array.isArray(inputs) || inputs.length > MAX_INPUTS) return false;
  let last = 0;
  for (const i of inputs) {
    if (!i || typeof i !== "object") return false;
    const r = i as Record<string, unknown>;
    if (typeof r.tick !== "number" || !Number.isInteger(r.tick) || r.tick < last) return false;
    last = r.tick;
    if (r.kind === "cast") {
      if (typeof r.uid !== "string" || r.uid.length > 16) return false;
    } else if (r.kind === "auto") {
      if (typeof r.on !== "boolean") return false;
    } else return false;
  }
  return true;
}

/**
 * Re-runs a battle from the pending record and the player's inputs.
 * `now` (optional) enables the "finished too fast" check against the real elapsed time.
 */
export function simulateReplay(p: PendingBattle, inputs: unknown, data: GameData, now?: number): ReplayResult {
  if (!validInputs(inputs)) return { ok: false, error: "bad_inputs" };
  const stage = data.stages.find((s) => s.id === p.stageId);
  if (!stage) return { ok: false, error: "unknown_stage" };
  const b = createBattle(p.roster, data.characters, data.skills, p.team, stage, p.seed, true);
  let i = 0;
  while (!b.result) {
    while (i < inputs.length && inputs[i].tick === b.tick) {
      const inp = inputs[i++];
      if (inp.kind === "auto") b.auto = inp.on;
      else if (!castSkill(b, inp.uid)) return { ok: false, error: "impossible_input" };
    }
    step(b);
  }
  if (i < inputs.length) return { ok: false, error: "input_after_end" };
  if (now !== undefined && now - p.startedAt < minDurationMs(b.tick) - TIME_SLACK_MS) {
    return { ok: false, error: "too_fast" };
  }
  return { ok: true, battle: b };
}

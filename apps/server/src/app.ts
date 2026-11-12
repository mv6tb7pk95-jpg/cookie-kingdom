import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  applyAction, newGameState, sanitizeState,
  type GameData, type GameState, type PendingBattle, type Rng,
} from "@ck/shared";
import type { Account, Store } from "./store";

export interface Deps {
  store: Store;
  data: GameData;
  /** ms epoch */
  now: () => number;
  /** 32-bit unsigned random integer */
  randomInt: () => number;
  randomHex: (bytes: number) => string;
}

export const MAX_CONFLICT_RETRIES = 5;
const MAX_BODY = 64 * 1024;

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function cryptoDeps(): Pick<Deps, "now" | "randomInt" | "randomHex"> {
  return {
    now: () => Date.now(),
    randomInt: () => crypto.getRandomValues(new Uint32Array(1))[0],
    randomHex: (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join(""),
  };
}

const view = (state: GameState, pending: PendingBattle | null, version: number) => ({
  state,
  version,
  battle: pending ? { stageId: pending.stageId, seed: pending.seed, team: pending.team, startedAt: pending.startedAt } : null,
});

export function createApp(deps: Deps) {
  const app = new Hono();
  app.use("*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["GET", "POST", "OPTIONS"] }));
  app.onError((_e, c) => c.json({ ok: false, error: "server_error" }, 500));

  const readJson = async (req: Request): Promise<unknown | undefined> => {
    const text = await req.text();
    if (text.length > MAX_BODY) return undefined;
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return undefined;
    }
  };

  const authenticate = async (header: string | undefined): Promise<Account | null> => {
    const m = /^Bearer ([0-9a-f]{64})$/.exec(header ?? "");
    return m ? deps.store.findByTokenHash(await sha256Hex(m[1])) : null;
  };

  app.get("/api/health", (c) => c.json({ ok: true, version: "0.4.0" }));

  // Creates a guest account. The token is returned once; only its hash is stored.
  app.post("/api/auth/guest", async (c) => {
    const body = (await readJson(c.req.raw)) as { save?: unknown } | undefined;
    if (body === undefined || typeof body !== "object" || body === null) return c.json({ ok: false, error: "bad_request" }, 400);
    const now = deps.now();
    let state = newGameState();
    let imported = false;
    if (body.save !== undefined && body.save !== null) {
      const s = sanitizeState(body.save, deps.data, now);
      if (s) {
        state = s;
        imported = true;
      }
    }
    const token = deps.randomHex(32);
    await deps.store.create(deps.randomHex(8), await sha256Hex(token), state, now);
    return c.json({ ok: true, token, imported, state, version: 0, battle: null });
  });

  app.get("/api/state", async (c) => {
    const acc = await authenticate(c.req.header("Authorization"));
    if (!acc) return c.json({ ok: false, error: "unauthorized" }, 401);
    return c.json({ ok: true, ...view(acc.state, acc.pending, acc.version) });
  });

  app.post("/api/action", async (c) => {
    const token = c.req.header("Authorization");
    const body = (await readJson(c.req.raw)) as { action?: unknown; cid?: unknown } | undefined;
    if (!body || typeof body !== "object") return c.json({ ok: false, error: "bad_request" }, 400);
    const cid = typeof body.cid === "string" && body.cid.length > 0 && body.cid.length <= 64 ? body.cid : null;

    for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
      const acc = await authenticate(token);
      if (!acc) return c.json({ ok: false, error: "unauthorized" }, 401);

      // a retried request (same cid) must not be applied twice
      if (cid && acc.lastCid === cid && acc.lastResponse) {
        return c.json({ ...JSON.parse(acc.lastResponse), replayed: true });
      }

      const rng: Rng = () => deps.randomInt() / 4294967296;
      const out = applyAction(acc.state, body.action, {
        data: deps.data,
        now: deps.now(),
        rng,
        seed: deps.randomInt() | 0,
        pending: acc.pending,
      });

      if (!out.ok) {
        // the client rolls back to this authoritative state
        return c.json({ ok: false, error: out.error, ...view(acc.state, acc.pending, acc.version) }, 200);
      }

      const response = { ok: true, result: out.result ?? null, ...view(out.state, out.pending, acc.version + 1) };
      const saved = await deps.store.save(
        acc.id,
        acc.version,
        { state: out.state, pending: out.pending, lastCid: cid, lastResponse: cid ? JSON.stringify(response) : null },
        deps.now(),
      );
      if (saved) return c.json(response);
      // another write won: re-read and apply again on the fresh state (nothing was charged)
    }
    return c.json({ ok: false, error: "conflict" }, 409);
  });

  return app;
}

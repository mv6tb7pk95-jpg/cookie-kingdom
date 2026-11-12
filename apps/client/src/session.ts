import {
  applyAction, migrateState, newGameState,
  type Action, type GameData, type GameState, type PendingBattle,
} from "@ck/shared";
import { loadBuildingDefs, loadCharacterDefs, loadSkillDefs, loadStageDefs } from "./data";

/** Base URL of the game API. Empty means local-only play (no server configured at build time). */
export const API_BASE: string = ((import.meta.env?.VITE_API_BASE as string | undefined) ?? "").replace(/\/+$/, "");

const SAVE_KEY = "ck_save_v1"; // same key as before, so existing saves keep working
const TOKEN_KEY = "ck_token_v1";
const QUEUE_KEY = "ck_queue_v1";

export type Mode = "local" | "connecting" | "online" | "offline";
export type Reply = { ok: true; result?: unknown } | { ok: false; error: string };

interface Queued {
  cid: string;
  action: Action;
}

interface ServerView {
  ok: boolean;
  error?: string;
  result?: unknown;
  state?: GameState;
  version?: number;
  battle?: { stageId: string; seed: number; team: string[]; startedAt: number } | null;
  token?: string;
  imported?: boolean;
  replayed?: boolean;
}

/** Actions the client may predict locally and send later. Everything else needs the server. */
const PREDICTABLE = new Set(["build", "move", "upgrade", "sell", "harvest", "levelUp", "awaken", "setTeam"]);

function uid(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readJson<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full or blocked: play continues in memory */
  }
}

class Session {
  readonly data: GameData;
  state: GameState;
  mode: Mode = API_BASE ? "connecting" : "local";
  /** set when the last action was rolled back to the server's state */
  lastSyncError: string | null = null;

  private token: string | null = null;
  private queue: Queued[] = [];
  private localPending: PendingBattle | null = null;
  private flushing: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private starting: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  /** a battle the server started for us (online mode) */
  battle: { stageId: string; seed: number; team: string[]; startedAt: number } | null = null;

  constructor() {
    const chars = loadCharacterDefs();
    const skills = loadSkillDefs(chars);
    this.data = { buildings: loadBuildingDefs(), characters: chars, skills, stages: loadStageDefs(skills) };
    this.state = this.loadLocal();
    this.token = readJson<string>(TOKEN_KEY);
    this.queue = readJson<Queued[]>(QUEUE_KEY) ?? [];
  }

  private loadLocal(): GameState {
    return migrateState(readJson<unknown>(SAVE_KEY)) ?? newGameState();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const f of this.listeners) f();
  }

  private persist() {
    writeJson(SAVE_KEY, this.state);
    writeJson(QUEUE_KEY, this.queue);
  }

  /** Called once at boot. Never throws; falls back to local play when the server cannot be reached. */
  start(): Promise<void> {
    if (!API_BASE) {
      this.mode = "local";
      return Promise.resolve();
    }
    this.starting ??= this.connect();
    return this.starting;
  }

  private async http(path: string, init?: RequestInit): Promise<{ status: number; body: ServerView } | null> {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10_000);
      const res = await fetch(API_BASE + path, { ...init, signal: ctl.signal });
      clearTimeout(timer);
      let body: ServerView = { ok: false };
      try {
        body = (await res.json()) as ServerView;
      } catch {
        /* non-JSON error page */
      }
      return { status: res.status, body };
    } catch {
      return null;
    }
  }

  private auth(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  private async connect(): Promise<void> {
    this.mode = "connecting";
    if (this.token) {
      const r = await this.http("/api/state", { headers: this.auth() });
      if (!r) return this.goOffline();
      if (r.status === 200 && r.body.ok && r.body.state) {
        this.adopt(r.body);
        this.mode = "online";
        void this.flush();
        return;
      }
      if (r.status === 401) {
        // The account no longer exists on the server: keep the local save and register it again.
        this.token = null;
        try {
          localStorage.removeItem(TOKEN_KEY);
        } catch {
          /* ignore */
        }
        this.queue = [];
      } else return this.goOffline();
    }
    // First connect: hand the local save to the server once. The server clamps impossible values.
    const g = await this.http("/api/auth/guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ save: this.state }),
    });
    if (!g) return this.goOffline();
    if (g.status === 200 && g.body.ok && g.body.token && g.body.state) {
      this.token = g.body.token;
      writeJson(TOKEN_KEY, this.token);
      this.queue = [];
      this.adopt(g.body);
      this.mode = "online";
      return;
    }
    this.goOffline();
  }

  private goOffline() {
    // Never reached a server for this account: plain local play. Otherwise keep the queue and retry.
    this.mode = this.token ? "offline" : "local";
    this.scheduleRetry();
    this.emit();
  }

  private adopt(v: ServerView) {
    if (!v.state) return;
    this.state = v.state;
    this.battle = v.battle ?? null;
    this.persist();
    this.emit();
  }

  private scheduleRetry() {
    if (!API_BASE || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.mode === "online") return void this.flush();
      this.starting = null;
      void this.start().then(() => this.flush());
    }, 8_000);
  }

  /** true when gacha and battles can be played (server needed) or when we are purely local. */
  get canUseServerFeatures(): boolean {
    return this.mode === "local" ? true : this.mode === "online";
  }

  readonly offlineMessage = "Connect to the internet to use this";

  private ctx(extra: Partial<Parameters<typeof applyAction>[2]> = {}) {
    return { data: this.data, now: Date.now(), pending: this.localPending, ...extra };
  }

  /**
   * Apply an action the player can see instantly. The rules are the same ones the server runs.
   * The result is sent to the server in order; on a mismatch the state rolls back to the server's.
   */
  act(action: Action): Reply {
    if (!PREDICTABLE.has(action.type)) return { ok: false, error: "needs_server" };
    const out = applyAction(this.state, action, this.ctx());
    if (!out.ok) return { ok: false, error: out.error };
    this.state = out.state;
    if (this.mode !== "local") this.queue.push({ cid: uid(), action });
    this.persist();
    this.emit();
    if (this.mode !== "local") void this.flush();
    return { ok: true, result: out.result };
  }

  /** Sends queued actions one at a time, in order. Safe to call repeatedly. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.runFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async runFlush(): Promise<void> {
    while (this.queue.length > 0 && this.token) {
      const q = this.queue[0];
      const r = await this.http("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.auth() },
        body: JSON.stringify({ action: q.action, cid: q.cid }),
      });
      if (!r || r.status >= 500 || r.status === 409) {
        this.mode = "offline";
        this.scheduleRetry();
        this.emit();
        return;
      }
      if (r.status === 401) {
        this.mode = "offline";
        this.emit();
        return;
      }
      this.queue.shift();
      if (r.body.ok) {
        this.mode = "online";
        // keep the predicted state while more actions are waiting; otherwise take the server's
        if (this.queue.length === 0) this.adopt(r.body);
        else this.persist();
      } else {
        // Rejected: the server's state is the truth. Later queued actions were built on this one.
        this.queue = [];
        this.lastSyncError = r.body.error ?? "rejected";
        this.mode = "online";
        this.adopt(r.body);
        return;
      }
    }
    this.persist();
  }

  /** Waits until everything queued has reached the server. */
  private async drain(): Promise<boolean> {
    await this.flush();
    return this.queue.length === 0 && this.mode === "online";
  }

  private async serverAction(action: Action): Promise<Reply> {
    if (!(await this.drain())) return { ok: false, error: "offline" };
    const cid = uid();
    return this.sendOnce(action, cid);
  }

  private async sendOnce(action: Action, cid: string): Promise<Reply> {
    const r = await this.http("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.auth() },
      body: JSON.stringify({ action, cid }),
    });
    if (!r || r.status >= 500 || r.status === 409 || r.status === 401) {
      this.mode = "offline";
      this.scheduleRetry();
      this.emit();
      return { ok: false, error: "offline" };
    }
    this.mode = "online";
    this.adopt(r.body);
    return r.body.ok ? { ok: true, result: r.body.result } : { ok: false, error: r.body.error ?? "rejected" };
  }

  /** Gacha: the server rolls. In local-only play the browser rolls. */
  async gacha(count: number): Promise<Reply> {
    if (this.mode === "local") {
      const out = applyAction(this.state, { type: "gacha", count }, this.ctx({ rng: Math.random }));
      if (!out.ok) return { ok: false, error: out.error };
      this.state = out.state;
      this.persist();
      this.emit();
      return { ok: true, result: out.result };
    }
    return this.serverAction({ type: "gacha", count });
  }

  /** Starts a battle and returns the seed and team snapshot to simulate. */
  async startBattle(stageId: string): Promise<{ ok: true; seed: number; team: string[] } | { ok: false; error: string }> {
    if (this.mode === "local") {
      const out = applyAction(this.state, { type: "battleStart", stageId }, this.ctx({ seed: (Math.random() * 2 ** 31) | 0 }));
      if (!out.ok) return { ok: false, error: out.error };
      this.state = out.state;
      this.localPending = out.pending;
      return { ok: true, seed: out.pending!.seed, team: out.pending!.team };
    }
    const r = await this.serverAction({ type: "battleStart", stageId });
    if (!r.ok || !this.battle) return { ok: false, error: r.ok ? "no_battle" : r.error };
    return { ok: true, seed: this.battle.seed, team: this.battle.team };
  }

  private endCid: string | null = null;

  /**
   * Reports the finished battle. Safe to call again after a failure: the same request id is reused so a
   * retry can never pay out twice.
   */
  async endBattle(inputs: unknown[], claimed: "win" | "lose"): Promise<Reply> {
    const action: Action = { type: "battleEnd", inputs: inputs as never, claimed };
    if (this.mode === "local") {
      const out = applyAction(this.state, action, this.ctx({ now: Date.now() + 1e9 }));
      this.localPending = null;
      if (!out.ok) return { ok: false, error: out.error };
      this.state = out.state;
      this.persist();
      this.emit();
      return { ok: true, result: out.result };
    }
    this.endCid ??= uid();
    const r = await this.sendOnce(action, this.endCid);
    if (r.ok || r.error !== "offline") this.endCid = null;
    return r;
  }

  /** Abandons a started battle (retreat). */
  abandonBattle(): void {
    this.localPending = null;
    this.endCid = null;
    if (this.mode === "online") void this.serverAction({ type: "battleEnd", inputs: [], abort: true });
  }
}

let instance: Session | null = null;
export function session(): Session {
  instance ??= new Session();
  return instance;
}
export type { Session };

import type { GameState, PendingBattle } from "@ck/shared";

export interface Account {
  id: string;
  state: GameState;
  pending: PendingBattle | null;
  version: number;
  lastCid: string | null;
  lastResponse: string | null;
}

export interface SaveInput {
  state: GameState;
  pending: PendingBattle | null;
  lastCid: string | null;
  lastResponse: string | null;
}

/** Storage boundary. `save` is a compare-and-set on `version`: it returns false when another write won. */
export interface Store {
  create(id: string, tokenHash: string, state: GameState, now: number): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Account | null>;
  save(id: string, expectedVersion: number, next: SaveInput, now: number): Promise<boolean>;
}

export class MemoryStore implements Store {
  private rows = new Map<string, Account & { tokenHash: string }>();
  /** test hook: runs once right before the next save, to simulate a concurrent writer */
  beforeSave: (() => void) | null = null;
  saves = 0;

  async create(id: string, tokenHash: string, state: GameState): Promise<void> {
    this.rows.set(id, { id, tokenHash, state: structuredClone(state), pending: null, version: 0, lastCid: null, lastResponse: null });
  }

  async findByTokenHash(tokenHash: string): Promise<Account | null> {
    for (const r of this.rows.values()) {
      if (r.tokenHash === tokenHash) return structuredClone({ ...r, tokenHash: undefined }) as Account;
    }
    return null;
  }

  async save(id: string, expectedVersion: number, next: SaveInput): Promise<boolean> {
    const hook = this.beforeSave;
    this.beforeSave = null;
    hook?.();
    const r = this.rows.get(id);
    if (!r || r.version !== expectedVersion) return false;
    r.state = structuredClone(next.state);
    r.pending = structuredClone(next.pending);
    r.lastCid = next.lastCid;
    r.lastResponse = next.lastResponse;
    r.version += 1;
    this.saves += 1;
    return true;
  }

  /** test helper: simulate another request bumping the row */
  touch(id: string): void {
    const r = this.rows.get(id);
    if (r) r.version += 1;
  }
}

interface Row {
  id: string;
  state: string;
  pending: string | null;
  version: number;
  last_cid: string | null;
  last_response: string | null;
}

export class D1Store implements Store {
  constructor(private db: D1Database) {}

  async create(id: string, tokenHash: string, state: GameState, now: number): Promise<void> {
    await this.db
      .prepare("INSERT INTO accounts (id, token_hash, state, pending, version, created_at, updated_at) VALUES (?, ?, ?, NULL, 0, ?, ?)")
      .bind(id, tokenHash, JSON.stringify(state), now, now)
      .run();
  }

  async findByTokenHash(tokenHash: string): Promise<Account | null> {
    const r = await this.db
      .prepare("SELECT id, state, pending, version, last_cid, last_response FROM accounts WHERE token_hash = ?")
      .bind(tokenHash)
      .first<Row>();
    if (!r) return null;
    return {
      id: r.id,
      state: JSON.parse(r.state) as GameState,
      pending: r.pending ? (JSON.parse(r.pending) as PendingBattle) : null,
      version: r.version,
      lastCid: r.last_cid,
      lastResponse: r.last_response,
    };
  }

  async save(id: string, expectedVersion: number, next: SaveInput, now: number): Promise<boolean> {
    const res = await this.db
      .prepare(
        "UPDATE accounts SET state = ?, pending = ?, last_cid = ?, last_response = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
      )
      .bind(
        JSON.stringify(next.state),
        next.pending ? JSON.stringify(next.pending) : null,
        next.lastCid,
        next.lastResponse,
        now,
        id,
        expectedVersion,
      )
      .run();
    return (res.meta?.changes ?? 0) === 1;
  }
}

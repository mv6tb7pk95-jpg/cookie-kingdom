# Server (Phase 4)

Accounts and server-authoritative rules for Cookie Kingdom. Cloudflare Workers + Hono + D1.

## Structure

- `packages/shared/src/actions.ts`: `applyAction(state, action, ctx)`, the one rule entry point. The client uses it to predict, the server uses it as the authority. It works on a copy and never mutates its input; invalid input returns `{ ok: false }`.
- `packages/shared/src/replay.ts`: re-simulates a battle from the server's seed and team snapshot plus the player's recorded inputs.
- `packages/shared/src/sanitize.ts`: clamps a local save imported on first connect.
- `apps/server/src/app.ts`: HTTP API. `store.ts`: `Store` interface, `MemoryStore` (tests) and `D1Store`.
- `apps/client/src/session.ts`: shared session state for all scenes.

## API

All bodies are JSON. Authenticated calls send `Authorization: Bearer <token>`.

| Method and path | Purpose |
|---|---|
| `GET /api/health` | liveness |
| `POST /api/auth/guest` `{ save? }` | creates an account, returns the token once. Only its SHA-256 hash is stored. An optional local save is clamped and imported. |
| `GET /api/state` | `{ state, version, battle }` |
| `POST /api/action` `{ action, cid }` | applies one action. `cid` makes a retry idempotent. A rejected action returns `ok: false` with the authoritative state so the client can roll back. |

Actions: build, move, upgrade, sell, harvest, gacha, levelUp, awaken, setTeam, battleStart, battleEnd.

## Battles

1. `battleStart`: the server picks the seed (crypto RNG) and snapshots the team.
2. The client simulates with that seed and records only manual-skill and auto-toggle inputs.
3. `battleEnd`: the server re-simulates. It rejects skill inputs that are not possible (cooldown, unknown or dead unit), a claimed result that differs from the simulation, and results that arrive faster than the battle could finish at x3 speed. Rewards come from the server simulation only.

## Concurrency

Writes are compare-and-set on `accounts.version`. On a conflict the request is re-read and re-applied (up to 5 times), so a single request is charged once. The last response is stored with its `cid`, so a repeated request returns the same answer.

## Deploy

1. `npx wrangler d1 create cookie-kingdom`, then put the returned id into `apps/server/wrangler.toml`.
2. `npx wrangler d1 migrations apply cookie-kingdom --remote` (run in `apps/server`).
3. `npx wrangler deploy` (run in `apps/server`). The `deploy.yml` workflow does this manually and needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Set the repository variable `API_BASE` to the Worker URL (no trailing slash) and re-run the Pages workflow. The client reads it as `VITE_API_BASE` at build time. Without it the game plays local-only.

## Limitations

- No rate limiting. The API is public.
- No login or account recovery. The token lives in the browser's storage; clearing it loses the account.
- The first-time migration save is clamped, but it is supplied by the client, so initial progress can still be inflated up to the caps in `sanitize.ts`.
- `D1Store` is type-checked but has only been exercised through the in-memory store in tests.
- CORS allows any origin.
- Offline: predictable actions queue locally and sync later; gacha and battles need a connection once an account exists.

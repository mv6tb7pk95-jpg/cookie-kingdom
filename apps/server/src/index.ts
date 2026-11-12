import { createApp, cryptoDeps } from "./app";
import { D1Store } from "./store";
import { gameData } from "./data";

export interface Env {
  DB: D1Database;
}

export default {
  fetch(req: Request, env: Env): Promise<Response> | Response {
    return createApp({ store: new D1Store(env.DB), data: gameData, ...cryptoDeps() }).fetch(req);
  },
};

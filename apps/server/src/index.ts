import { Hono } from "hono";
import type { HealthResponse } from "@ck/shared";

const app = new Hono();

app.get("/api/health", (c) => {
  const body: HealthResponse = { ok: true, version: "0.0.1" };
  return c.json(body);
});

export default app;

// Scout sidecar: a tiny localhost HTTP wrapper so FastAPI can call the one TypeScript implementation.
//   POST /decide   { prompt, surface, user?, context?, approvals? }  ->  Decision (JSON)
//   GET  /healthz  ->  { status, registryVersion, policyPackVersion }
// Requires SCOUT_SIGNING_SECRET (the same value FastAPI uses to verify contracts). Prompts are never logged.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Scout } from "./index.ts";

const secret = process.env.SCOUT_SIGNING_SECRET;
if (!secret) {
  console.error("SCOUT_SIGNING_SECRET is not set. Set it (same value as the backend) and restart.");
  process.exit(1);
}
const host = process.env.SCOUT_HOST ?? "127.0.0.1"; // localhost only by default
const port = Number(process.env.SCOUT_PORT ?? 8765);
const registry = process.env.SCOUT_REGISTRY ?? fileURLToPath(new URL("../registry/upsc.json", import.meta.url));
const MAX_BODY = 256 * 1024;

const scout = new Scout({ intentRegistry: registry, policyPack: ["default", "adversarial-tight"], signingSecret: secret });

const send = (res: import("node:http").ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz")
    return send(res, 200, { status: "ok", registryVersion: scout.registry.version });
  if (req.method !== "POST" || req.url !== "/decide") return send(res, 404, { error: "not found" });

  let size = 0;
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => {
    size += c.length;
    if (size > MAX_BODY) { send(res, 413, { error: "body too large" }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", async () => {
    try {
      const input = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      if (typeof input.prompt !== "string" || typeof input.surface !== "string") return send(res, 400, { error: "prompt and surface are required" });
      send(res, 200, await scout.decide(input));
    } catch {
      send(res, 400, { error: "invalid request" });
    }
  });
}).listen(port, host, () => console.error(`Scout sidecar listening on http://${host}:${port}`));

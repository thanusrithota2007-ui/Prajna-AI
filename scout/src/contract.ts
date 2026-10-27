// Execution contract: canonical JSON, HMAC-SHA256 signing, TTL, verification (AGENTS.md section 8).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ExecutionContract } from "./types.js";

export const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Sorted-key, whitespace-free JSON. Undefined values are omitted. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

const hmac = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("hex");

export type Unsigned = Omit<ExecutionContract, "signature" | "signedBy">;

export function signContract(c: Unsigned, secret: string): ExecutionContract {
  const body = { ...c, signedBy: "scout" as const };
  return { ...body, signature: hmac(secret, canonicalJson(body)) };
}

export function verifyContract(
  c: ExecutionContract,
  secret: string,
  opts: { now?: Date; capability?: string } = {},
): { ok: boolean; reason?: string } {
  const { signature, ...rest } = c;
  const expected = Buffer.from(hmac(secret, canonicalJson(rest)));
  const given = Buffer.from(String(signature ?? ""));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "bad-signature" };
  if ((opts.now ?? new Date()).getTime() > Date.parse(c.expiresAt)) return { ok: false, reason: "expired" };
  if (opts.capability && !c.scope.capabilities.includes(opts.capability)) return { ok: false, reason: "scope-mismatch" };
  return { ok: true };
}

// Monotonic ULID (Crockford base32): 48-bit time + 80-bit randomness.
const ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastTime = -1;
let lastRand: number[] = [];
export function ulid(now = Date.now()): string {
  if (now <= lastTime) {
    now = lastTime;
    for (let i = 15; i >= 0; i--) {
      if (lastRand[i] < 31) {
        lastRand[i]++;
        break;
      }
      lastRand[i] = 0;
    }
  } else {
    lastTime = now;
    lastRand = [...randomBytes(16)].map((b) => b & 31);
  }
  let t = "";
  for (let n = now, i = 0; i < 10; i++, n = Math.floor(n / 32)) t = ENC[n % 32] + t;
  return t + lastRand.map((r) => ENC[r]).join("");
}

/** Signing secret: constructor option, else SCOUT_SIGNING_SECRET, else a random per-process secret (never hard-coded). */
export function resolveSecret(explicit?: string): string {
  return explicit ?? process.env.SCOUT_SIGNING_SECRET ?? randomBytes(32).toString("hex");
}

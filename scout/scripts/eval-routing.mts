// Measure routing on a fixture: node --import tsx scripts/eval-routing.mts test/fixtures/sealed-1.json [-v]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Scout } from "../src/index.ts";

const file = process.argv[2];
const verbose = process.argv.includes("-v");
const fx = JSON.parse(readFileSync(file, "utf-8"));
const s = new Scout({
  intentRegistry: fileURLToPath(new URL("../registry/upsc.json", import.meta.url)),
  policyPack: ["default", "adversarial-tight"],
  signingSecret: "x",
});
let n = 0;
const run = async (prompt: string) =>
  s.decide({ prompt, context: { evaluationId: "ev1" }, user: { id: "e" + n++, role: "student" }, surface: "api" });

const by: Record<string, { ok: number; total: number }> = {};
let wrong = 0, general = 0, clarif = 0;
for (const v of fx.valid) {
  const d = await run(v.prompt);
  const got = d.executionContract?.intent.primary.id;
  const b = (by[v.intent] ??= { ok: 0, total: 0 });
  b.total++;
  if (got === v.intent) b.ok++;
  else if (got?.startsWith("upsc.")) { wrong++; console.log("WRONG  ", v.intent, "->", got, "|", v.prompt); }
  else if (got === "GENERAL") { general++; if (verbose) console.log("miss/GEN", v.intent, `${d.candidates[0]?.intent}:${d.candidates[0]?.score}`, "|", v.prompt); }
  else { clarif++; if (verbose) console.log("miss/CLAR", v.intent, d.clarification?.trigger, "|", v.prompt); }
}
const leaks: string[] = [];
for (const p of fx.offtopic) {
  const d = await run(p);
  const got = d.executionContract?.intent.primary.id;
  if (got?.startsWith("upsc.")) leaks.push(`${got}  |  ${p}`);
}
const tot = Object.values(by).reduce((a, b) => a + b.total, 0), ok = Object.values(by).reduce((a, b) => a + b.ok, 0);
console.log(`\n${file}`);
for (const [k, b] of Object.entries(by)) console.log(`  ${k.padEnd(14)} ${b.ok}/${b.total}`);
console.log(`  correct ${ok}/${tot} | wrong-workflow ${wrong} | fell to GENERAL ${general} | clarified ${clarif}`);
console.log(`  off-topic leaked into upsc.*: ${leaks.length}/${fx.offtopic.length}`);
leaks.forEach((l) => console.log("   LEAK", l));

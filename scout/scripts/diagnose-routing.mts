// Why does a prompt miss? Prints tokens, which are known/unknown to each intent, and the score parts.
// Run from the scout/ folder:  node --import tsx scripts/diagnose-routing.mts
import { fileURLToPath } from "node:url";
import { IntentRegistry } from "../src/registry.ts";
import { Stage1Scanner, tokenize, bandOf } from "../src/scoring.ts";

const reg = IntentRegistry.load(fileURLToPath(new URL("../registry/upsc.json", import.meta.url)));
const sc: any = new Stage1Scanner(reg);
const CASES: [string, string][] = [
  ["Kindly assess the answer I wrote on Article 370", "upsc.evaluate"],
  ["How good is my answer on the Green Revolution? Please score it.", "upsc.evaluate"],
  ["Could you review and grade my response on cooperative federalism?", "upsc.evaluate"],
  ["I need marks and feedback for my ethics answer", "upsc.evaluate"],
  ["What made my analysis score lower than my language score?", "upsc.explain"],
  ["Walk me through the reasons behind my result", "upsc.explain"],
  ["Why such a low mark for clarity?", "upsc.explain"],
  ["How could I strengthen the introduction of my answer?", "upsc.improve"],
  ["What would make this answer score higher?", "upsc.improve"],
  ["Any suggestions to improve my analysis?", "upsc.improve"],
];
for (const [p, want] of CASES) {
  const toks = [...new Set(tokenize(p))];
  const scores = sc.scan(p);
  const top = scores[0];
  const ok = top && bandOf(top.score) !== "reject" && top.intent === want;
  console.log(`\n${ok ? "PASS" : "FAIL"}  want=${want}  "${p}"`);
  console.log("  tokens:", toks.map((t) => (sc.idf.has(t) ? `${t}(idf ${sc.idf.get(t).toFixed(2)})` : `${t}(UNKNOWN)`)).join(" "));
  for (const i of reg.intents) {
    const hit = toks.filter((t) => sc.profiles.get(i.id).uni.has(t));
    const s = scores.find((x: any) => x.intent === i.id)?.score ?? 0;
    console.log(`  ${i.id.padEnd(14)} score=${s.toFixed(3)}  matched: ${hit.join(", ") || "-"}`);
  }
  console.log(`  band=${top ? bandOf(top.score) : "reject"}  (need >= 0.40 to avoid reject, >= 0.55 to proceed)`);
}

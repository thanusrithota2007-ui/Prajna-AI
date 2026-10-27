// Is the right intent the TOP candidate even when its score is below the routing floor?
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Scout } from "../src/index.ts";
const s = new Scout({ intentRegistry: fileURLToPath(new URL("../registry/upsc.json", import.meta.url)), policyPack: ["default"], signingSecret: "x" });
for (const f of process.argv.slice(2)) {
  const fx = JSON.parse(readFileSync(f, "utf-8"));
  let top = 0, routed = 0; const scores: number[] = [];
  for (const v of fx.valid) {
    const c = (await s.classify({ prompt: v.prompt, surface: "api" })).candidates;
    if (c[0]?.intent === v.intent) { top++; scores.push(c[0].score); }
    if (c[0]?.intent === v.intent && c[0].score >= 0.55) routed++;
  }
  console.log(f, `top-candidate correct ${top}/${fx.valid.length}; of those scoring >= 0.55: ${routed}; median score of correct tops: ${scores.sort()[Math.floor(scores.length / 2)]}`);
}

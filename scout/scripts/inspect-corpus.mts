// Per-example view of the official corpus (not part of the harness): node --import tsx scripts/inspect-corpus.mts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Scout } from "../src/index.ts";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const base = join(root, "evals/regression-set/v1");
const s = new Scout({ intentRegistry: join(root, "evals/fixtures/intents.json"), policyPack: ["default","adversarial-tight"] });
for (const d of ["intents","edge-cases","multi-intent","injection"]) for (const f of readdirSync(join(base,d))) for (const l of readFileSync(join(base,d,f),"utf-8").split("\n").filter(Boolean)) {
  const ex = JSON.parse(l);
  const out:any = await s.decide({ prompt: ex.prompt, user:{id:"eval",role:ex.user?.role??"ae"}, surface: ex.surface??"chat" });
  const got = out.executionContract?.intent?.primary?.id;
  const exp = ex.expected.intent ?? (ex.expected.intents?.join("+")) ?? (ex.expected.injection!==undefined? "inj="+ex.expected.injection : "clar="+ex.expected.clarification);
  const mark = ex.expected.intent ? (got===ex.expected.intent?"OK ":"MISS") : "   ";
  console.log(mark, ex.id.padEnd(22), "exp=",String(exp).padEnd(20),"got=",String(got).padEnd(18),"risk=",out.risk.level,"band=",out.band,"top=",out.candidates.slice(0,3).map((c:any)=>c.intent+":"+c.score).join(","), out.clarification?"CLAR:"+out.clarification.trigger:"", out.plan?("PLAN:"+out.plan.map((p:any)=>p.intent).join("+")):"", out.risk.level==="block"?out.risk.reason:"");
}

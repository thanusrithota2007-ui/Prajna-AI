// Sense stage, Stage 1: deterministic weighted trigger scan (AGENTS.md section 4).
// Triggers are derived from each intent's own `examples` and `description`, so the
// scanner is registry-agnostic: nothing here knows about any particular domain.
import type { IntentRegistry } from "./registry.js";

const STOP = new Set(
  ("a an the and or of to for in on at by with from is are was were be been am do does did my me i you your " +
    "we our us it its this that these those what how can could would should will please about as into so just " +
    "if then than there their them they he she his her has have had not no yes up out any all some each").split(" "),
);

// Light, deterministic stemmer: strip plural/-ing/-ed, collapse doubled consonant, truncate to 6.
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ing")) {
    w = w.slice(0, -3);
    if (w.length > 3 && w[w.length - 1] === w[w.length - 2]) w = w.slice(0, -1);
  } else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w.length > 6 ? w.slice(0, 6) : w;
}

export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z0-9'-]*/g) ?? [];
  return words
    .map((w) => w.replace(/'s$/, ""))
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < tokens.length; i++) out.push(tokens[i] + " " + tokens[i + 1]);
  return out;
}

export type Weights = { lexical: number; semantic: number; contextual: number; recency: number };
export const CANONICAL_WEIGHTS: Weights = { lexical: 0.4, semantic: 0.35, contextual: 0.2, recency: 0.05 };

export type ScanConfig = {
  weights: Weights;
  /** Matched cue words needed before confidence saturates: evidence = 1 - exp(-matched / evidenceScale). */
  evidenceScale: number;
  /** Down-rank hook for intents requesting blocked actions (canonical formula term). */
  riskPenalty: (intentId: string) => number;
};

export const DEFAULT_SCAN: ScanConfig = {
  weights: CANONICAL_WEIGHTS,
  evidenceScale: 1.5,
  riskPenalty: () => 0,
};

// Description words are weaker evidence than example words (examples are the labelled seeds).
const DESCRIPTION_WEIGHT = 0.3;
const SINGLETON_WEIGHT = 0.6;

type Profile = { uni: Map<string, number>; bi: Set<string> };

export class Stage1Scanner {
  private profiles = new Map<string, Profile>();
  private idf = new Map<string, number>();

  constructor(registry: IntentRegistry, private cfg: ScanConfig = DEFAULT_SCAN) {
    const df = new Map<string, number>();
    for (const intent of registry.intents) {
      const uni = new Map<string, number>();
      const bi = new Set<string>();
      // A word seen in several of an intent's examples is a cue for that intent; a word seen once is more
      // likely a topic word (a subject such as "governor"), so it counts for less.
      const seen = new Map<string, number>();
      for (const ex of intent.examples) {
        const toks = tokenize(ex);
        new Set(toks).forEach((t) => seen.set(t, (seen.get(t) ?? 0) + 1));
        bigrams(toks).forEach((b) => bi.add(b));
      }
      for (const [t, c] of seen) uni.set(t, c >= 2 ? 1 : SINGLETON_WEIGHT);
      for (const t of tokenize(intent.description)) if (!uni.has(t)) uni.set(t, DESCRIPTION_WEIGHT);
      this.profiles.set(intent.id, { uni, bi });
      for (const t of uni.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    }
    const n = registry.intents.length;
    for (const [t, d] of df) this.idf.set(t, Math.log(1 + n / d));
  }

  /** Returns candidates sorted by score. `recency` maps intent -> 0..1 for the current user/session. */
  scan(prompt: string, recency: Map<string, number> = new Map()): { intent: string; score: number }[] {
    const toks = [...new Set(tokenize(prompt))];
    const bgs = [...new Set(bigrams(tokenize(prompt)))];
    const raw = new Map<string, number>();
    const matched = new Map<string, number>(); // how many cue words / phrases support each intent
    for (const [id, p] of this.profiles) {
      let r = 0;
      let m = 0;
      for (const t of toks) {
        const w = p.uni.get(t);
        if (w) {
          r += w * (this.idf.get(t) ?? 1);
          m += w >= SINGLETON_WEIGHT ? 1 : 0.5; // description-only words are half a cue
        }
      }
      for (const b of bgs) {
        if (p.bi.has(b)) {
          const [a, c] = b.split(" ");
          r += 1.5 * (((this.idf.get(a) ?? 1) + (this.idf.get(c) ?? 1)) / 2);
          m += 0.5; // a matching phrase is extra support
        }
      }
      raw.set(id, r);
      matched.set(id, m);
    }
    const total = [...raw.values()].reduce((a, b) => a + b, 0);
    // Stage 2 skipped: its weights (semantic 0.35 + contextual 0.20) are reallocated to the lexical term,
    // so the weights still sum to 1 and recency keeps its canonical 0.05. A later Stage 2 splits them back.
    const w = this.cfg.weights;
    const lexW = w.lexical + w.semantic + w.contextual;
    const out = [...raw].map(([intent, r]) => {
      // share = how exclusively this intent explains the matches; evidence = how many cue words back it.
      // One matching word is never enough for a confident route (evidence(1) is about 0.49).
      const evidence = 1 - Math.exp(-(matched.get(intent) ?? 0) / this.cfg.evidenceScale);
      const lexical = total > 0 ? (r / total) * evidence : 0;
      const rec = r > 0 ? recency.get(intent) ?? 0 : 0;
      const score = lexW * lexical + w.recency * rec - this.cfg.riskPenalty(intent);
      return { intent, score: Math.max(0, Math.round(score * 1000) / 1000) };
    });
    return out.filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
  }
}

export type Band = "high" | "medium" | "low" | "reject";
export type Bands = { high: number; medium: number; low: number };
export const DEFAULT_BANDS: Bands = { high: 0.8, medium: 0.55, low: 0.4 };

export function bandOf(score: number, b: Bands = DEFAULT_BANDS): Band {
  return score >= b.high ? "high" : score >= b.medium ? "medium" : score >= b.low ? "low" : "reject";
}

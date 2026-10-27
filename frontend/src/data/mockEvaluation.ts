// MOCK EVALUATION: demonstration data only.
//
// This module does NOT call any AI model. It reads a few simple, transparent
// signals from the submitted text (length against the limit, paragraph shape,
// examples, connectives, overlap with the question's key terms) and picks
// sample feedback from fixed wording. Scores are illustrative.
//
// When the real backend is ready, this file can be deleted: the UI only depends
// on the `EvaluationResult` type in ../types.ts.

import type {
  DimensionResult,
  EvaluationRequest,
  EvaluationResult,
  ImprovementPoint,
  SampleImprovement,
  StructureReview,
} from '../types';
import { clamp, countWords, roundHalf, splitParagraphs, splitSentences } from '../utils/text';

const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'analyse', 'analyze', 'because', 'before', 'being', 'between',
  'comment', 'critically', 'could', 'discuss', 'does', 'during', 'examine', 'explain', 'from', 'have', 'highlight',
  'india', 'indian', 'into', 'might', 'other', 'should', 'since', 'their', 'there', 'these', 'those', 'through',
  'under', 'until', 'what', 'when', 'where', 'which', 'while', 'with', 'within', 'would', 'your',
]);

const CONCLUSION_CUES =
  /\b(in conclusion|to conclude|to sum up|in summary|way forward|going forward|the way ahead|ultimately|overall|thus,|hence,|therefore,)/i;
const PERSPECTIVE_CUES =
  /\b(however|on the other hand|although|whereas|despite|critics|conversely|nevertheless|at the same time|trade-?off|challenge[s]?)\b/gi;
const CONNECTIVES =
  /\b(moreover|furthermore|therefore|consequently|hence|as a result|in addition|thus|similarly|for this reason|this leads to|which means)\b/gi;
const EXAMPLE_CUES = /\b(for example|for instance|such as|e\.g\.|case of|like the)\b/gi;
const NAMED_REFERENCES = /\b(Article\s+\d+|[A-Z][a-z]+\s+(?:Act|Committee|Commission|Mission|Scheme|Yojana|Abhiyan|Report)|NITI Aayog|Supreme Court)\b/g;
const YEARS_AND_FIGURES = /\b(?:1[89]\d{2}|20[0-4]\d)\b|\b\d+(?:\.\d+)?\s?(?:%|per cent|percent|crore|lakh)/gi;

interface Signals {
  words: number;
  coverage: number;
  paragraphs: string[];
  sentences: number;
  avgSentenceWords: number;
  longSentenceShare: number;
  relevance: number;
  missingTerms: string[];
  examples: number;
  perspectives: number;
  connectives: number;
  hasConclusionCue: boolean;
  introLooksSeparate: boolean;
  capitalisedShare: number;
}

function keyTerms(question: string): string[] {
  const seen = new Set<string>();
  for (const raw of question.toLowerCase().match(/[a-z]{5,}/g) ?? []) {
    if (!STOPWORDS.has(raw)) seen.add(raw);
  }
  return [...seen].slice(0, 10);
}

function hasTerm(answerLower: string, term: string): boolean {
  const stem = term.length > 7 ? term.slice(0, term.length - 3) : term.length > 5 ? term.slice(0, term.length - 1) : term;
  return answerLower.includes(stem);
}

function readSignals(req: EvaluationRequest): Signals {
  const words = countWords(req.answer);
  const paragraphs = splitParagraphs(req.answer);
  const sentences = splitSentences(req.answer);
  const sentenceWordCounts = sentences.map(countWords);
  const avgSentenceWords = sentences.length ? words / sentences.length : words;
  const longSentenceShare = sentences.length
    ? sentenceWordCounts.filter((n) => n > 35).length / sentences.length
    : 0;

  const answerLower = req.answer.toLowerCase();
  const terms = keyTerms(req.question);
  const matched = terms.filter((t) => hasTerm(answerLower, t));
  const missingTerms = terms.filter((t) => !hasTerm(answerLower, t)).slice(0, 3);
  const relevance = terms.length ? matched.length / terms.length : 0.6;

  const count = (re: RegExp) => (req.answer.match(re) ?? []).length;
  const examples =
    count(EXAMPLE_CUES) + count(NAMED_REFERENCES) + Math.min(2, count(YEARS_AND_FIGURES));

  const lastParagraph = paragraphs[paragraphs.length - 1] ?? '';
  const firstParagraph = paragraphs[0] ?? '';
  const introLooksSeparate =
    paragraphs.length >= 2 && countWords(firstParagraph) <= Math.max(60, words * 0.35);

  return {
    words,
    coverage: req.wordLimit ? words / req.wordLimit : 1,
    paragraphs,
    sentences: sentences.length,
    avgSentenceWords,
    longSentenceShare,
    relevance,
    missingTerms,
    examples,
    perspectives: count(PERSPECTIVE_CUES),
    connectives: count(CONNECTIVES),
    hasConclusionCue: CONCLUSION_CUES.test(lastParagraph) || (paragraphs.length === 1 && CONCLUSION_CUES.test(req.answer.slice(-220))),
    introLooksSeparate,
    capitalisedShare: sentences.length
      ? sentences.filter((s) => /^[A-Z0-9"'(“]/.test(s)).length / sentences.length
      : 1,
  };
}

function bandFor(score: number, max: number): DimensionResult['band'] {
  const pct = score / max;
  if (pct < 0.45) return 'Needs work';
  if (pct < 0.6) return 'Developing';
  if (pct < 0.75) return 'Solid';
  return 'Strong';
}

function scoreClarity(s: Signals): number {
  let v = 3.5 + 2.8 * s.relevance;
  v += s.paragraphs.length >= 3 ? 1.2 : s.paragraphs.length === 2 ? 0.6 : 0;
  v += Math.min(s.connectives, 3) * 0.35;
  if (s.hasConclusionCue) v += 0.5;
  if (s.coverage < 0.5 || s.coverage > 1.35) v -= 1;
  return roundHalf(clamp(v, 2, 9));
}

function scoreDepth(s: Signals): number {
  let v = 3 + Math.min(s.examples, 4) * 0.75 + Math.min(s.perspectives, 3) * 0.6;
  if (s.coverage >= 0.6 && s.coverage <= 1.25) v += 1;
  v += s.relevance * 0.8;
  return roundHalf(clamp(v, 2, 9));
}

function scoreLanguage(s: Signals): number {
  let v = 5.5;
  if (s.avgSentenceWords >= 12 && s.avgSentenceWords <= 25) v += 1.5;
  else if (s.avgSentenceWords <= 32) v += 0.5;
  else v -= 1;
  v -= s.longSentenceShare * 2.5;
  v += (s.capitalisedShare - 0.8) * 3;
  if (s.sentences < 3) v -= 1;
  return roundHalf(clamp(v, 3, 9));
}

function buildDimensions(s: Signals): DimensionResult[] {
  const max = 10;
  const clarity = scoreClarity(s);
  const depth = scoreDepth(s);
  const language = scoreLanguage(s);

  const termsNote = s.missingTerms.length
    ? ` Terms from the question that do not appear in your answer: ${s.missingTerms.join(', ')}.`
    : '';

  return [
    {
      key: 'clarity',
      label: 'Clarity of Thought',
      score: clarity,
      maxScore: max,
      band: bandFor(clarity, max),
      explanation:
        s.relevance >= 0.6
          ? `Your answer stays largely on the question, and ${s.paragraphs.length > 1 ? 'the paragraph breaks help the reader follow the order of ideas' : 'the ideas are recognisable, though they arrive as one block'}.`
          : 'Parts of the answer drift from what the question asks, so the central argument is harder to follow.',
      strength:
        s.connectives >= 2
          ? 'You link points with connectives such as "therefore" and "moreover", so the reader can follow how one idea leads to the next.'
          : s.relevance >= 0.6
            ? 'Most of the key terms in the question reappear in your argument, which signals that you are answering what was asked.'
            : 'You committed to a complete attempt, which gives a base to restructure from.',
      improvement:
        s.relevance < 0.6
          ? `Re-read the directive word (discuss, examine, critically analyse) and open with one sentence that answers it directly.${termsNote}`
          : s.paragraphs.length < 3
            ? 'Split the answer into an introduction, two or three body paragraphs and a short conclusion so each idea gets its own space.'
            : 'Start each body paragraph with a one-line claim, then support it. A reader skimming only first lines should still get your argument.',
    },
    {
      key: 'depth',
      label: 'Depth of Analysis',
      score: depth,
      maxScore: max,
      band: bandFor(depth, max),
      explanation:
        s.examples >= 2 && s.perspectives >= 1
          ? 'The answer supports its points with concrete references and acknowledges more than one side of the issue.'
          : s.examples >= 1
            ? 'There is some supporting evidence, but the reasoning stays mostly on one side and rarely explains why a point matters.'
            : 'The answer states points without much evidence or reasoning behind them, so it reads as description rather than analysis.',
      strength:
        s.examples >= 1
          ? `You included ${s.examples === 1 ? 'a concrete reference' : 'concrete references'} (an example, law, report or figure), which makes the argument more credible than general statements.`
          : s.perspectives >= 1
            ? 'You acknowledge a counter-point or challenge instead of presenting the issue as one-sided.'
            : 'Your points are relevant to the topic, which gives you material to deepen.',
      improvement:
        s.perspectives === 0
          ? 'Add at least one counter-argument or limitation (for example, "however, implementation has been uneven because…") and say how it affects your conclusion.'
          : s.examples < 2
            ? 'Back each main point with one specific example, committee, case, scheme or data point, and add a line on what it shows.'
            : 'Move from "what" to "so what": after each example, add one sentence on its implication for governance, society or the economy.',
    },
    {
      key: 'language',
      label: 'Language and Expression',
      score: language,
      maxScore: max,
      band: bandFor(language, max),
      explanation:
        s.avgSentenceWords > 28
          ? `Sentences average about ${Math.round(s.avgSentenceWords)} words, which is long for timed writing and can bury the main point.`
          : s.avgSentenceWords < 10 && s.sentences > 3
            ? `Sentences average about ${Math.round(s.avgSentenceWords)} words. They are clear but can feel choppy, so some could be combined.`
            : `Sentences average about ${Math.round(s.avgSentenceWords)} words, a readable length for formal examination writing.`,
      strength:
        s.longSentenceShare === 0 && s.avgSentenceWords <= 28
          ? 'Your sentences are a manageable length, so a hurried examiner can read them without re-reading.'
          : s.capitalisedShare > 0.9
            ? 'Sentence openings are consistently formatted, which keeps the answer tidy.'
            : 'The vocabulary is generally appropriate for a formal register.',
      improvement:
        s.longSentenceShare > 0.15
          ? 'Break sentences over 35 words into two. Lead with the subject and verb, then add qualifications.'
          : s.avgSentenceWords < 10 && s.sentences > 3
            ? 'Join short related sentences with a connective so your reasoning reads as a chain, not a list.'
            : 'Replace general words ("good", "problem", "many") with exact terms, and trim filler phrases to save words.',
    },
  ];
}

function buildStructure(s: Signals): StructureReview[] {
  return [
    {
      part: 'Introduction',
      status: s.introLooksSeparate ? 'observed' : 'unclear',
      note: s.introLooksSeparate
        ? 'The opening is a separate, short paragraph. Check that it defines the issue or answers the directive directly.'
        : 'No separate opening paragraph was detected. A one- or two-line opening is common, but some questions can be answered directly from the first sentence.',
    },
    {
      part: 'Body',
      status: s.paragraphs.length >= 3 || (s.paragraphs.length === 2 && s.words > 120) ? 'observed' : 'unclear',
      note:
        s.paragraphs.length >= 3
          ? `The body spans ${Math.max(1, s.paragraphs.length - 2)} paragraph${s.paragraphs.length - 2 === 1 ? '' : 's'}. Check that each one makes a single, distinct point.`
          : 'The main arguments run together. Dimensions or sub-headings can help, depending on what the question asks.',
    },
    {
      part: 'Conclusion',
      status: s.hasConclusionCue ? 'observed' : 'unclear',
      note: s.hasConclusionCue
        ? 'The ending signals a conclusion or way forward. Check that it adds a judgment, not a repeat.'
        : 'No concluding signal was detected. Many questions expect a way forward or balanced verdict, but a short answer may end on its last argument.',
    },
  ];
}

function buildStrengths(s: Signals, dims: DimensionResult[]): string[] {
  const out: string[] = [];
  if (s.relevance >= 0.6) out.push('Your argument stays tied to the language of the question, which keeps the answer relevant from start to finish.');
  if (s.examples >= 1) out.push('You used specific references (examples, laws, reports or figures) to support points, instead of relying on general claims.');
  if (s.connectives >= 2) out.push('Connectives like "therefore" and "moreover" show the reasoning links between your points.');
  if (s.perspectives >= 1) out.push('You acknowledged a challenge or counter-view, a habit that examiners tend to value in analytical questions.');
  if (s.coverage >= 0.7 && s.coverage <= 1.15) out.push(`At ${s.words} words, you used the space well relative to your ${Math.round(s.words / s.coverage)}-word limit.`);
  if (s.avgSentenceWords >= 12 && s.avgSentenceWords <= 25) out.push('Your sentence length is well suited to timed, formal writing.');
  for (const d of dims) {
    if (out.length >= 2) break;
    if (d.strength) out.push(d.strength);
  }
  return out.slice(0, 4);
}

function buildImprovements(s: Signals): ImprovementPoint[] {
  const out: ImprovementPoint[] = [];
  if (s.relevance < 0.6) {
    out.push({
      title: 'Answer the directive word first',
      action: `Open with a sentence that responds to the exact task in the question.${s.missingTerms.length ? ` Work in: ${s.missingTerms.join(', ')}.` : ''}`,
      reason: 'Examiners assess whether you answered what was asked before anything else.',
    });
  }
  if (s.perspectives === 0) {
    out.push({
      title: 'Add a counter-view or limitation',
      action: 'Include one "however…" sentence that names a challenge, criticism or exception.',
      reason: 'Balanced analysis shows depth, and it makes your conclusion more convincing.',
    });
  }
  if (s.examples < 2) {
    out.push({
      title: 'Support main points with evidence',
      action: 'Attach one example, committee, case, scheme or data point to each major argument.',
      reason: 'Specifics separate analysis from description, and they are easier to credit.',
    });
  }
  if (s.coverage < 0.6) {
    out.push({
      title: 'Use more of the available space',
      action: `You wrote ${s.words} words against a limit of about ${Math.round(s.words / Math.max(s.coverage, 0.01))}. Add a second dimension or an example.`,
      reason: 'A very short answer may leave marks unclaimed.',
    });
  } else if (s.coverage > 1.2) {
    out.push({
      title: 'Tighten to the word limit',
      action: 'Cut repeated points and descriptive background. Keep the argument and evidence.',
      reason: 'In the exam you will run out of time before you run out of material.',
    });
  }
  if (s.longSentenceShare > 0.15) {
    out.push({
      title: 'Shorten the longest sentences',
      action: 'Split any sentence over about 35 words at its first natural break.',
      reason: 'Short sentences carry your point faster to a reader marking many scripts.',
    });
  }
  if (s.paragraphs.length < 3) {
    out.push({
      title: 'Give the answer visible shape',
      action: 'Use separate paragraphs for the opening, each main point, and the close.',
      reason: 'Shape lets the examiner find your argument at a glance.',
    });
  }
  if (out.length < 2) {
    out.push({
      title: 'Push from "what" to "so what"',
      action: 'End each example with one sentence on its implication.',
      reason: 'Implications are where analysis shows up.',
    });
  }
  return out.slice(0, 4);
}

function buildNextSteps(s: Signals): string[] {
  const steps = [
    'Underline the directive word in the next question before you write anything.',
    s.perspectives === 0
      ? 'Include one counter-view or limitation, then say how it shapes your conclusion.'
      : 'Keep your counter-view, and next time state which side the evidence favours.',
    s.examples < 2
      ? 'Attach one specific example, case or data point to each main argument.'
      : 'After each example, add one line on what it shows.',
    s.paragraphs.length < 3
      ? 'Write in separate paragraphs: opening, two or three points, conclusion.'
      : 'Lead each paragraph with a one-line claim.',
    'Rewrite this answer once using the feedback, then compare both versions.',
  ];
  return steps;
}

const SAMPLE_IMPROVEMENT: SampleImprovement = {
  caption:
    'Sample illustration using a different, made-up question. This is not a rewrite of your answer.',
  sampleQuestion: 'Examine the challenges in implementing cooperative federalism in India.',
  before:
    'Federalism is important for India. There are many problems in federalism. States and Centre have disputes. Government should solve these problems.',
  after:
    'Cooperative federalism treats the Centre and states as partners in policy. Its promise, seen in the GST Council, is shared decision-making. However, fiscal dependence of states on central transfers and disputes over governors’ roles limit that partnership. Strengthening forums such as the Inter-State Council would turn consultation into routine practice.',
  whatChanged: [
    'The opening defines the key term and responds to "examine".',
    'One named example (GST Council) replaces a general claim.',
    '"However" introduces a limitation and the reason behind it.',
    'The close names a specific way forward, not a general wish.',
  ],
};

export function buildMockEvaluation(req: EvaluationRequest): EvaluationResult {
  const s = readSignals(req);
  const dimensions = buildDimensions(s);
  const total = dimensions.reduce((sum, d) => sum + d.score, 0);
  const maxTotal = dimensions.reduce((sum, d) => sum + d.maxScore, 0);
  const pct = total / maxTotal;
  const score = roundHalf(clamp(pct * req.marks, 0, req.marks));

  const label =
    pct < 0.45 ? 'Needs foundational work' : pct < 0.6 ? 'Developing' : pct < 0.75 ? 'Solid foundation' : 'Strong attempt';

  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
  const strongest = [...dimensions].sort((a, b) => b.score - a.score)[0];

  return {
    id: `demo-${Date.now()}`,
    source: 'mock',
    overall: {
      score,
      maxScore: req.marks,
      label,
      summary: `Your ${s.words}-word answer is strongest in ${strongest.label.toLowerCase()} and has most room to grow in ${weakest.label.toLowerCase()}. Work on that area first.`,
    },
    dimensions,
    strengths: buildStrengths(s, dimensions),
    improvements: buildImprovements(s),
    nextSteps: buildNextSteps(s),
    structure: buildStructure(s),
    sampleImprovement: SAMPLE_IMPROVEMENT,
  };
}

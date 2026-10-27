// Shared types for the evaluation request and result.
// The backend contract is POST /agent/message (see services/apiMapping.ts for the mapping).
// Fields marked optional are produced by sample mode only; the backend has no source for them,
// so the UI hides those sections instead of inventing content.

export type Subject =
  | 'GS1'
  | 'GS2'
  | 'GS3'
  | 'GS4'
  | 'Essay'
  | 'Optional'
  | 'Other';

export interface EvaluationRequest {
  question: string;
  answer: string;
  subject: Subject;
  /** Total marks the question carries (e.g. 10, 15, 20, or a custom value). */
  marks: number;
  /** Word limit the aspirant is writing to. */
  wordLimit: number;
}

export type DimensionKey = 'clarity' | 'depth' | 'language';

export interface EvidenceItem {
  /** Words copied from the aspirant's answer. */
  quote: string;
  comment: string;
  /** False when the backend could not find the quote verbatim in the answer. Shown to the user. */
  verified: boolean;
}

export interface DimensionResult {
  key: DimensionKey;
  label: string;
  /** Score out of `maxScore`. */
  score: number;
  maxScore: number;
  /** Short word label so meaning never depends on colour alone. */
  band: 'Needs work' | 'Developing' | 'Solid' | 'Strong';
  explanation: string;
  /** Sample mode only. */
  strength?: string;
  /** Sample mode only. */
  improvement?: string;
  /** Backend mode: passages of the answer the feedback refers to. */
  evidence?: EvidenceItem[];
  /** Backend mode: concrete things to change for this criterion. */
  suggestions?: string[];
}

export interface ImprovementPoint {
  title: string;
  /** What to change. */
  action: string;
  /** Why it matters. Not provided by the backend. */
  reason?: string;
}

export type StructurePart = 'Introduction' | 'Body' | 'Conclusion';

export interface StructureReview {
  part: StructurePart;
  /** "observed" means a clear signal was found; "unclear" is a prompt to check, not an error. */
  status: 'observed' | 'unclear';
  note: string;
}

export interface SampleImprovement {
  /** Always shown to the user as an illustration, never as a rewrite of their answer. */
  caption: string;
  sampleQuestion: string;
  before: string;
  after: string;
  whatChanged: string[];
}

/** Whether the evaluation was saved to the aspirant's history. Only "saved" means it is stored. */
export interface PersistenceInfo {
  status: 'saved' | 'failed' | 'disabled';
  message: string;
}

export interface EvaluationResult {
  id: string;
  /** "mock" = local sample data. Anything else should come from the backend. */
  source: 'mock' | 'api';
  overall: {
    score: number;
    maxScore: number;
    label: string;
    summary: string;
  };
  dimensions: DimensionResult[];
  improvements: ImprovementPoint[];
  /** Backend mode only: set when the evaluation was stored, so follow-up requests can refer to it. */
  persistence?: PersistenceInfo;
  /** Sample mode only. */
  strengths?: string[];
  /** Sample mode only. */
  nextSteps?: string[];
  /** Sample mode only. */
  structure?: StructureReview[];
  /** Sample mode only. */
  sampleImprovement?: SampleImprovement;
}

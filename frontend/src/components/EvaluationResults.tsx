import { CircleAlert, CircleCheck, FlaskConical, MessageSquareText, RotateCcw, WandSparkles } from 'lucide-react';
import { useState } from 'react';
import type { EvaluationRequest, EvaluationResult } from '../types';
import { formatScore } from '../utils/text';
import { scrollToId } from '../utils/scroll';
import {
  ImprovementsSection,
  NextStepsSection,
  StrengthsSection,
  StructureSection,
} from './FeedbackSections';
import { ImprovePanel } from './ImprovePanel';
import { ScoreCard } from './ScoreCard';
import './EvaluationResults.css';

type View = 'feedback' | 'improve';

interface Props {
  request: EvaluationRequest;
  result: EvaluationResult;
  onEvaluateAnother: () => void;
}

export function EvaluationResults({ request, result, onEvaluateAnother }: Props) {
  const [view, setView] = useState<View>('feedback');
  const { overall } = result;
  const isDemo = result.source === 'mock';

  const switchView = (next: View) => {
    setView(next);
    scrollToId('results');
  };

  return (
    <section className="section results" id="results" aria-labelledby="results-title" tabIndex={-1}>
      <div className="container">
        <div className="section-head">
          <h2 id="results-title">Your evaluation</h2>
          {isDemo && (
            <p className="demo-badge">
              <FlaskConical size={16} aria-hidden="true" />
              Demonstration evaluation generated from sample data
            </p>
          )}
        </div>

        {/* Overall assessment */}
        <div className="overall">
          <div className="overall-score" aria-label={`Overall score ${formatScore(overall.score)} out of ${overall.maxScore}`}>
            <span className="overall-num">{formatScore(overall.score)}</span>
            <span className="overall-max">out of {overall.maxScore}</span>
          </div>
          <div className="overall-body">
            <span className="chip chip-green">{overall.label}</span>
            <p className="overall-summary">{overall.summary}</p>
            <p className="disclaimer">
              This is an AI-assisted practice assessment, not an official UPSC evaluation or a prediction of actual
              examination marks.
            </p>
            {result.persistence && (
              <p className={`persist persist-${result.persistence.status}`} role="status">
                {result.persistence.status === 'saved' ? (
                  <CircleCheck size={16} aria-hidden="true" />
                ) : (
                  <CircleAlert size={16} aria-hidden="true" />
                )}
                {result.persistence.message}
              </p>
            )}
            {isDemo && (
              <p className="disclaimer">
                In this version, the score and feedback come from simple rules applied to your text and fixed sample
                wording. No AI model has read your answer.
              </p>
            )}
          </div>
        </div>

        <div className="result-actions" role="group" aria-label="Result actions">
          <button type="button" className="btn btn-secondary" onClick={onEvaluateAnother}>
            <RotateCcw size={17} aria-hidden="true" />
            Evaluate Another Answer
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            aria-pressed={view === 'feedback'}
            onClick={() => switchView('feedback')}
          >
            <MessageSquareText size={17} aria-hidden="true" />
            Review My Feedback
          </button>
          <button
            type="button"
            className={`btn ${view === 'improve' ? 'btn-secondary' : 'btn-primary'}`}
            aria-pressed={view === 'improve'}
            onClick={() => switchView('improve')}
          >
            <WandSparkles size={17} aria-hidden="true" />
            Improve This Answer
          </button>
        </div>

        {view === 'feedback' ? (
          <div className="results-body">
            <div className="dimensions" role="list" aria-label="Evaluation dimensions">
              {result.dimensions.map((d) => (
                <div role="listitem" key={d.key}>
                  <ScoreCard dimension={d} />
                </div>
              ))}
            </div>

            <div className="fb-two">
              {result.strengths && <StrengthsSection items={result.strengths} />}
              <ImprovementsSection items={result.improvements} />
            </div>

            {(result.nextSteps || result.structure) && (
              <div className="fb-two">
                {result.nextSteps && <NextStepsSection steps={result.nextSteps} />}
                {result.structure && <StructureSection items={result.structure} />}
              </div>
            )}
          </div>
        ) : (
          <div className="results-body">
            <ImprovePanel sample={result.sampleImprovement} improvements={result.improvements} request={request} />
          </div>
        )}
      </div>
    </section>
  );
}

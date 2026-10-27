import { useEffect, useRef, useState } from 'react';
import { EvaluationCriteria } from './components/EvaluationCriteria';
import { EvaluationResults } from './components/EvaluationResults';
import { EvaluationWorkspace } from './components/EvaluationWorkspace';
import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { HowItWorks } from './components/HowItWorks';
import { Navbar } from './components/Navbar';
import type { EvaluationRequest, EvaluationResult } from './types';
import { FIRST_FIELD_SELECTOR, scrollToId } from './utils/scroll';

interface Evaluation {
  request: EvaluationRequest;
  result: EvaluationResult;
}

export default function App() {
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  // Changing this key remounts the workspace, which gives "evaluate another" a clean form.
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const justEvaluated = useRef(false);
  const resetRequested = useRef(false);

  const handleEvaluated = (request: EvaluationRequest, result: EvaluationResult) => {
    justEvaluated.current = true;
    setEvaluation({ request, result });
  };

  // Scroll to the results once they have rendered.
  useEffect(() => {
    if (evaluation && justEvaluated.current) {
      justEvaluated.current = false;
      scrollToId('results');
    }
  }, [evaluation]);

  // After the fresh workspace has mounted, bring it into view and focus the first field.
  useEffect(() => {
    if (resetRequested.current) {
      resetRequested.current = false;
      scrollToId('workspace', FIRST_FIELD_SELECTOR);
    }
  }, [workspaceKey]);

  const handleEvaluateAnother = () => {
    resetRequested.current = true;
    setEvaluation(null);
    setWorkspaceKey((k) => k + 1);
  };

  return (
    <>
      <a className="skip-link" href="#workspace">
        Skip to the workspace
      </a>
      <Navbar />
      <main>
        <Hero />
        <EvaluationWorkspace key={workspaceKey} onEvaluated={handleEvaluated} />
        {evaluation && (
          <EvaluationResults
            key={evaluation.result.id}
            request={evaluation.request}
            result={evaluation.result}
            onEvaluateAnother={handleEvaluateAnother}
          />
        )}
        <HowItWorks />
        <EvaluationCriteria />
      </main>
      <Footer />
    </>
  );
}

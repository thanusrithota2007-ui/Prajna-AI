import './Sections.css';

const CRITERIA = [
  {
    title: 'Clarity of thought',
    looksAt:
      'Whether the ideas are organised, relevant and coherent, and whether the answer responds directly to what the question asks.',
    example:
      'Your second paragraph moves to causes before the term is defined. Open with one line that answers "examine", then take causes next.',
  },
  {
    title: 'Depth of analysis',
    looksAt:
      'The quality of reasoning and arguments, the use of relevant examples, and whether more than one perspective is considered.',
    example:
      'You list three challenges but do not say which matters most. Add one counter-view and a scheme or report that shows the point in practice.',
  },
  {
    title: 'Language and expression',
    looksAt:
      'Readability, precision, grammar and sentence construction, judged by how well they suit formal examination writing.',
    example:
      'Two sentences run past 40 words. Split them, and replace "big problem" with the exact term, such as "fiscal imbalance".',
  },
];

export function EvaluationCriteria() {
  return (
    <section className="section criteria" id="criteria" aria-labelledby="criteria-title">
      <div className="container">
        <div className="section-head">
          <h2 id="criteria-title">What Prajna looks at</h2>
          <p>
            Feedback focuses on the quality of your reasoning and expression, not only grammar or keyword matching. These
            three criteria are Prajna's own practice lens. They are not an official or complete UPSC marking rubric.
          </p>
        </div>

        <div className="criteria-list">
          {CRITERIA.map((c) => (
            <article className="criteria-row" key={c.title}>
              <div className="criteria-main">
                <h3>{c.title}</h3>
                <p>{c.looksAt}</p>
              </div>
              <figure className="criteria-example">
                <figcaption>What useful feedback sounds like</figcaption>
                <blockquote>{c.example}</blockquote>
              </figure>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

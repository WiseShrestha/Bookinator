# That Book — five-book demonstration

A separate browser-local demonstration, not Claude's actual app or a 500-book production catalog.

The five targets are The Hunger Games, Harry Potter and the Philosopher's Stone, Twilight, To Kill a Mockingbird, and The Great Gatsby.

`fixture.json` is a small AI-curated feature fixture. Its Yes/No assumptions are not a human-reviewed, source-quoted labeling output. Do not merge its negative labels into the strict Core matrix as if independently verified. The probabilities are engineered weights, not measured factual certainty.

`engine.cjs` implements soft Bayesian updates, expected information gain, a penalty for repeating question groups, answer-history replay, explicit rejection, and shortlists. The UI uses all five answer options, Undo and restart. The chosen target is never supplied to the runtime engine.

For this five-book test only, guessing starts after three informative answers; the original larger-catalog brief uses six. The maximum here is ten questions. Do not silently change production thresholds to match this demonstration.

Run `node test-engine.cjs` to reproduce 15 checks. In clean simulations against the same fixture, all five titles were guessed in 3, 3, 4, 5, and 4 questions respectively. These are self-consistency results, not independent factual validation or human accuracy. A DOM smoke test also checked initial rendering, five answer buttons, answer events, Undo, and restart. No visual-browser QA is claimed.

The `widget-script.js` file is the JavaScript extracted from the inline test for syntax checking. It expects its companion markup and is not a standalone browser document. The editable inline fragment appears in this conversation. `standalone.html` wraps the same fragment with self-contained base styles for local use; it makes no model/API requests and saves no answers.

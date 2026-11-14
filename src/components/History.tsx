import type { Catalog } from "../engine/model.ts";
import { ANSWER_LABELS } from "../engine/model.ts";
import type { SessionState } from "../engine/session.ts";
import { CC } from "../game.ts";

export function DataBanner({ catalog }: { catalog: Catalog }) {
  if (catalog.data_status === "production") return null;
  return (
    <div className="banner" role="note">
      <strong>{catalog.data_status === "machine_labelled_unreviewed" ? "Unreviewed data." : "Development data."}</strong> {catalog.notice ?? "This catalog has not been reviewed."}
    </div>
  );
}

export function History({ state }: { state: SessionState }) {
  const rejectedTitles = [...state.rejected].map((b) => CC.books[b].title_en);
  return (
    <aside className="history" aria-label="Your answers so far">
      <h2>Your answers</h2>
      {state.answers.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ol>
          {state.answers.map((a, i) => (
            <li key={i}>
              <span className="h-q">{CC.questions[a.questionIndex].text}</span>
              <span className={`h-a h-${a.answer}`}>{ANSWER_LABELS[a.answer]}</span>
            </li>
          ))}
        </ol>
      )}
      {rejectedTitles.length > 0 && (
        <>
          <h3>Not these</h3>
          <ul className="rejected">
            {rejectedTitles.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

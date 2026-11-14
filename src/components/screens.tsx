import { useState, type RefObject } from "react";
import { matchingClues, type MatchingClue } from "../engine/explain.ts";
import { catalogLinks } from "../engine/links.ts";
import { ANSWERS, ANSWER_LABELS, type Answer, type CatalogBook } from "../engine/model.ts";
import type { Action, SessionState, ShortlistReason } from "../engine/session.ts";
import { CC, CONFIG, LINK_OPTIONS } from "../game.ts";
import { Availability } from "./Availability.tsx";

type Heading = RefObject<HTMLHeadingElement | null>;
type ActionOf<K extends Action["kind"]> = Extract<Action, { kind: K }>;

interface Common {
  headingRef: Heading;
  state: SessionState;
  onUndo: () => void;
  onRestart: () => void;
  canUndo: boolean;
}

function Controls({ onUndo, onRestart, canUndo }: Pick<Common, "onUndo" | "onRestart" | "canUndo">) {
  return (
    <div className="controls">
      <button className="ghost" onClick={onUndo} disabled={!canUndo}>
        ↶ Undo <kbd>U</kbd>
      </button>
      <button className="ghost" onClick={onRestart}>
        Start over
      </button>
    </div>
  );
}

function BookCard({ book, compact = false }: { book: CatalogBook; compact?: boolean }) {
  return (
    <div className={`book ${compact ? "compact" : ""}`}>
      <div className="cover" aria-hidden="true">
        <span>{book.title_en.slice(0, 1)}</span>
      </div>
      <div>
        <p className="book-title">{book.title_en}</p>
        {book.title_ko && <p className="book-alt" lang="ko">{book.title_ko}</p>}
        {!compact && book.aliases.length > 0 && <p className="book-alt small">Also: {book.aliases.join(" · ")}</p>}
        <p className="book-meta">
          {book.author}
          {book.first_publication_year ? ` · ${book.first_publication_year}` : ""}
        </p>
        {book.series_id && !compact && <p className="book-note">Part of a series — check which volume you mean.</p>}
      </div>
    </div>
  );
}

function ClueProvenance({ bookIndex, feature }: { bookIndex: number; feature: MatchingClue["feature"] }) {
  if (feature?.status === "supported" && feature.source_ids.length) {
    const src = CC.books[bookIndex].sources.find((x) => x.id === feature.source_ids[0]);
    if (src) {
      const host = new URL(src.url).hostname.replace(/^www\./, "");
      return (
        <span className="sourced">
          {" "}· source:{" "}
          <a href={src.url} target="_blank" rel="noopener noreferrer">{host}</a>
          {feature.reviewed ? "" : " (AI-checked)"}
        </span>
      );
    }
  }
  return <em className="unreviewed"> (unchecked label)</em>;
}

function Clues({ bookIndex, state }: { bookIndex: number; state: SessionState }) {
  const clues = matchingClues(CC, bookIndex, state.answers);
  if (clues.length === 0) return null;
  return (
    <div className="clues">
      <h3>Why this book</h3>
      <ul>
        {clues.map((c) => (
          <li key={c.questionId}>
            <span className="clue-q">{c.questionText}</span>
            <span className="clue-a">
              You said <b>{c.userAnswerLabel}</b> · catalog says <b>{c.catalogLabel}</b>
              <ClueProvenance bookIndex={bookIndex} feature={c.feature} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Links({ book }: { book: CatalogBook }) {
  const links = catalogLinks(book, LINK_OPTIONS);
  return (
    <div className="links">
      <h3>Find it in a catalog</h3>
      <ul>
        {links.map((l) => (
          <li key={l.url}>
            <a href={l.url} target="_blank" rel="noopener noreferrer">
              {l.label} ↗
            </a>
            <span className="muted">{l.description}</span>
          </li>
        ))}
      </ul>
      <Availability book={book} />
      <p className="muted small">Ask a librarian or check the library's own catalog for copies and the exact edition.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function StartScreen({ headingRef, onStart }: { headingRef: Heading; onStart: (film: boolean) => void }) {
  const [film, setFilm] = useState(false);
  const books = [...CC.books].sort((a, b) => a.title_en.localeCompare(b.title_en));
  return (
    <div className="card start">
      <h1 ref={headingRef} tabIndex={-1}>
        Can't remember the title?
      </h1>
      <p className="lede">
        Answer a few quick questions about what you <em>do</em> remember. No author, title or search terms needed.
      </p>
      <ol className="steps">
        <li>Think of a novel from the collection below.</li>
        <li>Answer with Yes, No, Probably — or Don't know.</li>
        <li>Get a best match and a link to the library catalog.</li>
      </ol>
      <label className="check">
        <input type="checkbox" checked={film} onChange={(e) => setFilm(e.target.checked)} />
        <span>I mostly remember the film or TV version</span>
      </label>
      <button className="primary big" onClick={() => onStart(film)}>
        Start
      </button>
      <details className="collection">
        <summary>See the {books.length} novels this prototype knows</summary>
        <ul>
          {books.map((b) => (
            <li key={b.id}>
              <b>{b.title_en}</b> <span className="muted">— {b.author}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

const ANSWER_ORDER: Answer[] = [...ANSWERS];

export function QuestionScreen(props: Common & { action: ActionOf<"ask">; onAnswer: (a: Answer) => void }) {
  const { action, headingRef, onAnswer } = props;
  const n = action.number;
  return (
    <div className="card question">
      <p className="progress" aria-label={`Question ${n} of at most ${CONFIG.maxQuestions}`}>
        Question {n} <span className="muted">· up to {CONFIG.maxQuestions}</span>
      </p>
      <div className="dots" aria-hidden="true">
        {Array.from({ length: CONFIG.maxQuestions }, (_, i) => (
          <span key={i} className={i < n - 1 ? "dot done" : i === n - 1 ? "dot now" : "dot"} />
        ))}
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="q-text">
        {action.question.text}
      </h1>
      <details className="definition">
        <summary>What counts?</summary>
        <p>{action.question.definition}</p>
      </details>
      <div className="answers" role="group" aria-label="Your answer">
        {ANSWER_ORDER.map((a, i) => (
          <button key={a} className={`answer a-${a}`} onClick={() => onAnswer(a)}>
            {ANSWER_LABELS[a]} <kbd>{i + 1}</kbd>
          </button>
        ))}
      </div>
      <p className="hint muted">Not sure? "Don't know" is always fine — it won't count against any book.</p>
      <Controls {...props} />
    </div>
  );
}

export function GuessScreen(
  props: Common & { action: ActionOf<"guess">; onAccept: () => void; onReject: () => void; onExit: () => void },
) {
  const { action, headingRef, state, onAccept, onReject, onExit } = props;
  return (
    <div className="card guess">
      <p className="eyebrow">My best match</p>
      <h1 ref={headingRef} tabIndex={-1} className="sr-only">
        My best match: {action.book.title_en}
      </h1>
      <BookCard book={action.book} />
      <Clues bookIndex={action.bookIndex} state={state} />
      <p className="ask-confirm">Is this your book?</p>
      <div className="row">
        <button className="primary" onClick={onAccept}>
          Yes, that's it <kbd>Y</kbd>
        </button>
        <button className="secondary" onClick={onReject}>
          No, keep going <kbd>N</kbd>
        </button>
      </div>
      <button className="link-btn" onClick={onExit}>
        My book probably isn't in this collection
      </button>
      <Controls {...props} />
    </div>
  );
}

const SHORTLIST_COPY: Record<ShortlistReason, string> = {
  rejections: "Two guesses missed, so here are my closest remaining matches.",
  question_cap: `That's ${CONFIG.maxQuestions} questions. Here are my closest matches.`,
  no_questions: "I've run out of useful questions. Here are my closest matches.",
  low_information: "My remaining questions can't tell these apart. Is it one of them?",
};

export function ShortlistScreen(
  props: Common & { action: ActionOf<"shortlist">; onPick: (id: string) => void; onExit: () => void },
) {
  const { action, headingRef, onPick, onExit } = props;
  return (
    <div className="card shortlist">
      <p className="eyebrow">Shortlist</p>
      <h1 ref={headingRef} tabIndex={-1}>
        {SHORTLIST_COPY[action.reason]}
      </h1>
      <ul className="choices">
        {action.books.map((b) => (
          <li key={b.id}>
            <button className="choice" onClick={() => onPick(b.id)} aria-label={`It's ${b.title_en}`}>
              <BookCard book={b} compact />
              <span className="choice-cta">This one</span>
            </button>
          </li>
        ))}
      </ul>
      <button className="secondary wide" onClick={onExit}>
        None of these — my book isn't here
      </button>
      <Controls {...props} />
    </div>
  );
}

export function FoundScreen(props: Common & { action: ActionOf<"found"> }) {
  const { action, headingRef, state, onRestart } = props;
  return (
    <div className="card found">
      <p className="eyebrow">Found it</p>
      <h1 ref={headingRef} tabIndex={-1} className="sr-only">
        Found: {action.book.title_en}
      </h1>
      <BookCard book={action.book} />
      <p className="muted small">
        {action.via === "guess" ? "Guessed" : "Picked from the shortlist"} after {state.answers.length} question
        {state.answers.length === 1 ? "" : "s"}.
      </p>
      <Clues bookIndex={action.bookIndex} state={state} />
      <Links book={action.book} />
      <div className="row">
        <button className="primary" onClick={onRestart}>
          Find another book
        </button>
        <button className="ghost" onClick={props.onUndo}>
          ↶ Undo
        </button>
      </div>
    </div>
  );
}

export function NoMatchScreen(props: Common & { action: ActionOf<"no_match"> }) {
  const { action, headingRef, onRestart } = props;
  return (
    <div className="card nomatch">
      <p className="eyebrow">No match</p>
      <h1 ref={headingRef} tabIndex={-1}>
        {action.reason === "all_rejected"
          ? "You've ruled out every book I know."
          : "Your book may not be in this collection yet."}
      </h1>
      <p>
        This prototype only knows {CC.books.length} novels, so a miss here doesn't mean your book doesn't exist. Librarians
        are very good at exactly this — bring them the clues you remember.
      </p>
      <ul className="help">
        <li>
          <a href="https://www.nypl.org/blog/2017/11/22/finding-book-forgotten-title" target="_blank" rel="noopener noreferrer">
            NYPL: finding a book when you've forgotten the title ↗
          </a>
        </li>
        <li>
          <a href="https://guides.loc.gov/lost-titles-forgotten-rhymes/finding-novels" target="_blank" rel="noopener noreferrer">
            Library of Congress: finding forgotten novels ↗
          </a>
        </li>
      </ul>
      <div className="row">
        <button className="primary" onClick={onRestart}>
          Try again
        </button>
        <button className="ghost" onClick={props.onUndo}>
          ↶ Undo
        </button>
      </div>
    </div>
  );
}

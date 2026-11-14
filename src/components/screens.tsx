import { useState, type ReactNode, type RefObject } from "react";
import { matchingClues, type MatchingClue } from "../engine/explain.ts";
import { catalogLinks } from "../engine/links.ts";
import { ANSWERS, ANSWER_LABELS, type Answer, type CatalogBook } from "../engine/model.ts";
import type { Action, SessionState, ShortlistReason } from "../engine/session.ts";
import { CC, CONFIG, LINK_OPTIONS } from "../game.ts";
import { Availability } from "./Availability.tsx";
import { Folio, type Mood } from "./Folio.tsx";

type Heading = RefObject<HTMLHeadingElement | null>;
type ActionOf<K extends Action["kind"]> = Extract<Action, { kind: K }>;

interface Common {
  headingRef: Heading;
  state: SessionState;
  onUndo: () => void;
  onRestart: () => void;
  canUndo: boolean;
}

// ---------------------------------------------------------------- building blocks

/** Mascot + speech bubble. `line` is Folio's flavour line; children are the real content. */
function Scene({ mood, line, kind, children }: { mood: Mood; line?: ReactNode; kind: string; children: ReactNode }) {
  return (
    <div className={`scene card ${kind}`}>
      <div className="scene-mascot">
        <Folio mood={mood} />
      </div>
      <div className="scene-body">
        {line && <p className="speaker">{line}</p>}
        {children}
      </div>
    </div>
  );
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

function hue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** A generated leather-bound cover (no cover images: their rights are not established). */
export function BookCover({ book, size = "lg" }: { book: CatalogBook; size?: "lg" | "sm" | "xs" }) {
  return (
    <div className={`cover cover-${size}`} style={{ ["--hue" as string]: hue(book.title_en) }} aria-hidden="true">
      <div className="cover-face">
        <span className="cover-orn">❦</span>
        {size !== "xs" && <span className="cover-title">{book.title_en}</span>}
        {size === "xs" && <span className="cover-initial">{book.title_en.replace(/^The /, "").slice(0, 1)}</span>}
        {size === "lg" && <span className="cover-author">{book.author}</span>}
      </div>
    </div>
  );
}

function BookCard({ book, compact = false }: { book: CatalogBook; compact?: boolean }) {
  return (
    <div className={`book ${compact ? "compact" : ""}`}>
      <BookCover book={book} size={compact ? "xs" : "lg"} />
      <div className="book-info">
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

function Confetti() {
  // Deterministic "flying pages" burst for the found screen.
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 18 }, (_, i) => (
        <span key={i} style={{ ["--i" as string]: i, ["--x" as string]: `${((i * 37) % 100) - 50}vw` }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- screens

export function StartScreen({ headingRef, onStart }: { headingRef: Heading; onStart: (film: boolean) => void }) {
  const [film, setFilm] = useState(false);
  const books = [...CC.books].sort((a, b) => a.title_en.localeCompare(b.title_en));
  return (
    <div className="hero card start">
      <div className="hero-mascot">
        <Folio mood="idle" size={260} />
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="hero-title">
        Can't remember the title?
      </h1>
      <p className="lede">
        Think of a novel. I'm <b>Folio</b>, and I'll find it from whatever you <em>do</em> remember. No author, title or
        search terms needed.
      </p>
      <ol className="steps">
        <li><span>1</span>Pick a book from my shelf below, in secret.</li>
        <li><span>2</span>Answer Yes, No, Probably — or Don't know.</li>
        <li><span>3</span>I name your book and show where to borrow it.</li>
      </ol>
      <label className="switch">
        <input type="checkbox" checked={film} onChange={(e) => setFilm(e.target.checked)} />
        <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
        <span>I mostly remember the film or TV version</span>
      </label>
      <button className="primary big glow" onClick={() => onStart(film)}>
        ✦ Start reading my mind
      </button>
      <details className="collection">
        <summary>See the {books.length} novels on my shelf</summary>
        <ul className="shelf">
          {books.map((b) => (
            <li key={b.id} title={`${b.title_en} — ${b.author}`}>
              <BookCover book={b} size="sm" />
              <span className="shelf-author">{b.author}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

const ANSWER_ORDER: Answer[] = [...ANSWERS];
const ANSWER_ICON: Record<Answer, string> = { yes: "✓", probably: "↑", dont_know: "?", probably_not: "↓", no: "✕" };

const ASK_LINES = [
  "Let's begin. Tell me…",
  "Interesting… now,",
  "Hmm. The ink is stirring…",
  "I'm turning the pages…",
  "Something is taking shape…",
  "The shelves are whispering…",
  "Closer now…",
  "I can almost read the spine…",
  "Just a little more…",
];

function askMood(n: number, last: Answer | undefined): Mood {
  if (last === "dont_know") return "puzzled";
  if (n <= 3) return "curious";
  return "thinking";
}

export function QuestionScreen(props: Common & { action: ActionOf<"ask">; onAnswer: (a: Answer) => void }) {
  const { action, headingRef, onAnswer, state } = props;
  const n = action.number;
  const last = state.answers[state.answers.length - 1]?.answer;
  return (
    <Scene mood={askMood(n, last)} kind="question" line={ASK_LINES[Math.min(n - 1, ASK_LINES.length - 1)]}>
      <div className="progress-row">
        <p className="progress" aria-label={`Question ${n} of at most ${CONFIG.maxQuestions}`}>
          Question <b>{n}</b> <span className="muted">/ {CONFIG.maxQuestions}</span>
        </p>
        <div className="dots" aria-hidden="true">
          {Array.from({ length: CONFIG.maxQuestions }, (_, i) => (
            <span key={i} className={i < n - 1 ? "dot done" : i === n - 1 ? "dot now" : "dot"} />
          ))}
        </div>
      </div>
      <div className="bubble" key={action.question.id}>
        <h1 ref={headingRef} tabIndex={-1} className="q-text">
          {action.question.text}
        </h1>
        <details className="definition">
          <summary>What counts?</summary>
          <p>{action.question.definition}</p>
        </details>
      </div>
      <div className="answers" role="group" aria-label="Your answer">
        {ANSWER_ORDER.map((a, i) => (
          <button key={a} className={`answer a-${a}`} onClick={() => onAnswer(a)}>
            <span className="answer-icon" aria-hidden="true">{ANSWER_ICON[a]}</span>
            {ANSWER_LABELS[a]} <kbd>{i + 1}</kbd>
          </button>
        ))}
      </div>
      <p className="hint muted">Not sure? "Don't know" is always fine — it won't count against any book.</p>
      <Controls {...props} />
    </Scene>
  );
}

export function GuessScreen(
  props: Common & { action: ActionOf<"guess">; onAccept: () => void; onReject: () => void; onExit: () => void },
) {
  const { action, headingRef, state, onAccept, onReject, onExit } = props;
  const second = state.rejected.size > 0;
  return (
    <Scene mood="confident" kind="guess" line={second ? "Wait — I see it now…" : "I see it… your book is…"}>
      <p className="eyebrow">My best match</p>
      <h1 ref={headingRef} tabIndex={-1} className="sr-only">
        My best match: {action.book.title_en}
      </h1>
      <div className="reveal" key={action.book.id}>
        <BookCard book={action.book} />
      </div>
      <Clues bookIndex={action.bookIndex} state={state} />
      <p className="ask-confirm">Is this your book?</p>
      <div className="row">
        <button className="primary glow" onClick={onAccept}>
          Yes, that's it! <kbd>Y</kbd>
        </button>
        <button className="secondary" onClick={onReject}>
          No, keep going <kbd>N</kbd>
        </button>
      </div>
      <button className="link-btn" onClick={onExit}>
        My book probably isn't in this collection
      </button>
      <Controls {...props} />
    </Scene>
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
    <Scene mood="puzzled" kind="shortlist" line="Hmm… the pages disagree. Help me out?">
      <p className="eyebrow">Shortlist</p>
      <h1 ref={headingRef} tabIndex={-1}>
        {SHORTLIST_COPY[action.reason]}
      </h1>
      <ul className="choices">
        {action.books.map((b, i) => (
          <li key={b.id} style={{ ["--i" as string]: i }}>
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
    </Scene>
  );
}

export function FoundScreen(props: Common & { action: ActionOf<"found"> }) {
  const { action, headingRef, state, onRestart } = props;
  const n = state.answers.length;
  return (
    <Scene mood="triumph" kind="found" line={action.via === "guess" ? "I knew it! Reading minds is my favourite genre." : "A fine choice. I'll remember that one."}>
      <Confetti />
      <p className="eyebrow">Found it</p>
      <h1 ref={headingRef} tabIndex={-1} className="sr-only">
        Found: {action.book.title_en}
      </h1>
      <div className="reveal">
        <BookCard book={action.book} />
      </div>
      <p className="muted small">
        {action.via === "guess" ? "Guessed" : "Picked from the shortlist"} after {n} question{n === 1 ? "" : "s"}.
      </p>
      <Clues bookIndex={action.bookIndex} state={state} />
      <Links book={action.book} />
      <div className="row">
        <button className="primary glow" onClick={onRestart}>
          Find another book
        </button>
        <button className="ghost" onClick={props.onUndo}>
          ↶ Undo
        </button>
      </div>
    </Scene>
  );
}

export function NoMatchScreen(props: Common & { action: ActionOf<"no_match"> }) {
  const { action, headingRef, onRestart } = props;
  return (
    <Scene mood="sad" kind="nomatch" line="Oh no… that one isn't on my shelves.">
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
    </Scene>
  );
}

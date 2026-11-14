// Game screens in the Bookinator design (sky, seagull, cloud buttons, sea). The "which book was it?"
// screen after a miss lives in Contribute.tsx.
import { useState, type RefObject } from "react";
import { ACTIVE_COLLECTION, COLLECTIONS, collectionHref, type CollectionId } from "../data/index.ts";
import { matchingClues, type MatchingClue } from "../engine/explain.ts";
import { catalogLinks } from "../engine/links.ts";
import { ANSWERS, type Answer } from "../engine/model.ts";
import type { Action, Session, SessionState } from "../engine/session.ts";
import { CC, CONFIG, LINK_OPTIONS } from "../game.ts";
import { ANSWER_TEXT, bookTitles, questionText, type Lang, type Strings } from "../i18n/index.ts";
import { Availability } from "./Availability.tsx";
import { ShareAnswers } from "./Contribute.tsx";
import { BookCard, Bubble, CloudButton, Hanging, Seagull, Sea, UndoIcon, type CloudShape } from "./scenery.tsx";

type Heading = RefObject<HTMLHeadingElement | null>;
type ActionOf<K extends Action["kind"]> = Extract<Action, { kind: K }>;

export interface Common {
  headingRef: Heading;
  state: SessionState;
  session: Session;
  t: Strings;
  lang: Lang;
  onUndo: () => void;
  onRestart: () => void;
  canUndo: boolean;
}

// ---------------------------------------------------------------- pieces

const CATALOG_LABEL: Record<Lang, Record<string, string>> = {
  ko: { Yes: "예", "Mostly yes": "대체로 예", "Mostly no": "대체로 아니오", No: "아니오" },
  en: { Yes: "Yes", "Mostly yes": "Mostly yes", "Mostly no": "Mostly no", No: "No" },
};

function ClueProvenance({ bookIndex, feature, t }: { bookIndex: number; feature: MatchingClue["feature"]; t: Strings }) {
  if (feature?.status === "supported" && feature.source_ids.length) {
    const src = CC.books[bookIndex].sources.find((x) => x.id === feature.source_ids[0]);
    if (src) {
      const host = new URL(src.url).hostname.replace(/^www\./, "");
      return (
        <span className="sourced">
          {" "}· {t.source}: <a href={src.url} target="_blank" rel="noopener noreferrer">{host}</a>
          {feature.reviewed ? "" : ` (${t.aiChecked})`}
        </span>
      );
    }
  }
  if (feature?.status === "community_consensus" && feature.consensus) {
    return <span className="sourced"> · {t.fromReaders(feature.consensus.contributors)}</span>;
  }
  return <em className="unreviewed"> ({t.unchecked})</em>;
}

function Clues({ bookIndex, state, t, lang, open = false }: { bookIndex: number; state: SessionState; t: Strings; lang: Lang; open?: boolean }) {
  const clues = matchingClues(CC, bookIndex, state.answers);
  if (clues.length === 0) return null;
  return (
    <details className="clues" open={open}>
      <summary>{t.whyThisBook}</summary>
      <ul>
        {clues.map((c) => (
          <li key={c.questionId}>
            <span className="clue-q">{questionText(CC.questions[CC.questionIndex.get(c.questionId)!], lang)}</span>
            <span className="clue-a">
              {t.youSaid} <b>{ANSWER_TEXT[lang][c.userAnswer]}</b> · {t.catalogSays} <b>{CATALOG_LABEL[lang][c.catalogLabel] ?? c.catalogLabel}</b>
              <ClueProvenance bookIndex={bookIndex} feature={c.feature} t={t} />
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Links({ bookIndex, t }: { bookIndex: number; t: Strings }) {
  const book = CC.books[bookIndex];
  return (
    <div className="links">
      <h2>{t.findInCatalog}</h2>
      <ul>
        {catalogLinks(book, LINK_OPTIONS).map((l) => (
          <li key={l.url}>
            <a href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
            <span className="muted">{l.description}</span>
          </li>
        ))}
      </ul>
      <Availability book={book} />
      <p className="muted small">{t.librarianTip}</p>
    </div>
  );
}

/** "My answers" drawer: the history sidebar of the previous design, folded away. */
function AnswersDrawer({ state, t, lang }: { state: SessionState; t: Strings; lang: Lang }) {
  if (state.answers.length === 0 && state.rejected.size === 0) return null;
  return (
    <details className="answers-drawer">
      <summary>{t.myAnswers(state.answers.length)}</summary>
      <ol>
        {state.answers.map((a, i) => (
          <li key={i}>
            <span>{questionText(CC.questions[a.questionIndex], lang)}</span>
            <b className={`chip chip-${a.answer}`}>{ANSWER_TEXT[lang][a.answer]}</b>
          </li>
        ))}
      </ol>
      {state.rejected.size > 0 && (
        <>
          <p className="drawer-sub">{t.notThese}</p>
          <ul className="rejected">
            {[...state.rejected].map((b) => (
              <li key={b}>{bookTitles(CC.books[b], lang).main}</li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}

// ---------------------------------------------------------------- home

export function StartScreen({ headingRef, onStart, t, lang }: { headingRef: Heading; onStart: (film: boolean) => void; t: Strings; lang: Lang }) {
  const [film, setFilm] = useState(false);
  const books = [...CC.books].sort((a, b) => bookTitles(a, lang).main.localeCompare(bookTitles(b, lang).main, lang));
  const shelfName: Record<CollectionId, string> = { classic: t.classicShelf, research: t.researchShelf };
  return (
    <div className="frame frame-home">
      <div className="sky sky-home">
        <div className="title-cloud">
          <svg viewBox="0 0 870 304" aria-hidden="true">
            <ellipse cx="172" cy="166" rx="172" ry="112" />
            <ellipse cx="432" cy="152" rx="212" ry="150" />
            <ellipse cx="692" cy="166" rx="178" ry="112" />
          </svg>
          <h1 ref={headingRef} tabIndex={-1}>{t.brand}</h1>
        </div>
        <p className="tagline">{t.tagline}</p>
        <Seagull className="home-gull" />
      </div>
      <Sea className="sea-home">
        <CloudButton shape="wide" className="start-cloud" label={t.start} onClick={() => onStart(film)} />
        <div className="home-options">
          <nav className="shelf-switch" aria-label={t.collectionsLabel}>
            {(Object.keys(COLLECTIONS) as CollectionId[]).map((id) => (
              <a key={id} href={collectionHref(id)} className="pill" aria-current={id === ACTIVE_COLLECTION ? "page" : undefined}>
                {shelfName[id]} · {t.booksCount(COLLECTIONS[id].catalog.books.length)}
              </a>
            ))}
          </nav>
          <label className="toggle">
            <input type="checkbox" checked={film} onChange={(e) => setFilm(e.target.checked)} />
            <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
            <span>{t.filmMode}</span>
          </label>
          <details className="shelf-list">
            <summary>{t.seeShelf(books.length)}</summary>
            <ul>
              {books.map((b) => (
                <li key={b.id}>
                  <b>{bookTitles(b, lang).main}</b> <span>{b.author}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </Sea>
    </div>
  );
}

// ---------------------------------------------------------------- question

// Design order, left to right: lilac (tall) and butter (wide) clouds alternate.
const SHAPE: Record<Answer, CloudShape> = { yes: "tall", probably: "wide", dont_know: "tall", probably_not: "wide", no: "tall" };

export function QuestionScreen(props: Common & { action: ActionOf<"ask">; onAnswer: (a: Answer) => void }) {
  const { action, headingRef, onAnswer, state, t, lang } = props;
  const n = action.number;
  return (
    <div className="frame frame-question">
      <div className="sky">
        <Hanging className="sign-hang" rope={150}>
          <p className="sign" aria-label={t.questionOf(n, CONFIG.maxQuestions)}>{t.question(n)}</p>
        </Hanging>
        <div className="scene">
          <Seagull mood="think" />
          <div className="scene-talk">
            <Bubble key={action.question.id}>
              <h1 ref={headingRef} tabIndex={-1} className="q-text">{questionText(action.question, lang)}</h1>
            </Bubble>
            <details className="definition">
              <summary>{t.whatCounts}</summary>
              <p lang="en">{action.question.definition}</p>
            </details>
            {props.canUndo && (
              // Phones: the design puts "previous question" under the bubble (the top bar has it on PC).
              <button type="button" className="pill pill-undo mobile-only" onClick={props.onUndo}>
                <UndoIcon />
                {t.prevQuestion}
              </button>
            )}
          </div>
        </div>
        <AnswersDrawer state={state} t={t} lang={lang} />
      </div>
      <Sea className="sea-answers">
        <div className="answer-clouds" role="group" aria-label={t.answersGroup}>
          {ANSWERS.map((a, i) => (
            <CloudButton key={a} shape={SHAPE[a]} className={`answer a-${a}`} label={ANSWER_TEXT[lang][a]} aria-keyshortcuts={String(i + 1)} onClick={() => onAnswer(a)} />
          ))}
        </div>
        <p className="sea-hint">{t.dontKnowHint}</p>
      </Sea>
    </div>
  );
}

// ---------------------------------------------------------------- guess

export function GuessScreen(props: Common & { action: ActionOf<"guess">; onAccept: () => void; onReject: () => void; onExit: () => void }) {
  const { action, headingRef, state, onAccept, onReject, onExit, onRestart, t, lang } = props;
  const again = state.rejected.size > 0;
  return (
    <div className="frame frame-guess">
      <div className="sky">
        <Hanging className="card-hang" rope={110}>
          <div className="reveal" key={action.book.id}>
            <BookCard book={action.book} lang={lang} />
          </div>
        </Hanging>
        <div className="scene">
          <Seagull mood="happy" />
          <div className="scene-talk">
            <Bubble>
              <h1 ref={headingRef} tabIndex={-1}>
                {again ? t.isThisItAgain : t.isThisIt}
                <span className="sr-only"> {bookTitles(action.book, lang).main}</span>
              </h1>
            </Bubble>
            <Clues bookIndex={action.bookIndex} state={state} t={t} lang={lang} />
            <button type="button" className="text-link" onClick={onExit}>{t.notInCollection}</button>
          </div>
        </div>
        <AnswersDrawer state={state} t={t} lang={lang} />
      </div>
      <Sea className="sea-answers">
        <div className="answer-clouds two">
          <CloudButton shape="tall" label={t.thatsIt} aria-keyshortcuts="Y" onClick={onAccept} />
          <CloudButton shape="wide" label={t.nope} aria-keyshortcuts="N" onClick={onReject} />
        </div>
        <button type="button" className="text-link sea-corner" onClick={onRestart}>{t.startOver}</button>
      </Sea>
    </div>
  );
}

// ---------------------------------------------------------------- shortlist

export function ShortlistScreen(props: Common & { action: ActionOf<"shortlist">; onPick: (id: string) => void; onExit: () => void }) {
  const { action, headingRef, onPick, onExit, onRestart, state, t, lang } = props;
  return (
    <div className="frame frame-shortlist">
      <div className="sky">
        <div className="scene">
          <Seagull mood="think" />
          <div className="scene-talk">
            <Bubble>
              <h1 ref={headingRef} tabIndex={-1}>{t.shortlistLine}</h1>
            </Bubble>
            <p className="scene-note">{t.shortlistReason[action.reason]}</p>
          </div>
        </div>
        <ul className="choices">
          {action.books.map((b, i) => (
            <li key={b.id} style={{ ["--i" as string]: i }}>
              <Hanging rope={40 + i * 24}>
                <button type="button" className="choice" onClick={() => onPick(b.id)}>
                  <BookCard book={b} lang={lang} small />
                  <span className="choice-cta">{t.thisOne}</span>
                </button>
              </Hanging>
            </li>
          ))}
        </ul>
        <AnswersDrawer state={state} t={t} lang={lang} />
      </div>
      <Sea className="sea-answers">
        <div className="answer-clouds one">
          <CloudButton shape="wide" label={t.noneOfThese} onClick={onExit} />
        </div>
        <button type="button" className="text-link sea-corner" onClick={onRestart}>{t.startOver}</button>
      </Sea>
    </div>
  );
}

// ---------------------------------------------------------------- found

export function FoundScreen(props: Common & { action: ActionOf<"found"> }) {
  const { action, headingRef, state, session, onRestart, onUndo, t, lang } = props;
  const viaGuess = action.via === "guess";
  return (
    <div className="frame frame-found">
      <div className="sky">
        <Hanging className="card-hang" rope={80}>
          <div className="reveal">
            <BookCard book={action.book} lang={lang} />
          </div>
        </Hanging>
        <div className="scene">
          <Seagull mood="happy" className="gull-hop" />
          <div className="scene-talk">
            <Bubble>
              <h1 ref={headingRef} tabIndex={-1}>
                {viaGuess ? t.foundLine : t.foundShortlistLine}
                <span className="sr-only"> {bookTitles(action.book, lang).main}</span>
              </h1>
            </Bubble>
            <p className="scene-note">{t.foundAfter(state.answers.length, viaGuess)}</p>
          </div>
        </div>
        <div className="sheet found-sheet">
          <Clues bookIndex={action.bookIndex} state={state} t={t} lang={lang} open />
          <Links bookIndex={action.bookIndex} t={t} />
          <ShareAnswers session={session} state={state} t={t} lang={lang} />
        </div>
      </div>
      <Sea className="sea-answers">
        <div className="answer-clouds one">
          <CloudButton shape="wide" label={t.anotherBook} onClick={onRestart} />
        </div>
        <button type="button" className="text-link sea-corner" onClick={onUndo}>{t.undo}</button>
      </Sea>
    </div>
  );
}

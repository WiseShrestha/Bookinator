import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTIVE_CATALOG } from "./data/index.ts";
import { ANSWERS, type Answer } from "./engine/model.ts";
import { applyEvent, deriveState, newSession, undo, type Session, type SessionEvent } from "./engine/session.ts";
import { CC, CONFIG, loadSession, saveSession } from "./game.ts";
import { DataBanner, History } from "./components/History.tsx";
import {
  FoundScreen,
  GuessScreen,
  NoMatchScreen,
  QuestionScreen,
  ShortlistScreen,
  StartScreen,
} from "./components/screens.tsx";

function safeDerive(session: Session) {
  try {
    return deriveState(CC, CONFIG, session);
  } catch {
    return null; // e.g. a saved session from an older catalog
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => {
    const saved = loadSession();
    return saved && safeDerive(saved) ? saved : null;
  });
  const state = useMemo(() => (session ? safeDerive(session) : null), [session]);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => saveSession(session), [session]);

  const dispatch = useCallback(
    (event: SessionEvent) => {
      if (!session || !state) return;
      try {
        setSession(applyEvent(CC, CONFIG, session, event, state));
      } catch {
        /* stale double-click: ignore */
      }
    },
    [session, state],
  );
  const onUndo = useCallback(() => setSession((s) => (s ? undo(s) : s)), []);
  const onRestart = useCallback(() => setSession(null), []);
  const onStart = useCallback((filmMemoryMode: boolean) => setSession(newSession({ filmMemoryMode })), []);

  // Move focus to the new heading whenever the screen or question changes (screen readers + keyboard).
  const screenKey = state ? `${state.action.kind}:${session?.events.length}` : "start";
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    // If the reader has scrolled past the top of the stage, bring the new screen into view.
    const stage = document.querySelector(".stage");
    if (stage && stage.getBoundingClientRect().top < 0) stage.scrollIntoView({ block: "start" });
  }, [screenKey]);

  // Global keyboard shortcuts: 1–5 answers, U undo, Y/N on a guess.
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const a = state.action;
      if (a.kind === "ask" && /^[1-5]$/.test(e.key)) {
        const answer: Answer = ANSWERS[Number(e.key) - 1];
        dispatch({ type: "answer", questionId: a.question.id, answer });
        e.preventDefault();
      } else if (a.kind === "guess" && (e.key === "y" || e.key === "Y")) {
        dispatch({ type: "accept", bookId: a.book.id });
      } else if (a.kind === "guess" && (e.key === "n" || e.key === "N")) {
        dispatch({ type: "reject", bookId: a.book.id });
      } else if ((e.key === "u" || e.key === "U") && session && session.events.length > 0) {
        onUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, session, dispatch, onUndo]);

  let screen;
  if (!session || !state) {
    screen = <StartScreen headingRef={headingRef} onStart={onStart} />;
  } else {
    const a = state.action;
    const common = { headingRef, state, onUndo, onRestart, canUndo: session.events.length > 0 };
    switch (a.kind) {
      case "ask":
        screen = <QuestionScreen {...common} action={a} onAnswer={(answer) => dispatch({ type: "answer", questionId: a.question.id, answer })} />;
        break;
      case "guess":
        screen = (
          <GuessScreen
            {...common}
            action={a}
            onAccept={() => dispatch({ type: "accept", bookId: a.book.id })}
            onReject={() => dispatch({ type: "reject", bookId: a.book.id })}
            onExit={() => dispatch({ type: "exit" })}
          />
        );
        break;
      case "shortlist":
        screen = (
          <ShortlistScreen
            {...common}
            action={a}
            onPick={(bookId) => dispatch({ type: "accept", bookId })}
            onExit={() => dispatch({ type: "exit" })}
          />
        );
        break;
      case "found":
        screen = <FoundScreen {...common} action={a} />;
        break;
      case "no_match":
        screen = <NoMatchScreen {...common} action={a} />;
        break;
    }
  }

  return (
    <div className="app">
      <Backdrop />
      <header className="masthead">
        <button className="brand" onClick={onRestart} aria-label="Bookinator — start over">
          <span className="brand-mark" aria-hidden="true">✦</span> Bookinator
        </button>
        <span className="tagline">Remember the story. Forget the title.</span>
      </header>
      <DataBanner catalog={ACTIVE_CATALOG} />
      <main className={`layout ${session && state ? "playing" : "idle"}`}>
        <section className="stage" aria-live="polite">
          {screen}
        </section>
        {session && state && <History state={state} />}
      </main>
      <footer className="foot">
        {ACTIVE_CATALOG.books.length} {ACTIVE_CATALOG.coverage ? "playable" : "supported"} novels
        {ACTIVE_CATALOG.coverage && ` (of ${ACTIVE_CATALOG.coverage.imported_source_records} imported records)`} · catalog{" "}
        {ACTIVE_CATALOG.catalog_version} · runs entirely in your browser
        {ACTIVE_CATALOG.credits && <span className="credits">{ACTIVE_CATALOG.credits}</span>}
      </footer>
    </div>
  );
}

/** Purely decorative night-library backdrop: stars, drifting motes and a bookshelf silhouette. */
function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="stars" />
      <div className="stars stars-2" />
      {Array.from({ length: 14 }, (_, i) => (
        <span key={i} className="mote" style={{ ["--i" as string]: i, left: `${(i * 53) % 100}%` }} />
      ))}
      <svg className="shelves" viewBox="0 0 1200 160" preserveAspectRatio="none">
        <path d={SHELF_PATH} />
      </svg>
    </div>
  );
}

// Deterministic row of book spines for the skyline at the bottom of the page.
const SHELF_PATH = (() => {
  let d = "M0 160 L0 120 ";
  let x = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  while (x < 1200) {
    const w = 14 + Math.floor(rnd() * 22);
    const h = 40 + Math.floor(rnd() * 70);
    const lean = rnd() < 0.12 ? 8 : 0;
    d += `L${x} ${160 - h} L${x + w - lean} ${160 - h - lean / 2} L${x + w} ${160} `;
    x += w + 2;
  }
  return d + "L1200 160 Z";
})();

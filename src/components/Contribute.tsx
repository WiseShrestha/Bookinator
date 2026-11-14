// Contribution UI (docs/community/DESIGN.md §2): "which book was it?" after a miss, and the opt-in
// "send my answers" card after a hit. D1 anonymous sign-in (+ Turnstile when configured),
// D2 nothing leaves the browser unless the reader asks on this screen.
import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import {
  contributionsEnabled,
  ensureSignedIn,
  isSignedIn,
  searchBooksRemote,
  submitBook,
  submitFeatureAnswers,
  submitGameSession,
  SUPABASE_CONFIG,
  type RemoteBookHit,
} from "../community/client.ts";
import { sessionPayload } from "../community/payload.ts";
import { searchLocal } from "../community/search.ts";
import type { CatalogBook } from "../engine/model.ts";
import type { Session, SessionState } from "../engine/session.ts";
import { CC } from "../game.ts";
import { bookTitles, type Lang, type Strings } from "../i18n/index.ts";
import { Bubble, CloudDecor, Seagull, Sea } from "./scenery.tsx";

// ---------------------------------------------------------------- sign-in + CAPTCHA

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScript: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  turnstileScript ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("captcha script failed to load"));
    document.head.appendChild(s);
  });
  return turnstileScript;
}

function Captcha({ onToken, lang }: { onToken: (t: string | null) => void; lang: Lang }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        id = window.turnstile.render(ref.current, {
          sitekey: SUPABASE_CONFIG.turnstileSiteKey,
          language: lang,
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [onToken, lang]);
  return <div ref={ref} className="captcha" />;
}

/** Whether a CAPTCHA token is still needed before the first anonymous sign-in. */
function useContributor() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    if (!contributionsEnabled) return;
    isSignedIn().then(setSignedIn, () => setSignedIn(false));
  }, []);
  const needsCaptcha = Boolean(SUPABASE_CONFIG.turnstileSiteKey) && signedIn === false;
  return {
    needsCaptcha,
    ready: contributionsEnabled && signedIn !== null && (!needsCaptcha || token !== null),
    setToken,
    signIn: async () => {
      await ensureSignedIn(token ?? undefined);
      setSignedIn(true);
    },
  };
}

// ---------------------------------------------------------------- after a hit: opt-in answers

export function ShareAnswers({ session, state, t, lang }: { session: Session; state: SessionState; t: Strings; lang: Lang }) {
  const [status, setStatus] = useState<"ask" | "sending" | "sent" | "declined" | "error">("ask");
  const who = useContributor();
  const payload = useMemo(() => sessionPayload(CC, session, state), [session, state]);
  if (!contributionsEnabled || !payload) return null;
  if (status === "declined") return null;

  const send = async () => {
    setStatus("sending");
    try {
      await who.signIn();
      await submitGameSession(payload);
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  };
  return (
    <div className="share-card" aria-live="polite">
      {status === "sent" ? (
        <p className="share-done">{t.shared}</p>
      ) : (
        <>
          <p className="share-q">{t.shareAnswersQ}</p>
          <p className="share-help">{t.sendAnswersHelp}</p>
          {who.needsCaptcha && <Captcha onToken={who.setToken} lang={lang} />}
          {status === "error" && <p className="form-error">{t.sendFailed}</p>}
          <div className="share-actions">
            <button type="button" className="pill pill-dark" onClick={send} disabled={!who.ready || status === "sending"}>
              {status === "sending" ? t.sending : t.shareAnswersYes}
            </button>
            <button type="button" className="pill" onClick={() => setStatus("declined")}>
              {t.shareAnswersNo}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- after a miss: which book was it?

type Pick = { kind: "local"; book: CatalogBook } | { kind: "remote"; hit: RemoteBookHit };

function hangul(s: string) {
  return /[ㄱ-ㆎ가-힣]/.test(s);
}

export function AddBookScreen({
  headingRef,
  session,
  state,
  t,
  lang,
  onPlayAgain,
  onUndo,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  session: Session;
  state: SessionState;
  t: Strings;
  lang: Lang;
  onPlayAgain: () => void;
  onUndo: () => void;
}) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [consent, setConsent] = useState(false);
  const [remote, setRemote] = useState<RemoteBookHit[]>([]);
  const [confirmDup, setConfirmDup] = useState(false);
  const [status, setStatus] = useState<{ kind: "idle" | "sending" | "done" | "error"; msg?: string }>({ kind: "idle" });
  const sessionId = useRef<string | null>(null);
  const who = useContributor();

  const local = useMemo(() => searchLocal(CC.books, title, author), [title, author]);

  // Server-side duplicate search (published books from every release + open submissions).
  useEffect(() => {
    setConfirmDup(false);
    if (!contributionsEnabled || title.trim().length < 2) {
      setRemote([]);
      return;
    }
    const q = `${title} ${author}`.trim();
    const timer = setTimeout(() => {
      searchBooksRemote(q, 5).then(
        (hits) => setRemote(hits.filter((h) => !(h.kind === "book" && CC.bookIndex.has(h.id)))),
        () => setRemote([]),
      );
    }, 350);
    return () => clearTimeout(timer);
  }, [title, author]);

  const reason = state.action.kind === "no_match" ? state.action.reason : "user_exit";
  const busy = status.kind === "sending";
  const done = status.kind === "done";

  /** Sends this game's answers once (only with consent), optionally naming a book from this catalog. */
  const sendSession = async (identified: string | null = null): Promise<string | null> => {
    if (!consent) return null;
    if (sessionId.current) return sessionId.current;
    const payload = sessionPayload(CC, session, state, identified);
    if (!payload) return null;
    sessionId.current = await submitGameSession(payload);
    return sessionId.current;
  };
  const answers = () => state.answers.map((a) => ({ question_id: CC.questions[a.questionIndex].id, answer: a.answer }));

  const pick = async (p: Pick) => {
    if (!contributionsEnabled || !consent) {
      setStatus({ kind: "done", msg: t.thanksNoSend });
      return;
    }
    setStatus({ kind: "sending" });
    try {
      await who.signIn();
      if (p.kind === "local") {
        await sendSession(p.book.id);
      } else {
        await sendSession();
        await submitFeatureAnswers({
          catalog_version: CC.catalog.catalog_version,
          ...(p.hit.kind === "book" ? { book_id: p.hit.id } : { submission_id: p.hit.id }),
          answers: answers(),
        });
      }
      setStatus({ kind: "done", msg: t.thanksExisting });
    } catch {
      setStatus({ kind: "error", msg: t.sendFailed });
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !author.trim()) {
      setStatus({ kind: "error", msg: t.needTitleAuthor });
      return;
    }
    setStatus({ kind: "sending" });
    try {
      await who.signIn();
      const sid = await sendSession();
      const res = await submitBook({
        title: title.trim(),
        author: author.trim(),
        ...(hangul(title) ? { title_ko: title.trim() } : {}),
        ...(sid ? { origin_session_id: sid } : {}),
        confirm_not_duplicate: confirmDup,
      });
      if (res.status === "created") {
        setStatus({ kind: "done", msg: t.thanksNew });
      } else if (res.status === "possible_duplicates") {
        setRemote(res.candidates.filter((h) => !(h.kind === "book" && CC.bookIndex.has(h.id))));
        setConfirmDup(true);
        setStatus({ kind: "idle", msg: t.confirmNotDuplicate });
      } else {
        if (consent) {
          await submitFeatureAnswers({
            catalog_version: CC.catalog.catalog_version,
            ...(res.status === "duplicate_book" ? { book_id: res.book_id } : { submission_id: res.submission_id }),
            answers: answers(),
          });
        }
        setStatus({ kind: "done", msg: res.status === "duplicate_book" ? t.duplicateBook : t.duplicateSubmission });
      }
    } catch {
      setStatus({ kind: "error", msg: t.sendFailed });
    }
  };

  const hasSimilar = local.length > 0 || remote.length > 0;

  return (
    <div className="frame frame-add">
      <div className="sky sky-add">
        <div className="scene scene-add">
          <Seagull mood="sad" />
          <Bubble>
            <h1 ref={headingRef} tabIndex={-1}>
              {reason === "all_rejected" ? t.allRejectedLine : t.missedLine}
            </h1>
          </Bubble>
        </div>

        <form className="sheet add-form" onSubmit={add} noValidate>
          <div className="field">
            <label htmlFor="bk-title">{t.title}</label>
            <input id="bk-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} disabled={done} autoComplete="off" maxLength={300} />
          </div>

          {hasSimilar && !done && (
            <div className="similar" aria-live="polite">
              <p className="similar-head">{t.similarExists}</p>
              {local.map(({ book }) => (
                <button key={book.id} type="button" className="similar-item" onClick={() => pick({ kind: "local", book })} disabled={busy}>
                  {bookTitles(book, lang).main} · {book.author}
                  <span className="similar-tag">{t.inThisShelf}</span>
                </button>
              ))}
              {remote.map((h) => (
                <button key={`${h.kind}:${h.id}`} type="button" className="similar-item" onClick={() => pick({ kind: "remote", hit: h })} disabled={busy}>
                  {(lang === "ko" && h.title_ko) || h.title} · {h.author}
                  {h.kind === "submission" && <span className="similar-tag">{t.submitted}</span>}
                </button>
              ))}
              <p className="similar-help">{t.tapIfSame}</p>
            </div>
          )}

          <div className="field">
            <label htmlFor="bk-author">{t.author}</label>
            <input id="bk-author" type="text" value={author} onChange={(e) => setAuthor(e.target.value)} disabled={done} autoComplete="off" maxLength={200} />
          </div>

          {contributionsEnabled && !done && (
            <label className="consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                <b>{t.sendAnswersToo}</b>
                <small>{t.sendAnswersHelp}</small>
              </span>
            </label>
          )}
          {!contributionsEnabled && <p className="form-note">{t.contributionsOff}</p>}
          {who.needsCaptcha && !done && <Captcha onToken={who.setToken} lang={lang} />}

          {status.msg && (
            <p className={status.kind === "error" ? "form-error" : "form-note"} role="status">
              {status.msg}
            </p>
          )}

          <div className="form-actions">
            {!done && (
              <button type="submit" className="pill pill-dark pill-lg" disabled={!contributionsEnabled || !who.ready || busy}>
                {busy ? t.sending : t.addBook}
              </button>
            )}
            <button type="button" className="pill pill-outline pill-lg" onClick={onPlayAgain}>
              {t.playAgain}
            </button>
          </div>
          {!done && (
            <button type="button" className="text-link" onClick={onUndo}>
              {t.undo}
            </button>
          )}
        </form>
      </div>
      <Sea className="sea-quiet">
        <CloudDecor shape="tall" className="decor-left" />
        <CloudDecor shape="wide" className="decor-right" />
      </Sea>
    </div>
  );
}

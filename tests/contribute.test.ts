import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CONSENT_VERSION, outcomeOf, sessionPayload } from "../src/community/payload.ts";
import { normalize, searchLocal, similarity } from "../src/community/search.ts";
import { makeConfig } from "../src/engine/config.ts";
import { compileCatalog, type Catalog } from "../src/engine/model.ts";
import { applyEvent, deriveState, newSession, type Session } from "../src/engine/session.ts";
import fixture from "../src/data/fixture.catalog.json";
import { QUESTIONS_KO } from "../src/i18n/questionsKo.ts";
import cmu from "../src/data/cmu.catalog.json";

const CAT = fixture as unknown as Catalog;
const config = makeConfig();
const cc = compileCatalog(CAT, config.channel, config.unknownPYes);

/** Plays until the engine stops asking, answering with `pick` (by question index). */
function playTo(session: Session, pick: (qi: number) => "yes" | "no" | "dont_know") {
  for (let i = 0; i < 40; i++) {
    const s = deriveState(cc, config, session);
    if (s.action.kind !== "ask") return session;
    session = applyEvent(cc, config, session, { type: "answer", questionId: s.action.question.id, answer: pick(s.action.questionIndex) }, s);
  }
  return session;
}

describe("local duplicate search", () => {
  it("finds a book by English title, Korean title, alias and author, despite typos and punctuation", () => {
    const ids = (t: string, a = "") => searchLocal(CAT.books, t, a).map((h) => h.book.id);
    assert.equal(ids("the hobit")[0], "fx-the-hobbit");
    assert.equal(ids("호빗")[0], "fx-the-hobbit");
    assert.equal(ids("상실의 시대")[0], "fx-norwegian-wood");
    assert.equal(ids("Harry Potter")[0], "fx-harry-potter-1");
    assert.equal(ids("", "Haruki Murakami")[0], "fx-norwegian-wood");
    assert.deepEqual(ids("난장이가 쏘아올린 작은 공", "조세희"), []);
  });

  it("normalises width, case and punctuation", () => {
    assert.equal(normalize("  Nineteen-Eighty—Four!! "), "nineteen eighty four");
    assert.equal(normalize("ＡＢＣ"), "abc");
    assert.equal(similarity("호빗", "호빗"), 1);
    assert.equal(similarity("", ""), 0);
  });
});

describe("game session payload", () => {
  it("is null until the game has ended", () => {
    const s = playTo(newSession(), () => "dont_know");
    const st = deriveState(cc, config, newSession());
    assert.equal(sessionPayload(cc, newSession(), st), null);
    assert.ok(s.events.length > 0);
  });

  it("carries only ids, answers and the outcome — and keeps Don't know", () => {
    const target = cc.bookIndex.get("fx-the-hobbit")!;
    let session = playTo(newSession(), (qi) => {
      const x = cc.x[qi][target];
      return x > 0.5 ? "yes" : x < 0.5 ? "no" : "dont_know";
    });
    let st = deriveState(cc, config, session);
    assert.equal(st.action.kind, "guess");
    session = applyEvent(cc, config, session, { type: "accept", bookId: "fx-the-hobbit" }, st);
    st = deriveState(cc, config, session);
    const p = sessionPayload(cc, session, st)!;
    assert.equal(p.outcome, "found_guess");
    assert.equal(p.confirmed_book_id, "fx-the-hobbit");
    assert.equal(p.identified_book_id, null);
    assert.equal(p.catalog_version, CAT.catalog_version);
    assert.equal(p.consent_version, CONSENT_VERSION);
    assert.equal(p.answers.length, st.answers.length);
    assert.deepEqual(Object.keys(p).sort(), ["answers", "catalog_version", "confirmed_book_id", "consent_version", "film_memory_mode", "identified_book_id", "outcome", "rejected_book_ids"]);
    for (const a of p.answers) assert.deepEqual(Object.keys(a).sort(), ["answer", "question_id"]);
  });

  it("records a miss, the rejected guesses and a book the reader named afterwards", () => {
    let session = playTo(newSession(), () => "yes");
    for (let i = 0; i < 5; i++) {
      const st = deriveState(cc, config, session);
      if (st.action.kind === "guess") session = applyEvent(cc, config, session, { type: "reject", bookId: st.action.book.id }, st);
      else if (st.action.kind === "ask") session = playTo(session, () => "yes");
      else break;
    }
    let st = deriveState(cc, config, session);
    session = applyEvent(cc, config, session, { type: "exit" }, st);
    st = deriveState(cc, config, session);
    assert.equal(outcomeOf(st), "no_match_exit");
    const p = sessionPayload(cc, session, st, "fx-frankenstein")!;
    assert.equal(p.identified_book_id, "fx-frankenstein");
    assert.equal(p.rejected_book_ids.length, st.rejected.size);
    assert.ok(p.rejected_book_ids.length >= 1);
    // A book outside this catalog can't be named in the session (it goes through submit_book instead).
    assert.equal(sessionPayload(cc, session, st, "not-a-book"), null);
  });
});

describe("Korean question wording", () => {
  it("covers every question in both shipped catalogs", () => {
    const texts = [...CAT.questions, ...(cmu as unknown as Catalog).questions].map((q) => q.text);
    const missing = texts.filter((t) => !QUESTIONS_KO[t]);
    assert.deepEqual(missing, []);
  });
});

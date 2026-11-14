import { useState } from "react";
import { availabilityEnabled, checkAvailability, pickEdition, type AvailabilityResult } from "../availability.ts";
import type { CatalogBook } from "../engine/model.ts";
import { AVAILABILITY } from "../game.ts";

const yesNo = (v: boolean | null, yes: string, no: string) => (v === null ? "unknown" : v ? yes : no);

export function Availability({ book }: { book: CatalogBook }) {
  const [state, setState] = useState<"idle" | "loading" | AvailabilityResult>("idle");
  if (!availabilityEnabled(AVAILABILITY)) return null;
  const edition = pickEdition(book);
  if (!edition) return null;
  const lib = AVAILABILITY.libName || "the library";

  return (
    <div className="availability" aria-live="polite">
      {state === "idle" && (
        <button className="secondary" onClick={async () => { setState("loading"); setState(await checkAvailability(AVAILABILITY, book)); }}>
          Check if {lib} has it
        </button>
      )}
      {state === "loading" && <p className="muted">Checking {lib}…</p>}
      {typeof state === "object" && state.ok && (
        <p>
          <b>{yesNo(state.hasBook, "Held", "Not held")}</b> · {yesNo(state.loanAvailable, "available to borrow now", "not available right now")}
          <span className="muted small">
            {" "}— {lib}, edition ISBN {state.edition.isbn}{state.edition.title ? ` (${state.edition.title})` : ""}. Data4Library,{" "}
            {state.cached ? "cached result from" : "checked at"} {new Date(state.fetchedAt).toLocaleTimeString()}. Library data can lag; confirm before you go.
          </span>
        </p>
      )}
      {typeof state === "object" && !state.ok && (
        <p className="muted">{state.message} Use the catalog search above instead.</p>
      )}
    </div>
  );
}

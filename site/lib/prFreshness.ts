/**
 * How current the Pull requests page's cards are, said in one line beside the selector, the way the Queue says it.
 * Pure.
 *
 * There is no "Sync now" button: the page is always up to date, even if it's thirty minutes stale, and a failed sync says it failed, with error details
 * behind a hover or expand. A stale reading still shows everything and says what is stale, as the Queue page does. So the line is quiet while the reading is current, draws a
 * spinner beside the shown reading's age while the console's own refresh takes a fresh one, and a staleness mark beside it
 * when the sync failed, the reason one hover away, with no text stand-ins.
 */
import type { SyncState } from "../components/live/LandingSync";
import { LANDING_CADENCE_MINUTES, refreshReasonWords } from "./landingFreshness";
import type { FreshnessLine } from "./registerFreshness";
import type { StalenessFact } from "./stalenessLabel";

/** The landing reading as the line reads it. */
export type PrReadingState =
  | { readonly phase: "loading" }
  | { readonly phase: "not-measured"; readonly why: string }
  | {
      readonly phase: "ready";
      readonly observedAtIso: string;
      readonly by: string;
      readonly fixture: boolean;
      /** Why the latest read of the ledger failed, when this reading is the last one that answered. */
      readonly stale?: string;
    };

/**
 * The one line beside the selector. A failed sync leads, because it is the "why" the owner needs told; then a fresh
 * reading in flight; otherwise the age of the reading on screen, in the warning tone once it is past the landing
 * cadence. A landing reading kept over a failed read is a failed read: it is drawn marked stale too.
 *
 * @param reading the landing reading the cards are drawn from
 * @param sync what the page's own latest sync came to
 * @param nowMs the instant the line is drawn at
 * @param age how long ago an instant was, in the page's own words
 * @returns the line
 */
export function prFreshnessLine({
  reading,
  sync,
  nowMs,
  age,
}: {
  reading: PrReadingState;
  sync: SyncState;
  nowMs: number;
  age: (iso: string) => string;
}): FreshnessLine {
  if (reading.phase === "ready" && reading.fixture) {
    return {
      kind: "text",
      title: "a frozen reading: nothing on this page is live",
      tone: "warn",
      words: `FIXTURE · read ${age(reading.observedAtIso)}`,
    };
  }
  // The cards on screen are still the drawn reading's beside a mark, so their age stays beside it.
  let shownAge = "";
  if (reading.phase === "ready") {
    shownAge = `updated ${age(reading.observedAtIso)}`;
  }
  if (sync.phase === "failed") {
    const fact: StalenessFact = { subject: "A fresh landing reading", why: `${sync.why} (${age(sync.atIso)})` };
    if (reading.phase === "ready") {
      return { facts: [{ ...fact, observedAtIso: reading.observedAtIso }], kind: "stale", words: shownAge };
    }
    return { facts: [fact], kind: "stale", words: shownAge };
  }
  if (sync.phase === "taking") {
    let because = "";
    if (sync.auto !== undefined) {
      because = `, because ${refreshReasonWords({ reason: sync.auto })}`;
    }
    return {
      kind: "reading",
      label: `Taking a fresh github landing reading, started ${age(sync.startedAtIso)}${because}`,
      words: shownAge,
    };
  }
  if (reading.phase === "loading") {
    return { kind: "reading", label: "Reading the landing ledger", words: "" };
  }
  if (reading.phase === "not-measured") {
    return { facts: [{ subject: "The landing ledger", why: reading.why }], kind: "stale", words: "" };
  }
  if (reading.stale !== undefined) {
    return {
      facts: [{ observedAtIso: reading.observedAtIso, subject: "The landing ledger", why: reading.stale }],
      kind: "stale",
      words: shownAge,
    };
  }
  const ageMs = nowMs - Date.parse(reading.observedAtIso);
  if (ageMs > LANDING_CADENCE_MINUTES * 60_000) {
    return {
      kind: "text",
      title: `older than the ${String(LANDING_CADENCE_MINUTES)}-minute landing cadence (taken by ${reading.by})`,
      tone: "warn",
      words: shownAge,
    };
  }
  return {
    kind: "text",
    title: `taken by ${reading.by} ${age(reading.observedAtIso)}`,
    tone: "quiet",
    words: shownAge,
  };
}

/**
 * The reader for `automation freshness --json` — how current each provider's stored data is.
 *
 * A sibling of `./read.ts`, under every rule its module doc states: refuse rather than substitute, never drop a
 * row. A malformed row refuses the WHOLE report, so a panel's freshness line (`SourceFreshnessLine`, one source
 * read out of it) reads stale rather than trusting a document the page no longer parses in full.
 */

import { type Bag, bags, isBag, nullableStr, num, str, strings, sub } from "../../lib/bag";
import {
  SOURCE_FRESHNESS_LABELS,
  SOURCE_FRESHNESS_SOURCES,
  SOURCE_FRESHNESS_STATES,
  type SourceFreshnessReport,
  type SourceFreshnessRow,
  type SourceFreshnessSource,
  type SourceFreshnessState,
} from "../../lib/sourceFreshnessReport";

/** The state field, refused when the verb sends one this page does not know. */
function stateOf({ bag }: { bag: Bag }): SourceFreshnessState | undefined {
  const state = str({ bag, key: "state" });
  return SOURCE_FRESHNESS_STATES.find((known) => known === state);
}

/** The source field, refused when the verb names one this page does not know. */
function sourceOf({ bag }: { bag: Bag }): SourceFreshnessSource | undefined {
  const source = str({ bag, key: "source" });
  return SOURCE_FRESHNESS_SOURCES.find((known) => known === source);
}

/**
 * The blocker field: `null` reads as none, a well-formed one is kept, anything else refuses.
 *
 * @returns the blocker, `undefined` for none, or `false` when the field is malformed
 */
function blockerOf({ bag }: { bag: Bag }): SourceFreshnessRow["blocker"] | false {
  if (bag["blocker"] === null) {
    return undefined;
  }
  const blocker = sub({ bag, key: "blocker" });
  if (blocker === undefined) {
    return false;
  }
  const reason = str({ bag: blocker, key: "reason" });
  const steps = strings({ bag: blocker, key: "steps" });
  if (reason === undefined || steps === undefined) {
    return false;
  }
  return { reason, steps };
}

/**
 * Whether a present string fails to parse as an instant. A row whose sync time will not parse would age as
 * "never" or not at all, so a current row could read quiet however old it really is.
 */
function notAnInstant({ iso }: { iso: string | undefined }): boolean {
  return iso !== undefined && Number.isNaN(Date.parse(iso));
}

/**
 * Whether a present row instant will not parse or falls after the report's own instant. The verb records a sync
 * before it observes it, and a future time would age as zero, reading "synced just now" however old the data is.
 */
function notAPastInstant({ iso, observedMs }: { iso: string | undefined; observedMs: number }): boolean {
  return notAnInstant({ iso }) || (iso !== undefined && Date.parse(iso) > observedMs);
}

/**
 * Whether a row names a problem or a blocker its state cannot carry. Every recorded problem is an unreadable
 * record, a failed attempt or a blocker, and the verb ranks each of those (or paused/unscheduled) above these four
 * states, so one here with a problem would draw quiet words over a recorded failure.
 */
function contradictsItsProblems({
  state,
  problems,
  blocker,
}: {
  state: SourceFreshnessState;
  problems: readonly string[];
  blocker: SourceFreshnessRow["blocker"];
}): boolean {
  const quiet = state === "current" || state === "unverified" || state === "late" || state === "never-synced";
  return quiet && (problems.length > 0 || blocker !== undefined);
}

/** One source's row, or `undefined` when any field is missing or malformed. */
function rowOf({ bag, observedMs }: { bag: Bag; observedMs: number }): SourceFreshnessRow | undefined {
  const source = sourceOf({ bag });
  const windowMs = num({ bag, key: "windowMs" });
  const state = stateOf({ bag });
  const problems = strings({ bag, key: "problems" });
  const lastVerifiedSyncAtIso = nullableStr({ bag, key: "lastVerifiedSyncAtIso" });
  const newestRecordAtIso = nullableStr({ bag, key: "newestRecordAtIso" });
  const blocker = blockerOf({ bag });
  if (
    source === undefined ||
    windowMs === undefined ||
    state === undefined ||
    problems === undefined ||
    lastVerifiedSyncAtIso === false ||
    newestRecordAtIso === false ||
    blocker === false ||
    notAPastInstant({ iso: lastVerifiedSyncAtIso, observedMs }) ||
    // A newest record CAN be in the future — Calendar's is an upcoming event (measured: `slopweaver
    // recipe freshness --json | jq '.sources[] | select(.source == "calendar") | .newestRecordAtIso'`).
    notAnInstant({ iso: newestRecordAtIso }) ||
    // The verb ranks `never-synced` above these three, so one with no verified sync is a contradiction, and a
    // current row with no sync time could never age into late on the page.
    (lastVerifiedSyncAtIso === undefined && (state === "current" || state === "unverified" || state === "late")) ||
    contradictsItsProblems({ blocker, problems, state })
  ) {
    return undefined;
  }
  // `lateByMs` and `label` are not read: the page measures lateness from the sync time and the window, so it keeps
  // ageing between polls, and names the source itself, so no wire field can contradict the state or the source.
  return {
    blocker,
    label: SOURCE_FRESHNESS_LABELS[source],
    lastVerifiedSyncAtIso,
    newestRecordAtIso,
    problems,
    source,
    state,
    windowMs,
  };
}

/**
 * Project `automation freshness --json` into the console's shape.
 *
 * @returns the report, or `undefined` when the payload is not one or any row refuses
 */
export function readSourceFreshness({ payload }: { payload: unknown }): SourceFreshnessReport | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const observedAtIso = str({ bag: payload, key: "observedAtIso" });
  const issues = strings({ bag: payload, key: "issues" });
  const list = bags({ bag: payload, key: "sources" });
  // An EMPTY list refuses too: the verb always reports every fetchable source, and no rows would leave a panel's
  // line with nothing to say — silence that reads as all clear.
  if (
    observedAtIso === undefined ||
    notAnInstant({ iso: observedAtIso }) ||
    issues === undefined ||
    list === undefined ||
    list.length === 0
  ) {
    return undefined;
  }
  const sources: SourceFreshnessRow[] = [];
  for (const bag of list) {
    const row = rowOf({ bag, observedMs: Date.parse(observedAtIso) });
    if (row === undefined) {
      return undefined;
    }
    sources.push(row);
  }
  // Every reported source exactly once: a partial or doubled list is not the document the verb writes, and a
  // missing source reads as a fine one.
  const complete =
    sources.length === SOURCE_FRESHNESS_SOURCES.length &&
    SOURCE_FRESHNESS_SOURCES.every((source) => sources.some((one) => one.source === source));
  if (!complete) {
    return undefined;
  }
  return { issues, observedAtIso, sources };
}

/**
 * `handover quote`'s steer half: each further steer of the owner's a row holds, re-read and judged one index at a time, and
 * the one `--add-steer` relates. The writes are `./quoteSteerRow.ts`; this module turns
 * them into the outcomes the verb prints and the run's incompleteness check reads (`./quotePlan.ts`).
 */
import type { HandoverDoc } from "../../../handover/doc.js";
import { steerAnchor } from "../../../handover/hisWordsSteers.js";
import { mirrorAfterWrite } from "./mirrorAfterWrite.js";
import type { QuoteVerdict, quoteRunIncomplete } from "./quotePlan.js";
import { type SteerVerdict, steerVerdictPhrase } from "./quoteSteer.js";
import { readWordsAtAnchor, writeSteerOnRow } from "./quoteSteerRow.js";

/** One steer's outcome, under its row's. */
export interface SteerOutcome {
  readonly index: number;
  readonly verdict: SteerVerdict["kind"];
  readonly line: string;
  readonly wrote: boolean;
  readonly writeFailed: boolean;
  /** The record would not read at all — a store read that may pass next time, never a settled absence. */
  readonly recordUnreadable: boolean;
}

/** One row outcome as {@link quoteRunIncomplete} reads it. */
type RowOutcome = Parameters<typeof quoteRunIncomplete>[0]["outcomes"][number];

/**
 * One anchor's steer on a row, judged and — under `--apply` — written.
 *
 * @param path the row's file
 * @param anchor the steer's anchor
 * @returns the steer's outcome
 */
function steerOutcome({
  path,
  anchor,
  home,
  apply,
}: {
  path: string;
  anchor: string;
  home: string;
  apply: boolean;
}): SteerOutcome {
  const read = readWordsAtAnchor({ anchor, home });
  const recordUnreadable = read.isErr() && read.error.code === "RECORD_UNREADABLE";
  const written = writeSteerOnRow({ anchor, apply, path, read });
  const verdict = written.verdict;
  const line = `nothing written — ${written.problems.join("; ")}`;
  if (verdict === undefined) {
    return { index: 0, line, recordUnreadable, verdict: "defect", wrote: false, writeFailed: true };
  }
  if (written.problems.length > 0) {
    return { index: verdict.index, line, recordUnreadable, verdict: verdict.kind, wrote: false, writeFailed: true };
  }
  return {
    index: verdict.index,
    line: steerVerdictPhrase({ applied: written.wrote, verdict }),
    recordUnreadable,
    verdict: verdict.kind,
    wrote: written.wrote,
    writeFailed: false,
  };
}

/**
 * Every steer a row holds: a readable one re-read and judged, a defect reported as it stands. A row with problems
 * is not written at all, so none of its steers are.
 *
 * @param doc the row as scanned
 * @returns one outcome per steer, in index order
 */
export function steersOf({
  doc,
  home,
  apply,
}: {
  doc: HandoverDoc;
  home: string;
  apply: boolean;
}): readonly SteerOutcome[] {
  if (doc.problems.length > 0) {
    return [];
  }
  return doc.hisWordsSteers.map((steer) => {
    const anchor = steerAnchor({ steer });
    if (anchor === undefined || steer.group.kind === "defect") {
      let why = "it names no anchor";
      if (steer.group.kind === "defect") {
        why = steer.group.why;
      }
      const line = steerVerdictPhrase({ applied: false, verdict: { index: steer.index, kind: "defect", why } });
      return { index: steer.index, line, recordUnreadable: false, verdict: "defect", wrote: false, writeFailed: false };
    }
    return steerOutcome({ anchor, apply, home, path: doc.path });
  });
}

/**
 * `--add-steer`'s write: one anchor related to one row, mirrored once when it wrote.
 *
 * @param path the row's file
 * @param anchor the anchor of the owner's words
 * @returns the steer's outcome, `writeFailed` when its mirror failed too
 */
export async function relateOneSteer({
  path,
  anchor,
  home,
  apply,
}: {
  path: string;
  anchor: string;
  home: string;
  apply: boolean;
}): Promise<SteerOutcome> {
  const outcome = steerOutcome({ anchor, apply, home, path });
  if (!outcome.wrote) {
    return outcome;
  }
  const mirrorFailed = await mirrorAfterWrite({ home, path, verb: "quote" });
  return { ...outcome, writeFailed: outcome.writeFailed || mirrorFailed };
}

/** A steer's verdict read as the row verdict it is equivalent to for {@link quoteRunIncomplete}. */
const STEER_AS_ROW: Readonly<Record<SteerVerdict["kind"], QuoteVerdict["kind"]>> = {
  add: "add",
  answered: "current",
  current: "current",
  defect: "malformed",
  refresh: "refresh",
  "still-unread": "still-unread",
  unread: "unread",
};

/**
 * Every row's outcome followed by each of its steers', as the incompleteness check reads them: a defective steer
 * counts as a row that could not be quoted, and an add or a refresh still owed as a write still needed.
 *
 * @param outcomes each row's outcome, carrying its steers'
 * @returns the rows and their steers, flattened in order
 */
export function withSteers({
  outcomes,
}: {
  outcomes: readonly (RowOutcome & { readonly steers: readonly SteerOutcome[] })[];
}): readonly RowOutcome[] {
  return outcomes.flatMap((outcome) => [
    outcome,
    ...outcome.steers.map((steer) => ({ ...steer, verdict: STEER_AS_ROW[steer.verdict] })),
  ]);
}

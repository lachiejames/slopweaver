/**
 * One row's state as the ended-pull-request rail reads it at the WRITE: its derived status and its run's disposition.
 *
 * Two settlers read it — `github landing --register`'s closure half and `sweep board --settle-ended` — both as the
 * precondition `handover settle` judges over the bytes it is about to splice, so a row a seat picked up, or one
 * paused, after the board was read is left. One reader, so the two cannot disagree about what "nobody is on it"
 * means.
 */
import { type RunDisposition, runDisposition } from "../handover/boardTypes.js";
import { derivedRowState } from "../handover/derivedRowState.js";
import type { HandoverDoc } from "../handover/doc.js";
import { readRunJournal } from "../handover/runStore.js";
import { stateHomePaths } from "../stateHome.js";

import { closureHeldWhy } from "./landingClosure.js";

/**
 * One doc's DERIVED status and its run's disposition — an unreadable journal is an `unreadable` run, never none.
 *
 * @param doc the row as it reads now
 * @param runsDir the run journals directory
 * @returns the status and run kind {@link closureHeldWhy} judges
 */
export function closureRowState({ doc, runsDir }: { doc: HandoverDoc; runsDir: string }): {
  readonly status: string;
  readonly run: RunDisposition["kind"];
} {
  const journal = readRunJournal({ runsDir, slug: doc.slug });
  if (journal.isErr()) {
    return { run: "unreadable", status: derivedRowState({ doc, events: [] }).status };
  }
  const { events, unreadable } = journal.value;
  return {
    run: runDisposition({ events, unreadableLines: unreadable }).kind,
    status: derivedRowState({ doc, events }).status,
  };
}

/**
 * The settle precondition both settlers pass: why the row is held as it reads at the write, or undefined to settle.
 *
 * @param doc the row as `handover settle` read it
 * @param home the state home its run journals live under
 * @returns the hold, or undefined when nobody is on the row
 */
export function closureSettlePrecondition({ doc, home }: { doc: HandoverDoc; home: string }): string | undefined {
  return closureHeldWhy(closureRowState({ doc, runsDir: stateHomePaths({ home }).runs }));
}

/**
 * The precondition an ended-question settle passes: {@link closureSettlePrecondition}, after first refusing a row
 * whose question no longer reads as it did when GitHub was asked about the pull requests in it. A question edited
 * between the board read and the write may name one GitHub was never asked about.
 *
 * @param question the question the row was judged on, byte for byte
 * @returns the precondition, answering why the row is left or undefined to settle
 */
export function endedQuestionPrecondition({
  question,
}: {
  question: string;
}): (args: { doc: HandoverDoc; home: string }) => string | undefined {
  return ({ doc, home }) => {
    if (doc.summary !== question) {
      return "its question changed after the board read it, so GitHub was not asked about every pull request it names now — the next pass reads it again";
    }
    return closureSettlePrecondition({ doc, home });
  };
}

/**
 * The effectful half of `./ownerWordsBeforeReask.ts`: read a run's journal for its held question, read every call
 * file written since that question was asked, and hand both to the pure verdict. `hand post` (a step naming a row)
 * and `handover park` (a pause carrying a question) call it before they put the question in front of the owner again.
 *
 * Cost: one journal read and one directory listing; only call files whose modification time is at or after the
 * question's `askedIso` are opened, since a call file is append-only and an older one holds no line from inside the
 * window. The residue that choice buys, stated: a call file whose modification time was set back past the question
 * (copied or restored with its old stamp) is not opened, and a file appended to between the listing and the filter is
 * judged by the stamp the listing saw. A call file that will not read is a gap the seat names by its call id once it
 * has read the file by hand, since no anchor inside an unread file can be named.
 */

import { readRecentCallEntries } from "../talk/callStore.js";
import { askCardKey } from "../talk/cardKey.js";
import { heldQuestion } from "./heldQuestion.js";
import { runStateOf } from "./ledger.js";
import {
  heldQuestionOwnerWords,
  heldQuestionReadGaps,
  type OwnerWordsReadGap,
  ownerWordsBeforeReaskVerdict,
} from "./ownerWordsBeforeReask.js";
import { readRunJournal } from "./runStore.js";

/** The reference a seat names for a call file it read by hand: the call id, as the file is named less `.jsonl`. */
function gapOfUnreadable({ text }: { text: string }): OwnerWordsReadGap {
  const at = text.indexOf(": ");
  const name = at === -1 ? text : text.slice(0, at);
  const why = at === -1 ? "could not be read" : text.slice(at + 2);
  return { reference: name.replace(/\.jsonl$/u, ""), why };
}

/**
 * The refusal for re-asking a held question asked at `askedIso`, or `undefined` when nothing the owner said over its
 * card since then is unread.
 *
 * @param acknowledged the references the seat named in `--read-owner-words`
 * @param askedIso the held question's own instant
 * @param command the door, as the owner would type it
 * @param home the Slopweaver home whose call records are read
 * @param slug the run whose `ask:<slug>` card the words were said over
 * @returns the refusal lines to print whole, or `undefined`
 */
function ownerWordsBeforeReaskRefusal({
  acknowledged,
  askedIso,
  command,
  home,
  slug,
}: {
  acknowledged: readonly string[];
  askedIso: string;
  command: string;
  home: string;
  slug: string;
}): readonly string[] | undefined {
  const cardKey = askCardKey({ slug });
  const read = readRecentCallEntries({ home, sinceIso: askedIso });
  if (read.isErr()) {
    const verdict = ownerWordsBeforeReaskVerdict({
      acknowledged,
      cardKey,
      command,
      gaps: [{ reference: "talk/calls", why: read.error.message }],
      words: [],
    });
    return verdict.kind === "refused" ? verdict.lines : undefined;
  }
  const gaps: readonly OwnerWordsReadGap[] = [
    ...read.value.unreadable.map((text) => gapOfUnreadable({ text })),
    ...heldQuestionReadGaps({ calls: read.value.calls, cardKey }),
  ];
  const words = heldQuestionOwnerWords({ askedIso, calls: read.value.calls, cardKey });
  const verdict = ownerWordsBeforeReaskVerdict({ acknowledged, cardKey, command, gaps, words });
  return verdict.kind === "refused" ? verdict.lines : undefined;
}

/**
 * The same refusal for a step naming a board row: read the row's run journal, and check only when that run is waiting
 * on the owner over a held question. A row with no journal holds no question. A journal that will not read refuses,
 * since it may be holding exactly the question the step re-asks.
 *
 * @param acknowledged the references the seat named in `--read-owner-words`
 * @param command the door, as the owner would type it
 * @param home the Slopweaver home
 * @param runsDir the run journals directory the row's journal is read from
 * @param slug the row the step names
 * @returns the refusal lines to print whole, or `undefined`
 */
export function rowOwnerWordsBeforeReaskRefusal({
  acknowledged,
  command,
  home,
  runsDir,
  slug,
}: {
  acknowledged: readonly string[];
  command: string;
  home: string;
  runsDir: string;
  slug: string;
}): readonly string[] | undefined {
  const journal = readRunJournal({ runsDir, slug });
  if (journal.isErr()) {
    return [
      `${command}: cannot read run ${slug}'s journal to check the owner's words over its held question: ${journal.error.message}`,
      "NOTHING was done. Repair the journal, then try again.",
    ];
  }
  const { events } = journal.value;
  const question = heldQuestion({ events });
  if (question === undefined || runStateOf({ events }).phase !== "waiting-on-owner") {
    return undefined;
  }
  return ownerWordsBeforeReaskRefusal({ acknowledged, askedIso: question.askedIso, command, home, slug });
}

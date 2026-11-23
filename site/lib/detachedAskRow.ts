/**
 * The Queue's row for a run waiting on the owner's word whose doc left the board — archived, renamed or deleted by hand.
 *
 * `handover list --json` publishes these under `detachedAsks`, outside `rows`, because there is no doc to derive a
 * status, workspace or tag from (`src/handover/detachedAsk.ts` carries the defect and the measurement). The Queue is
 * the one page the owner reads, so each is stood up here as an ordinary `ask` card rather than a new kind: it goes through
 * `readBoardRow`, the same reader every published row does, with every field it does not carry ABSENT — never
 * borrowed from another row, never invented — and the sentinel `kind` and `status` say plainly what it is.
 *
 * Only the Queue sees these rows. Every other reader of the board keeps reading `rows` alone.
 */
import { type BoardRow, readBoardRow } from "../components/live/read";
import { type DetachedAsk } from "../components/live/readBoardDocument";
import { OWNER_WAIT_KIND } from "../components/live/readBoardWaits";

/** The `kind` a detached ask's row carries — no doc kind is spelled this way, so it cannot pass for one. */
export const DETACHED_ASK_KIND = "detached-run";

/**
 * A board row as the Queue's ask card is built from it. `reasonWhy` is the read's own reason behind a `reason` the
 * Queue wrote in its own words — a detached ask's doc that would not read — kept apart so the card says it plainly
 * with the raw message folded beneath. Absent on every row the board published, whose
 * `reason` is the row's own.
 */
export type QueueAskBoardRow = BoardRow & { readonly reasonWhy?: string };

/**
 * What the row says the run is waiting on — the remedy matched to what is KNOWN about its doc. Only a doc proven
 * gone earns "end the run"; one that would not read earns "repair it", because ending a run whose doc is sitting
 * right there on the strength of a parse failure would be acting on ignorance. Why it would not read is the read's
 * own words, so it stays out of the sentence.
 *
 * @param ask the published detached ask
 * @returns the reason line, and the read's own reason it rests on when there is one
 */
function detachedReason({ ask }: { ask: DetachedAsk }): { readonly text: string; readonly why?: string } {
  if (ask.doc.kind === "missing") {
    return { text: "its doc is gone from the board and the archive, so the run can be restored or ended" };
  }
  return { text: "its doc would not read, so it needs repairing before anything else", why: ask.doc.why };
}

/**
 * One detached ask as the board row the Queue's ask card is built from.
 *
 * @param ask the published detached ask
 * @returns the row, read through the board's own row reader, with the read's own reason beside it when there is one
 */
export function detachedAskRow({ ask }: { ask: DetachedAsk }): QueueAskBoardRow {
  const reason = detachedReason({ ask });
  const row = readBoardRow({
    row: {
      kind: DETACHED_ASK_KIND,
      ownerWait: OWNER_WAIT_KIND,
      question: ask.question,
      questionAskedIso: ask.askedIso,
      reason: reason.text,
      section: "WAITING ON OWNER",
      slug: ask.slug,
      status: ask.doc.kind === "missing" ? "doc-missing" : "doc-unreadable",
      summary: `a run still waiting on your word after its doc left the board: journal ${ask.journal}`,
    },
  });
  // Invariant, not a fallback: every field `readBoardRow` requires is written above as a string literal or a string
  // the published ask was refused without, and no `settlement` is passed for it to find unreadable.
  if (reason.why === undefined) {
    return row!;
  }
  return { ...row!, reasonWhy: reason.why };
}

/**
 * The detached asks the Queue stands rows up for — every one whose slug no published board row already carries, so
 * a doc restored between two reads is never drawn twice.
 *
 * @param asks the board's detached asks
 * @param rows the board's own rows
 * @returns the rows, in the order published
 */
export function detachedAskRows({
  asks,
  rows,
}: {
  asks: readonly DetachedAsk[];
  rows: readonly BoardRow[];
}): readonly QueueAskBoardRow[] {
  const onBoard = new Set(rows.map((row) => row.slug));
  return asks.filter((ask) => !onBoard.has(ask.slug)).map((ask) => detachedAskRow({ ask }));
}

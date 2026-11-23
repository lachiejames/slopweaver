/**
 * A question recorded AFTER its ask row was settled — refused at the verb, and found on the board when one got in.
 *
 * ## The defect
 *
 * `handover settle` writes `settlement:` into an ask row and, when the run's holder is still live, leaves the run open
 * (`./settleEnding.ts`). From that instant the board places the row under DONE or CLOSED (`./boardEvidence.ts`),
 * reconcile no longer ranks it, and `./ownerWait.ts` calls any question on its run `settled` rather than the owner's, so the
 * Queue draws no card. A `handover ask` on that open run was still admitted: nothing on the ask path read
 * `settlement:`, so the question was journalled, the run went `waiting-on-owner`, and the question sat against a row no
 * surface shows. Reproduce over the shipped CLI and a throwaway home — register, start, settle, ask, as a seat does;
 * without this module its "refuses once the row is settled" case exits 0 and journals the question:
 * `yarn vitest run --config config/vitest/subprocess.ts src/__tests__/subprocess/cli/commands/handover/settleThenAsk.test.ts`
 *
 * ## Why the ask REFUSES rather than reopening the settlement
 *
 * Reopening would let any session's question undo a settlement silently, including a `declined` one only the owner
 * makes, and would overwrite the witness the settlement was checked against. Refusing the other end — a settle on a
 * row whose run holds no answered question — would refuse the normal path, since most asks are settled by a work
 * witness (a pull request, a filed doc) with no journalled question at all. So the late ask is the one refused, before
 * it touches the journal, and a genuinely new question goes on a new row, which every surface shows.
 *
 * ## The board-wide half
 *
 * A refusal at the verb cannot see questions journalled before it existed, or by a checkout that predates it, so
 * {@link settledThenAskedOf} finds every settled row whose open question was asked after its settlement. A question
 * asked BEFORE the settlement is left out on purpose: `settle` printed it as residue and the settlement answered it —
 * `./ownerWait.ts`'s measured "settled and still asking" bucket. A row whose `settledIso:` is absent (settled before
 * the field existed) or whose instants do not parse cannot be ordered either way, and `settle` journals nothing in the
 * run to order it by, so it is named `unordered` rather than left out: dropping it would put a question asked after
 * that settlement back on no surface, while naming one the settlement already answered
 * costs only the `withdraw` its route prints.
 *
 * Pure: docs and composed models in, lines out. No filesystem, no clock.
 */

import { parseStrictIsoInstantMs } from "#lib/date.js";

import { settledAskOf } from "./askRow.js";
import type { BoardModel } from "./boardTypes.js";
import type { HandoverDoc } from "./doc.js";
import type { AskSettlement } from "./rowKind.js";

/** The settlement's witness as the refusal names it — a row settled with none says so rather than printing a blank. */
function witnessPhrase({ witness }: { witness: string | undefined }): string {
  if (witness === undefined) {
    return "no witness declared";
  }
  return `witness: ${witness}`;
}

/**
 * Why `handover ask` refuses a question on this row, or `undefined` when the row is not a settled ask.
 *
 * @param doc the row the ask names
 * @returns the refusal lines, the first one the sentence, or `undefined` when the ask may proceed
 */
export function askOnSettledRowRefusal({ doc }: { doc: HandoverDoc }): readonly string[] | undefined {
  const settled = settledAskOf({ doc });
  if (settled === undefined) {
    return undefined;
  }
  return [
    `${doc.slug} is an ask row already settled ${settled.settlement} (${witnessPhrase({ witness: settled.witness })}), so a question recorded on`,
    "  its run would be paused against a row the board, reconcile and the Queue have all stopped showing. Nothing was",
    "  recorded. A new question goes on a new row every surface shows:",
    '  slopweaver handover register --ask "<the question>" … (the shape flags `handover register --help` names)',
  ];
}

/**
 * Whether a settle could still land on this row, so its ask must judge and append under the row's lock. Only an ask
 * row can be settled — `handover settle` refuses any other kind — so any other row takes no lock: a board-local lock
 * it cannot create would otherwise refuse it. It is asked of the row as RE-READ at the append, never as
 * the verb resolved it, since a row re-registered as an ask in between would otherwise skip the lock.
 *
 * @param doc the row as re-read at the append
 * @returns `true` for an ask row
 */
export function settleCanLandOn({ doc }: { doc: HandoverDoc }): boolean {
  return doc.kind === "ask";
}

/** The check `handover ask` makes on the row as it stands at the append: the settled-row refusal, locked on an ask row. */
export const SETTLED_ASK_CHECK = { lockWhen: settleCanLandOn, refusal: askOnSettledRowRefusal } as const;

/** One settled row whose run holds a question asked after the settlement, or one no instant orders against it. */
export interface SettledThenAsked {
  readonly slug: string;
  readonly settlement: AskSettlement;
  /** `after` when both instants parse and the ask is later; `unordered` when `settledIso:` is absent or does not parse. */
  readonly order: "after" | "unordered";
  /** The row's `settledIso:` as written, absent on a row settled before the field existed. */
  readonly settledIso: string | undefined;
  readonly askedIso: string;
  readonly question: string;
}

/**
 * How the run's original ask sits against the settlement, or `undefined` when it was asked at or before it.
 *
 * @param settledIso the row's `settledIso:`, absent on a row settled before the field existed
 * @param askedIso the instant the run's open question was first asked
 * @returns `after` for a later ask, `unordered` when either instant is absent or does not parse
 */
function orderOf({
  settledIso,
  askedIso,
}: {
  settledIso: string | undefined;
  askedIso: string;
}): SettledThenAsked["order"] | undefined {
  if (settledIso === undefined) {
    return "unordered";
  }
  // Strict, never `Date.parse`: that reads an impossible day such as the 30th of February as a day in March and orders a question it cannot.
  const settled = parseStrictIsoInstantMs({ text: settledIso });
  const asked = parseStrictIsoInstantMs({ text: askedIso });
  if (settled === undefined || asked === undefined) {
    return "unordered";
  }
  if (asked > settled) {
    return "after";
  }
  // One millisecond holds both writes, so either may have come first.
  if (asked === settled) {
    return "unordered";
  }
  return undefined;
}

/**
 * Every settled ask row whose open question was asked after its settlement, or cannot be ordered against it, in
 * board order.
 *
 * @param models every composed row, whatever section it was placed in
 * @returns the rows, each with the two instants that order them and the question no surface shows
 */
export function settledThenAskedOf({ models }: { models: readonly BoardModel[] }): readonly SettledThenAsked[] {
  const found: SettledThenAsked[] = [];
  for (const { doc, run } of models) {
    const settled = settledAskOf({ doc });
    if (settled === undefined || run.kind !== "waiting-on-owner") {
      continue;
    }
    const order = orderOf({ askedIso: run.askedIso, settledIso: doc.settledIso });
    if (order !== undefined) {
      found.push({
        askedIso: run.askedIso,
        order,
        question: run.question,
        settledIso: doc.settledIso,
        settlement: settled.settlement,
        slug: doc.slug,
      });
    }
  }
  return found;
}

/**
 * The two instants of one finding, as its line prints them.
 *
 * @param row one finding
 * @returns the settlement instant and the ask's, or why the two cannot be ordered
 */
function instantsOf({ row }: { row: SettledThenAsked }): string {
  if (row.settledIso === undefined) {
    return `with no settledIso, asked ${row.askedIso}, which cannot be ordered against it`;
  }
  const settled = parseStrictIsoInstantMs({ text: row.settledIso });
  const sameInstant = settled !== undefined && settled === parseStrictIsoInstantMs({ text: row.askedIso });
  if (row.order === "unordered" && sameInstant) {
    return `${row.settledIso}, asked at that same instant, which cannot be ordered against it`;
  }
  if (row.order === "unordered") {
    return `${row.settledIso}, asked ${row.askedIso}, which cannot be ordered: one does not parse`;
  }
  return `${row.settledIso}, asked ${row.askedIso}`;
}

/**
 * The section `handover list` prints under the board naming every {@link SettledThenAsked} row and its two routes.
 *
 * @param rows what {@link settledThenAskedOf} found
 * @returns the lines, or nothing when no row was found
 */
export function settledThenAskedLines({ rows }: { rows: readonly SettledThenAsked[] }): readonly string[] {
  if (rows.length === 0) {
    return [];
  }
  const lines = [
    "",
    `⚠ ASKED AFTER ITS ROW WAS SETTLED, ON NO SURFACE (${String(rows.length)})`,
    "  Each row's ask is settled, so the board, reconcile and the Queue skip it, while its run still waits on the owner.",
  ];
  if (rows.some((row) => row.order === "unordered")) {
    lines.push("  A row no instant orders is named too: its question may be one the settlement already answered.");
  }
  for (const row of rows) {
    lines.push(
      `  ${row.slug} — settled ${row.settlement} ${instantsOf({ row })}`,
      `    ${row.question}`,
      `    moot: slopweaver handover withdraw ${row.slug} --why "<the check that shows it>"`,
      '    still open for the owner: withdraw it there, then slopweaver handover register --ask "<the question>" … on a new row',
    );
  }
  return lines;
}

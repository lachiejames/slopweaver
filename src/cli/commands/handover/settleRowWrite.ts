/**
 * The write half of `handover settle` (`./settleRowRun.ts`): the settlement's text, the relay card's effect, and the
 * row's rewrite inside the one lock every row writer takes (`./boardRowLock.ts`). Split from `./settleRowRun.ts` along
 * that seam (the file-size ratchet): everything here runs after every gate has passed, and nothing here awaits.
 */

import { readFileSync } from "node:fs";

import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { addFrontMatterFields, frontMatterErrorLines } from "../../../handover/frontmatter.js";
import type { AskSettlement } from "../../../handover/rowKind.js";
import { type CardPlan, cardFrontMatterFields } from "../../../handover/settleCard.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { type BoardRowLockOptions, withBoardRowLock } from "./boardRowLock.js";
import { performSettleCard } from "./settleCardRun.js";
import type { SettlePrecondition } from "./settleResidueRun.js";
import { printSettleRefusal } from "./settleTarget.js";

/** Everything a settlement's text is spliced from, beside the file it is read from. */
export interface SettlementInputs {
  readonly row: HandoverDoc;
  readonly settlement: AskSettlement;
  readonly witness: string;
  readonly reason: string | undefined;
  readonly card: CardPlan;
  readonly settledIso: string;
  readonly precondition: SettlePrecondition | undefined;
  readonly home: string;
}

/**
 * The row's text with the settlement, and what became of the relay's card, spliced into its front-matter — or what
 * stopped it. Pure over the text read, so it runs BEFORE the card effect: a value the front-matter refuses (a
 * `--witness` holding a line break) once refused only after the card was settled, leaving a refused settle that had
 * written state and a retry refused the same way for good.
 *
 * @param row the row being settled
 * @param reason `--reason`, carried by a decline
 * @param card what the settle does about the relay's card, recorded so an archived row still says it
 * @param settledIso the settle's own clock, the instant the ask leaves the owner's Queue — what the voice says it left at
 * @param precondition an in-process caller's own refusal, asked over the very text this splice replaces
 * @param home the state home the precondition reads the row's run under
 * @param target the file to read — the row's own path for the check before the card, the locked real file for the write
 * @returns the text to write, or the problems that stopped it
 */
function settlementText({
  row,
  settlement,
  witness,
  reason,
  card,
  settledIso,
  precondition,
  home,
  target,
}: SettlementInputs & { target: string }): { readonly contents: string } | { readonly problems: readonly string[] } {
  let text: string;
  try {
    text = readFileSync(target, "utf8");
  } catch (cause: unknown) {
    return { problems: [`cannot read ${row.path}: ${String(cause)}`] };
  }
  // Asked over the bytes this splice replaces, with nothing awaited between here and the write:
  // a lifecycle verb other than `start` (`./startUnderLock.ts`) journals without the settle's lock, so a check made
  // before `closingGatesRefuse` went stale.
  const unmet = precondition?.({ doc: parseHandoverDoc({ path: row.path, text }), home });
  if (unmet !== undefined) {
    return { problems: [unmet] };
  }
  const spliced = addFrontMatterFields({
    fields: [
      { key: "settlement", value: settlement },
      { key: "settlementWitness", value: witness },
      { key: "settledIso", value: settledIso },
      ...(reason === undefined ? [] : [{ key: "settlementReason", value: JSON.stringify(reason) }]),
      ...cardFrontMatterFields({ plan: card }),
    ],
    path: row.path,
    text,
  });
  if (spliced.isErr()) {
    return { problems: frontMatterErrorLines({ error: spliced.error }) };
  }
  return { contents: spliced.value };
}

/**
 * Replace the row with its settled text, or print what stopped it: the row is re-read, the caller's precondition asked
 * again and the settlement spliced afresh, all inside the row's one lock (`./boardRowLock.ts`), and written atomically
 * inside it — so a steer, priority or pause another verb wrote since the check before the card is kept, never written
 * over. The lock hands over the row's real file, so a board row that is a symlink settles its target and stays a link.
 *
 * @param inputs what the settlement is spliced from
 * @param rowLock how the write waits on the row's lock when another writer holds it
 * @returns true when the settlement is written, false once the failure is printed
 */
function writeSettlement({
  inputs,
  rowLock,
}: {
  inputs: SettlementInputs;
  rowLock: BoardRowLockOptions | undefined;
}): boolean {
  const path = inputs.row.path;
  const locked = withBoardRowLock({
    ...rowLock,
    path,
    write: ({ target }): readonly string[] => {
      const settled = settlementText({ ...inputs, target });
      if ("problems" in settled) {
        return settled.problems;
      }
      try {
        writeFileAtomic({ contents: settled.contents, path: target });
      } catch (cause: unknown) {
        return [`could not write ${path}: ${String(cause)}`];
      }
      return [];
    },
  });
  const problems = locked.isErr() ? [locked.error.message] : locked.value;
  if (problems.length > 0) {
    printSettleRefusal({ lines: [`the row is NOT settled: ${problems.join("; ")}`] });
    return false;
  }
  return true;
}

/**
 * Perform the relay card's effect, then write the settled row — or print what stopped either.
 *
 * The settlement is checked once before the card, so a settle the row refuses touches no card, and again under the
 * row's lock at the write, which is the check that authorises it. The card's effect runs deliberately OUTSIDE that
 * lock: a card landing holds the landing lock while it takes the row's (`../talk/cardLandApply.ts`), and a kept card's
 * effect takes the landing lock, so taking it under the row's lock could wait on a landing that is waiting on this
 * settle. A row that refuses at the write, having been checked clean before the card, leaves the card settled and the
 * row open, which is the state a failed row write has always left: re-running the settle finds the card's effect
 * already applied and writes the row.
 *
 * @param inputs what the settlement is spliced from, its clock the card effect's too
 * @param bySession who a card's `done` settling names
 * @param slug the row being settled
 * @param rowLock how the row write waits on the row's lock when another writer holds it
 * @returns true when the row is settled, false once the failure is printed
 */
export function settleCardThenRow({
  inputs,
  bySession,
  slug,
  rowLock,
}: {
  inputs: SettlementInputs;
  bySession: string;
  slug: string;
  rowLock?: BoardRowLockOptions;
}): boolean {
  const checked = settlementText({ ...inputs, target: inputs.row.path });
  if ("problems" in checked) {
    printSettleRefusal({ lines: [`the row is NOT settled: ${checked.problems.join("; ")}`] });
    return false;
  }
  const effect = performSettleCard({
    bySession,
    home: inputs.home,
    nowIso: inputs.settledIso,
    plan: inputs.card,
    slug,
  });
  if (effect.isErr()) {
    printSettleRefusal({ lines: [`the row is NOT settled: ${effect.error.message}`] });
    return false;
  }
  return writeSettlement({ inputs, rowLock });
}

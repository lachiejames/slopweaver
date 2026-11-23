/**
 * `talk cards`' plain-text report, as lines: what `./cardsRun.ts` prints when `--json` is not asked for. Split from
 * the verb along the read/print seam, so the verb reads the ledgers and this says what they hold.
 */
import type { CardLedgerUnreadableLine } from "../../../talk/cardLedgerFile.js";
import type { CardMovedOnRow } from "../../../talk/cardMoveLedger.js";

/**
 * One refused line as the report names it: its number, then the card key it recorded, or that it recorded none.
 *
 * @param line the refused line
 * @returns its label
 */
function refusedLineLabel({ line }: { line: CardLedgerUnreadableLine }): string {
  if (line.cardKey === undefined) {
    return `${String(line.lineNumber)} (no card key)`;
  }
  return `${String(line.lineNumber)} ${line.cardKey}`;
}

/** One landing still holding a card off their queue, with any triage verdict it carries. */
interface HoldingLanding {
  readonly anchor: string;
  readonly cardKey: string;
  readonly decidedIso: string;
  readonly source: string;
  readonly triage?: { readonly verdict: string } | undefined;
  readonly words: string;
  readonly workSlug: string;
}

/**
 * The report, in print order: each ledger's lines that did not read, each Queue-walk move holding a card off their
 * queue, the relay lines and intake marks that did not read, then each landing holding a card off — or that none is.
 *
 * @param ledgers each ledger's refused lines, each with the card key it recorded, and its path
 * @param moves the active Queue-walk moves
 * @param triageUnreadable how many relay lines did not read, so a park they carried is not shown
 * @param intakeGaps each intake mark naming a voice-opened card that lands nothing, and why
 * @param landings the landings holding a card off their queue
 * @returns the lines to print
 */
export function cardsTextLines({
  ledgers,
  moves,
  triageUnreadable,
  intakeGaps,
  landings,
}: {
  ledgers: readonly { readonly lines: readonly CardLedgerUnreadableLine[]; readonly path: string }[];
  moves: readonly CardMovedOnRow[];
  triageUnreadable: number;
  intakeGaps: readonly { readonly pointer: string; readonly why: string }[];
  landings: readonly HoldingLanding[];
}): readonly string[] {
  const unread = ledgers
    .filter((ledger) => ledger.lines.length > 0)
    .map(
      (ledger) =>
        `  ${String(ledger.lines.length)} ledger line(s) did not read (${ledger.lines.map((line) => refusedLineLabel({ line })).join(", ")}) — ${ledger.path}`,
    );
  const moved = moves.map(
    (move) => `${move.decidedIso}  ${move.cardKey} moved on from, to ${move.toCardKey}  ${move.anchor}`,
  );
  const parks =
    triageUnreadable > 0
      ? [`  ${String(triageUnreadable)} relay line(s) did not read: a park they carried is not shown`]
      : [];
  const gaps = intakeGaps.map(
    (gap) => `  intake mark ${gap.pointer} names a voice-opened card but lands nothing: ${gap.why}`,
  );
  const held = landings.flatMap((landing) => {
    const ruled = landing.triage === undefined ? "" : `  triage ${landing.triage.verdict}`;
    return [
      `${landing.decidedIso}  ${landing.cardKey} → ${landing.workSlug}  (${landing.source})${ruled}`,
      `  "${landing.words}"  ${landing.anchor}`,
    ];
  });
  if (held.length === 0) {
    held.push("talk cards: no word of theirs is holding a card off their queue");
  }
  return [...unread, ...moved, ...parks, ...gaps, ...held];
}

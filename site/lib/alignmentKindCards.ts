/**
 * The Alignment page's act list, regrouped: ONE card per kind of act the fleet took without asking, never one card per
 * act. Each card opens as the Queue's slide-over holding that kind's own act cards, so a word on one act still lands on
 * that act's ledger line alone (`../components/console/AlignmentKindPanel.tsx`).
 *
 * Built over the act rows the page already holds, each already placed, filtered by work context and folded into its
 * pattern (`./actGroups.ts`, `./queueRows.ts`). A row stays whole: a card counts every ledger act its rows carry, a
 * pattern's earlier acts included and each act once, but it lists the rows themselves, never a row made up from a raw
 * ledger line. Pure, so the unit lane holds it alone.
 */

import type { AutonomyRow } from "../components/live/readAutonomy";

/** The part of a ledger act a kind card reads. */
type KindAct = Pick<AutonomyRow, "actionId" | "doneIso" | "kind">;

/** One act row the page holds, with the acts it carries. */
export interface AlignmentKindSource<Row> {
  /** The row itself, handed back untouched in its card's list. */
  readonly row: Row;
  /** The newest act of its pattern, whose kind the row is grouped by. */
  readonly act: KindAct;
  /** The pattern's earlier acts, folded under it. */
  readonly earlier: readonly KindAct[];
}

/** One kind card. */
export interface AlignmentKindCard<Row> {
  /** The ledger's own kind, exactly as recorded. */
  readonly kind: string;
  /** Every distinct ledger act the card's rows carry, earlier acts of each pattern included. */
  readonly acts: number;
  /** When the newest of those acts was done. */
  readonly newestDoneIso: string;
  /** The kind's rows, newest act first, an action id breaking a tie. */
  readonly rows: readonly Row[];
}

/**
 * Order two acts newest first, the action id breaking a tie so the order never depends on the input's.
 *
 * @returns a negative number when `a` goes first
 */
function newestFirst({ a, b }: { a: KindAct; b: KindAct }): number {
  return Date.parse(b.doneIso) - Date.parse(a.doneIso) || a.actionId.localeCompare(b.actionId);
}

/**
 * Every kind card the page's act rows make: the kind carrying the most acts first, then the one acted on most recently,
 * then by kind.
 *
 * @param rows the act rows the page holds, already placed and filtered, each with the acts it carries
 * @returns the cards, empty when no row is held
 */
export function alignmentKindCards<Row>({
  rows,
}: {
  rows: readonly AlignmentKindSource<Row>[];
}): readonly AlignmentKindCard<Row>[] {
  const byKind = new Map<string, { sources: AlignmentKindSource<Row>[]; acts: Map<string, KindAct> }>();
  for (const source of rows) {
    let group = byKind.get(source.act.kind);
    if (group === undefined) {
      group = { acts: new Map(), sources: [] };
      byKind.set(source.act.kind, group);
    }
    group.sources.push(source);
    for (const act of [source.act, ...source.earlier]) {
      group.acts.set(act.actionId, act);
    }
  }
  const cards: AlignmentKindCard<Row>[] = [];
  for (const [kind, group] of byKind) {
    // A group exists only once a row put its act in, so the newest act is always there.
    const newestAct = [...group.acts.values()].toSorted((a, b) => newestFirst({ a, b }))[0];
    cards.push({
      acts: group.acts.size,
      kind,
      newestDoneIso: newestAct.doneIso,
      rows: group.sources.toSorted((a, b) => newestFirst({ a: a.act, b: b.act })).map((source) => source.row),
    });
  }
  return cards.toSorted(
    (a, b) =>
      b.acts - a.acts || Date.parse(b.newestDoneIso) - Date.parse(a.newestDoneIso) || a.kind.localeCompare(b.kind),
  );
}

/**
 * Which act card the page has open: the one the owner touched, while the address still names what it named when they
 * touched it, else the one a link names. A new `?open=` on the same mount is a new link, so it takes the focus back
 * from a card touched under the old one.
 *
 * @param engaged the card the owner touched, with the `?open=` value the address held at that touch
 * @param asked the address's `?open=` value now, `null` when it names none
 * @param targetKey the key of the row the address names, when it names one the page holds
 * @returns the open card's key, or `undefined` when nothing is open
 */
export function focusedAlignmentKey({
  engaged,
  asked,
  targetKey,
}: {
  engaged: { key: string; asked: string | null } | undefined;
  asked: string | null;
  targetKey: string | undefined;
}): string | undefined {
  if (engaged?.asked === asked) {
    return engaged.key;
  }
  return targetKey;
}

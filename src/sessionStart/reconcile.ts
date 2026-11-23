/**
 * RECONCILIATION BETWEEN RUNS — what moved since the last time the owner looked.
 *
 * The ask: a day later, conversations and meetings have moved things, so
 * the priorities should reconcile themselves without the owner giving much input. That is what this is.
 * Each run writes the set it showed; the next run diffs against it and labels every item.
 *
 * ## Identity is source plus native id, never rank and never text
 *
 * The whole thing turns on this. A rank changes every run by design and a summary changes whenever the
 * item's own words change, so keying on either reports movement that did not happen.
 * {@link ./item.itemIdentity} is the key, and {@link ./cycleLeg.movedAtIso} exists because the instant
 * beside it has to be a fact about the subject rather than a distance from now.
 *
 * ## ABSENCE IS NEVER DONE, and that is why there is no `done` label here
 *
 * The design memo's §5 states it and the reason is measurable: a stale cursor makes everything absent. An
 * item that was on yesterday's list and is not on today's might be finished, or its source might simply not
 * have been read. Those are different facts and V1's 41% failure rate came from conflating them.
 *
 * So the label for it is {@link Movement.label} `gone`, which says exactly what was observed — it left the
 * list — and claims nothing about why. A source-confirmed `done` is a real and separate increment: for a
 * board item it means reading the run journal for an `answered` or `finished` event, and for a cycle item it
 * means the ticket's own state. Neither is done here, and a reader is told so rather than left to assume the
 * stronger reading.
 *
 * `stale` from that same section is likewise absent: it needs each source's own refresh interval, which
 * nothing in this verb reads yet. An unchanged item is reported as `unchanged`, which is what was actually
 * observed.
 *
 * Pure — no I/O, no clock. The effectful store is {@link ./runStore}.
 */

import { absentAs } from "#lib/absent.js";
import { itemIdentity } from "./item.js";
import type { Ranking } from "./rank.js";

/** What one run showed about one item, reduced to what a diff needs. */
export interface SnapshotItem {
  /** `<source>:<nativeId>`, the only key that survives every state change the item can undergo. */
  readonly identity: string;
  /** When the item last moved, by its own source's clock. The field a `moved` verdict compares. */
  readonly whenIso: string;
  /** The item's own status in the source's words, when it had one. */
  readonly state?: string;
  /** Whether the run proposed closing it rather than doing it. A change here is real movement. */
  readonly closing: boolean;
}

/** One whole run, as the next one reads it. */
export interface RunSnapshot {
  /** The run's own instant. */
  readonly atIso: string;
  /** Every item the run RANKED. A held-back candidate was not shown, so it is not part of what the owner saw. */
  readonly items: readonly SnapshotItem[];
}

/**
 * Reduce a ranking to the snapshot the next run compares against.
 *
 * Only the ranked rows are kept, and that is the meaningful set rather than a convenient one: a snapshot
 * answers "what was in front of the owner", so a candidate a gate held back was never in front of them and its
 * later appearance is genuinely `new`.
 *
 * @param ranking what the run ranked and what it dropped
 * @param nowIso the run's own instant
 * @returns the snapshot to store
 */
export function snapshotOf({ ranking, nowIso }: { ranking: Ranking; nowIso: string }): RunSnapshot {
  return {
    atIso: nowIso,
    items: ranking.ranked.map((row) => ({
      closing: row.trace.verdict === "propose-close",
      identity: itemIdentity({ item: row.item }),
      whenIso: row.item.whenIso,
      ...(row.item.state === undefined ? {} : { state: row.item.state }),
    })),
  };
}

/**
 * What happened to one item between two runs.
 *
 * `gone` deliberately does not claim the work is finished — see the module header. Every other label
 * describes something observed on both sides of the comparison.
 */
export type MovementLabel = "new" | "moved" | "unchanged" | "gone";

/** One item's movement, with the words a reader is shown. */
export interface Movement {
  readonly identity: string;
  readonly label: MovementLabel;
  /** One clause, plain words, saying what actually changed. */
  readonly detail: string;
}

/**
 * What changed about one item that appears in both runs.
 *
 * Three things are compared and each is a fact the source owns: the instant it last moved, the state it
 * reads as, and whether the list now proposes closing it rather than doing it. The last is the one most
 * worth surfacing — a row that became a close is work that finished somewhere else while the owner was not looking.
 *
 * @param before what the previous run showed
 * @param after what this run shows
 * @returns the clause describing the change, or undefined when nothing observable changed
 */
export function changeBetween({ before, after }: { before: SnapshotItem; after: SnapshotItem }): string | undefined {
  if (!before.closing && after.closing) {
    return "it is now a close proposal — the work was done somewhere else since your last run";
  }
  if (before.closing && !after.closing) {
    return "it is no longer a close proposal, so it is work again";
  }
  if (before.whenIso !== after.whenIso) {
    return `it moved on ${after.whenIso}, having last moved on ${before.whenIso}`;
  }
  if (before.state !== after.state) {
    return `it now reads "${absentAs({ value: after.state, whenAbsent: "no state" })}", having read "${absentAs({ value: before.state, whenAbsent: "no state" })}"`;
  }
  return undefined;
}

/**
 * Diff two runs.
 *
 * Ordered `new`, then `moved`, then `gone`, then `unchanged`, because that is the order the owner would read them
 * in: what arrived, what shifted under them, what left, and then the settled remainder.
 *
 * @param previous the snapshot the last run stored, or undefined when this is the first run
 * @param current this run's snapshot
 * @returns one movement per item across both runs
 */
export function reconcileRuns({
  previous,
  current,
}: {
  previous: RunSnapshot | undefined;
  current: RunSnapshot;
}): readonly Movement[] {
  if (previous === undefined) {
    return [];
  }
  const before = new Map(previous.items.map((item) => [item.identity, item]));
  const after = new Map(current.items.map((item) => [item.identity, item]));

  const arrived: Movement[] = [];
  const shifted: Movement[] = [];
  const settled: Movement[] = [];
  for (const item of current.items) {
    const was = before.get(item.identity);
    if (was === undefined) {
      arrived.push({ detail: "it was not on your last list", identity: item.identity, label: "new" });
      continue;
    }
    const change = changeBetween({ after: item, before: was });
    if (change === undefined) {
      settled.push({ detail: "nothing about it changed", identity: item.identity, label: "unchanged" });
      continue;
    }
    shifted.push({ detail: change, identity: item.identity, label: "moved" });
  }

  const left: Movement[] = previous.items
    .filter((item) => !after.has(item.identity))
    .map((item) => ({
      detail: "it left the list, which is not the same as it being done — check the source before assuming",
      identity: item.identity,
      label: "gone" as const,
    }));

  return [...arrived, ...shifted, ...left, ...settled];
}

/**
 * How many of each label a diff produced.
 *
 * @param movements the diff
 * @returns one count per label, zeros included, so a quiet run is distinguishable from one that never ran
 */
export function movementTally({
  movements,
}: {
  movements: readonly Movement[];
}): Readonly<Record<MovementLabel, number>> {
  const labels: readonly MovementLabel[] = ["new", "moved", "gone", "unchanged"];
  const counted = labels.map((label): readonly [MovementLabel, number] => [
    label,
    movements.filter((movement) => movement.label === label).length,
  ]);
  return {
    gone: counted[2]![1],
    moved: counted[1]![1],
    new: counted[0]![1],
    unchanged: counted[3]![1],
  };
}

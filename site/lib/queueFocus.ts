/**
 * The owner's priorities on the Queue: which workstreams are a priority and in what order, which section a Queue card
 * draws in, and the ONE order the Queue page, its triage pass and the voice's `action_items` all apply
 * ({@link queueOrdered}).
 *
 * The order the voice raises things in exactly matches the order the queue puts things to the owner in, which exactly
 * matches what alignment suggests: a card blocking one of the owner's priorities first, with its reason; then the
 * owner's priorities' cards in rank order, those ranked by the controls each resolves; then everything else. The rule
 * itself is `src/waiting/queueOrder.ts`, mirrored at `./queueOrderRank.ts`, which the board's reconcile reads too.
 *
 * **Driven by state, never a name.** A priority is a workstream on the owner's outcomes register at priority `urgent`
 * that states the board tag value its cards carry (`queueWorkstream`, `src/workstreams/schema.ts`), and has not ended;
 * its `rank` orders it against the owner's others, 1 first, and an unranked one follows every ranked one in register
 * order. A card is in a priority by its tag read whole, never by its words — the rule `./isoQueueItems.ts` keeps — so a
 * card whose tags read only in part never joins one. A check-in or a card the owner put off is never lifted, and a lift
 * never changes a tier: the badge, the counts and the words a tier is spoken in all stay true.
 *
 * Measured: raising the ISO board rows to p0 moved no card, because a row's priority and its `workstream=` tag
 * were never sort keys. Both are now, with `controls-resolved=` beside them (`src/handover/rowTags.ts`).
 *
 * Pure: facts in, a focus list, a section or an order out.
 */
import type { LiveState } from "../components/live/useLive";
import { deferredLast } from "./cardDeferrals";
import { type QueueBand, type QueueFact, rankQueue } from "./queueOrderRank";
import type { QueueRow } from "./queueRows";
import type { StoppingStamp } from "./queueStopping";
import type { StalenessFact } from "./stalenessLabel";
import { rankWaiting, TIERS, type WaitingTier } from "./waitingRank";
import { type WorkstreamsReading, workstreamsOf } from "./workstreamsReading";

/**
 * How often the Queue re-reads the owner's outcomes register for their priorities. A priority moves on a steer of the owner's, not
 * inside a glance, so a minute. Polled
 * rather than read once, because `workstreams put` is a CLI write the page is never told of.
 */
export const FOCUS_POLL_MS = 60_000;

/** One workstream the Queue lifts, with the steer that made it urgent. */
export interface QueueFocus {
  readonly id: string;
  readonly name: string;
  /** The board's `workstream=` tag value its cards carry. */
  readonly queueWorkstream: string;
  readonly because: string;
  readonly anchor: string;
}

/** The sections drawn ahead of the tiers, each holding cards of more than one tier. */
export type LiftedSection = "blocker" | "focus" | "stopping";

/** Where a card draws on the Queue: blocking a priority, a priority's own, a stopped automation, or its own tier. */
export type QueueSection = LiftedSection | WaitingTier;

/** The sections, first drawn first — the bands of `./queueOrderRank.ts`, the last one drawn tier by tier. */
export const SECTIONS: readonly QueueSection[] = ["blocker", "focus", "stopping", ...TIERS];

/** What each lifted section reads as, kept short (rule 7). */
export const LIFTED_HEADINGS: Readonly<Record<LiftedSection, string>> = {
  blocker: "Blocking your priorities",
  focus: "Your priorities",
  stopping: "Stopped automations",
};

/**
 * Whether a section is one of the lifted ones, drawn ahead of every tier.
 *
 * @returns true for a lifted section
 */
export function isLifted(section: QueueSection | "deferred"): section is LiftedSection {
  return section === "blocker" || section === "focus" || section === "stopping";
}

/** The part of a Queue row the order reads. */
export type QueueFocusRow = Pick<QueueRow, "tags" | "tagsRead" | "tier"> & {
  readonly deferredIso?: string;
  readonly stopping?: StoppingStamp;
  readonly triage?: QueueRow["triage"];
};

/**
 * The workstreams the Queue lifts: every live story-bearing one at `urgent` that names its board tag, the owner's first
 * priority first — by its `rank`, an unranked one after every ranked one, ties in register order. None until the
 * register reads, and none when no register is written: no outcome, so no priority.
 *
 * @param workstreams the `workstreams list --json` reading; a kept reading over a failed poll still names them
 * @returns the focus workstreams, in the owner's order
 */
export function queueFocuses({ workstreams }: { workstreams: LiveState<WorkstreamsReading> }): readonly QueueFocus[] {
  if (workstreams.phase !== "ready") {
    return [];
  }
  const ranked = workstreamsOf({ reading: workstreams.value }).flatMap(
    (one): { focus: QueueFocus; rank: number | undefined }[] => {
      if (one.kind === "local" || one.kind === "closing" || one.ending !== null) {
        return [];
      }
      if (one.priority?.level !== "urgent" || one.queueWorkstream === undefined) {
        return [];
      }
      const { anchor, because, rank } = one.priority;
      return [{ focus: { anchor, because, id: one.id, name: one.name, queueWorkstream: one.queueWorkstream }, rank }];
    },
  );
  return rankQueue({
    factOf: (entry) => {
      if (entry.rank === undefined) {
        return { band: "priority" };
      }
      return { band: "priority", priorityRank: entry.rank };
    },
    items: ranked,
  }).map((entry) => entry.focus);
}

/**
 * The rank of the highest priority one card carries the tag of, read whole, while it still waits on the owner: 0 for the
 * first priority. `undefined` for a card in none of them.
 *
 * @returns the rank, or `undefined`
 */
function focusRankOf({ row, focuses }: { row: QueueFocusRow; focuses: readonly QueueFocus[] }): number | undefined {
  if (row.tier === "check-in" || row.deferredIso !== undefined || row.tagsRead !== "whole") {
    return undefined;
  }
  const at = focuses.findIndex((focus) =>
    row.tags.some((tag) => tag.key === "workstream" && tag.value === focus.queueWorkstream),
  );
  return at === -1 ? undefined : at;
}

/**
 * The section one card draws in. A card blocking a priority leads, in any context and whether or not the owner put it off;
 * a priority's own card follows; a stopped automation follows those (`./queueStopping.ts`); every other card draws in
 * its tier. A check-in stays where it is, whatever its stamp, and a card the owner put off is never lifted into a priority.
 *
 * @param row the card
 * @param focuses the workstreams lifted now, the first priority first
 * @returns the section
 */
export function queueSectionOf({ row, focuses }: { row: QueueFocusRow; focuses: readonly QueueFocus[] }): QueueSection {
  if (row.stopping !== undefined && row.tier !== "check-in") {
    return row.stopping.reason === "blocks" ? "blocker" : "stopping";
  }
  if (focusRankOf({ focuses, row }) !== undefined) {
    return "focus";
  }
  return row.tier;
}

/** Each section's band in the one order. */
const BAND: Readonly<Record<QueueSection, QueueBand>> = {
  blocker: "blocker",
  "check-in": "rest",
  "fleet-blocked": "rest",
  focus: "priority",
  stopping: "stopped",
  "team-blocked": "rest",
};

/** A board band as its place, `p0` first. */
const BOARD_BANDS: readonly string[] = ["p0", "p1", "p2", "p3"];

/** A whole count, as the `controls-resolved=` tag's closed registry spells one. */
const COUNT = /^(?:0|[1-9][0-9]*)$/u;

/**
 * One card's fact in the one order: its band from its section, the rank of the priority it blocks or advances, and —
 * for a priority's own card — its board band and the controls it resolves, read off its tags.
 *
 * @param row the card
 * @param focuses the workstreams lifted now, the first priority first
 * @returns the fact `./queueOrderRank.ts` ranks it by
 */
export function queueFactOf({ row, focuses }: { row: QueueFocusRow; focuses: readonly QueueFocus[] }): QueueFact {
  const section = queueSectionOf({ focuses, row });
  if (section === "blocker" && row.stopping?.reason === "blocks") {
    return { band: "blocker", priorityRank: row.stopping.priorityRank };
  }
  if (section !== "focus") {
    return { band: BAND[section] };
  }
  const priorityRank = focusRankOf({ focuses, row });
  const band = row.tags.find((tag) => tag.key === "priority")?.value;
  const controls = row.tags.find((tag) => tag.key === "controls-resolved")?.value;
  const boardBand = band === undefined ? -1 : BOARD_BANDS.indexOf(band);
  return {
    band: "priority",
    ...(priorityRank === undefined ? {} : { priorityRank }),
    ...(boardBand === -1 ? {} : { boardBand }),
    ...(controls === undefined || !COUNT.test(controls) ? {} : { controlsResolved: Number(controls) }),
  };
}

/**
 * THE order of the Queue: every card in the order the page draws and numbers it, the voice's `action_items` lists it,
 * and a triage pass walks it. A card blocking one of the owner's priorities, by the priority it blocks; then those priorities' own
 * cards, by priority, then board band, then the controls each resolves, most first; then a stopped automation; then
 * every other card by tier; then every card the owner put off, oldest deferral first (`./cardDeferrals.ts`). Wherever none of
 * those keys separates two cards, the order given stands (currency's, fresh first). With nothing to move the rows come
 * back as given, the same list.
 *
 * @param rows the rows one list shows, already in the Queue's currency order
 * @param focuses the workstreams lifted now, the first priority first
 * @returns the rows in the one order
 */
export function queueOrdered<T extends QueueFocusRow>({
  rows,
  focuses,
}: {
  rows: readonly T[];
  focuses: readonly QueueFocus[];
}): readonly T[] {
  const tiered = rankWaiting({ items: rows, tierOf: (row) => row.tier });
  const banded = rankQueue({ factOf: (row) => queueFactOf({ focuses, row }), items: tiered });
  const { now, deferred } = deferredLast({ rows: banded });
  const ordered = [...now, ...deferred];
  // The same rows in the same order keep their identity, so a caller memoising on the list sees no change.
  if (ordered.every((row, index) => row === rows[index])) {
    return rows;
  }
  return ordered;
}

/** Whose subject a focus-reading fact names. */
export const FOCUS_SUBJECT = "your priorities, which decide what leads your Queue";

/**
 * The staleness mark's fact when the owner's priorities have never been read: every card then stands by its tier, and this
 * says so. A failed poll over an earlier reading is not this: that reading keeps its priorities lifted, and the
 * Queue's staleness mark names it as an earlier reading, as it does any register's.
 * Silent while the first read is in flight, as the deferral mark is (`./cardDeferrals.ts` `deferralGap`), and never one
 * of the Queue's missing registers — a priority moves order, never a count, so a failed read must not take the badge
 * away. No register written yet is not this either: it ANSWERS that the owner has set no priority, so tier order is the
 * whole order and there is nothing unknown to mark.
 *
 * @param workstreams the `workstreams list --json` reading
 * @returns the fact, or `undefined` when there is nothing to mark
 */
export function focusGap({ workstreams }: { workstreams: LiveState<WorkstreamsReading> }): StalenessFact | undefined {
  if (workstreams.phase !== "not-measured") {
    return undefined;
  }
  return { subject: FOCUS_SUBJECT, why: `${workstreams.why}. Every card stands by its tier` };
}

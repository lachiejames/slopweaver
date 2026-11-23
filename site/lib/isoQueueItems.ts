/**
 * What the Queue says about ISO at one instant: the ISO cards waiting on the owner, in the one ranking, and whether the card
 * open in Slopweaver is an ISO card — the queue half of the ISO stray watch (`./isoStrayWatch.ts`).
 *
 * **A card is ISO by its tag, never by its words.** `workstream=iso-certification` on a card whose tags read whole
 * (`./queueTagsInherited.ts`): a subject that mentions "ISO" in passing is not one, and a card whose board document did not
 * read whole is neither ISO nor off-ISO, since the tag may be in the part that failed. A check-in is never named:
 * it is a "how did this go", not something waiting on the owner ([why](../../docs/console/voice-nudges-iso.md)).
 */
import { type IsoNudgeItem, isoNudgeItemOf } from "./isoNudgeNotice";
import type { QueueRow } from "./queueRows";

/** The workstream tag every ISO certification card carries. */
export const ISO_WORKSTREAM_TAG = { key: "workstream", value: "iso-certification" } as const;

/** Whether the card open in Slopweaver is ISO, another card, or unknown — none open, not found, or its tags partial. */
export type IsoOpenCard = "iso" | "off" | "unknown";

/** The Queue, as the ISO watch reads it. */
export interface IsoQueueSnapshot {
  readonly openCard: IsoOpenCard;
  /** Every ISO card waiting on the owner, best first; the first is the one a nudge names. */
  readonly waiting: readonly IsoNudgeItem[];
}

/** A Queue with no ISO card and none open: what the watch reads before the Queue has. */
export const EMPTY_ISO_QUEUE: IsoQueueSnapshot = { openCard: "unknown", waiting: [] };

/** The part of a Queue row the ISO watch reads. */
export type IsoQueueRow = Pick<QueueRow, "aliases" | "key" | "tags" | "tagsRead" | "tier"> & {
  readonly card: Pick<QueueRow["card"], "subject">;
};

/**
 * Whether a row is an ISO card, an off-ISO one, or one whose tags did not read whole.
 *
 * @param row the Queue row
 * @returns its class
 */
function rowIsoClass({ row }: { row: IsoQueueRow }): IsoOpenCard {
  if (row.tagsRead !== "whole") {
    return "unknown";
  }
  const iso = row.tags.some((tag) => tag.key === ISO_WORKSTREAM_TAG.key && tag.value === ISO_WORKSTREAM_TAG.value);
  if (iso) {
    return "iso";
  }
  return "off";
}

/**
 * The ISO half of the Queue: the waiting ISO cards in ranking order, and the open card's class, found by its key or
 * any alias the row answers to.
 *
 * @param rows every live row, in the one ranking — never the spoken list's capped slice
 * @param openKey the `?open=` key of the card open in Slopweaver, `undefined` when none is
 * @returns the snapshot
 */
export function isoQueueSnapshot({
  rows,
  openKey,
}: {
  rows: readonly IsoQueueRow[];
  openKey: string | undefined;
}): IsoQueueSnapshot {
  const waiting: IsoNudgeItem[] = [];
  for (const row of rows) {
    if (row.tier === "check-in" || rowIsoClass({ row }) !== "iso") {
      continue;
    }
    // A card whose subject has nothing speakable left once cleaned (an emoji alone, say) is passed over, and the next
    // one is named: the nudge names one concrete thing, never ISO in the abstract, so with none nameable the stretch
    // stays silent rather than speak a generic line.
    const item = isoNudgeItemOf({ key: row.key, subject: row.card.subject });
    if (item !== undefined) {
      waiting.push(item);
    }
  }
  if (openKey === undefined) {
    return { openCard: "unknown", waiting };
  }
  const exact = rows.find((row) => row.key === openKey);
  if (exact !== undefined) {
    return { openCard: rowIsoClass({ row: exact }), waiting };
  }
  const aliased = rows.find((row) => row.aliases?.includes(openKey) === true);
  if (aliased === undefined) {
    return { openCard: "unknown", waiting };
  }
  return { openCard: rowIsoClass({ row: aliased }), waiting };
}

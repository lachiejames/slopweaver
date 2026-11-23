/**
 * The as-me draft register's FOLD: its events, in file order, into one row per draft (`./draftRegister.ts` owns the
 * row and event shapes; `./draftLog.ts` reads the lines this folds).
 *
 * Split from the register so the shapes and the fold over them can each be held in one read. Pure, as the register is.
 */
import { parseStrictIsoInstantMs } from "../../lib/date.js";
import { channelSteerIsVoid } from "./draftChannelSteer.js";
import { comparedRow, pickedRow, pickOwed, withParkedComparison } from "./draftComparison.js";
import { judgedRow, parkedRow } from "./draftJudgedRow.js";
import { parkedDraftDigest, type SlackDraftEvent, type SlackDraftItem } from "./draftRegister.js";
import { revisedRow, sentRow } from "./draftRevision.js";

/**
 * Fold events into one row per draft, newest first.
 *
 * A `released` or `dropped` event whose `parked` is not in the log is IGNORED rather than invented: the
 * only thing it could produce is a row with no content, which is worse than an absence a reader can see. A
 * `dropped` after a `released` is ignored too: the message is on Slack whatever a later row says.
 *
 * @param events the register's events, in file order
 * @returns one item per parked draft, newest first
 */
export function foldSlackDrafts({ events }: { events: readonly SlackDraftEvent[] }): readonly SlackDraftItem[] {
  const items = new Map<string, SlackDraftItem>();
  for (const event of events) {
    if (event.kind === "parked") {
      items.set(event.id, withParkedComparison({ row: parkedRow({ event }) }));
      continue;
    }
    const standing = items.get(event.id);
    if (standing !== undefined) {
      items.set(event.id, foldedRow({ event, standing }));
    }
  }
  return [...items.values()].toSorted((left, right) => right.draft.tsIso.localeCompare(left.draft.tsIso));
}

/** A standing row after any event but its park. */
function foldedRow({
  event,
  standing,
}: {
  event: Exclude<SlackDraftEvent, { kind: "parked" }>;
  standing: SlackDraftItem;
}): SlackDraftItem {
  // A yes binds words, and while the owner's pick is owed there are two: an approval landing then binds neither. `approve`
  // refuses it under the lock, so only a hand-written line meets this, and it reads as unjudged.
  if (event.kind === "approved" && pickOwed({ item: standing })) {
    return standing;
  }
  if (event.kind === "approved" || event.kind === "held") {
    return judgedRow({ event, standing });
  }
  if (event.kind === "compared") {
    return comparedRow({ event: boundComparison({ event, standing }), standing });
  }
  if (event.kind === "picked") {
    return pickedRow({ event, standing });
  }
  if (event.kind === "steered") {
    return steeredRow({ event, standing });
  }
  if (event.kind === "revised") {
    return revisedRow({ event, standing });
  }
  // A deletion is history about a message that DID go out: the row stays released, and only the finding read drops it.
  if (event.kind === "deleted") {
    return standing;
  }
  return resolvedRow({ event, standing });
}

/**
 * A row after the owner's words named another channel for it. Only a HELD row takes a steer: one written after a release or a
 * drop cannot invent an obligation on a message already decided. A steer said LATER replaces an earlier one, so the
 * newest thing the owner said about where it goes is the one a release reads. Later by instant, not by line: a retried
 * relay appends an older turn's steer after a newer one, and file order would let it win. The parses cannot
 * fail, because `./draftLog.ts` admitted the same text. A VOID steer, whole words naming its channel only inside a URL
 * (`./draftChannelSteer.ts`'s {@link channelSteerIsVoid}), is passed over here rather than at the gate, so it
 * never displaces an earlier steer the owner did give on the same row.
 */
function steeredRow({
  event,
  standing,
}: {
  event: Extract<SlackDraftEvent, { kind: "steered" }>;
  standing: SlackDraftItem;
}): SlackDraftItem {
  if (standing.state !== "held" || channelSteerIsVoid({ steer: event })) {
    return standing;
  }
  const { anchor, channels, from, heard, tsIso } = event;
  const said = parseStrictIsoInstantMs({ text: tsIso })!;
  if (standing.steer !== undefined && parseStrictIsoInstantMs({ text: standing.steer.tsIso })! > said) {
    return standing;
  }
  return { ...standing, steer: { anchor, channels, from, heard, tsIso } };
}

/**
 * A `compared` event as the fold takes it: a ready candidate whose digest is not the one its own words mint under the
 * row's destination and identity reads as a refusal, so the card keeps A alone. The card draws a candidate's payload
 * and a release re-renders its form against its digest, so with the digest bound to the payload, what the card shows
 * is what goes out or nothing does. Only a hand-written or torn line can fail this.
 */
function boundComparison({
  event,
  standing,
}: {
  event: Extract<SlackDraftEvent, { kind: "compared" }>;
  standing: SlackDraftItem;
}): Extract<SlackDraftEvent, { kind: "compared" }> {
  const { outcome } = event;
  if (outcome.state !== "ready") {
    return event;
  }
  const { authorId, channel, groupDm, priorAsk, threadTs } = standing.draft;
  const { mentions, payload } = outcome.candidate;
  if (
    parkedDraftDigest({ draft: { authorId, channel, groupDm, mentions, payload, priorAsk, threadTs } }) ===
    outcome.candidate.digest
  ) {
    return event;
  }
  const reasons = ["the Codex draft's digest does not bind its own words, so the line was not written by a pass"];
  return { ...event, outcome: { reasons, stage: "admission", state: "refused" } };
}

/** Where a released message went, as its row's outcome: channel, ts, thread, and the permalink when journalled. */
function releasedOutcome({ event }: { event: Extract<SlackDraftEvent, { kind: "released" }> }): string {
  const where =
    event.threadTs === undefined
      ? `${event.channel} ${event.ts}`
      : `${event.channel} ${event.ts} in thread ${event.threadTs}`;
  if (event.permalink === undefined) {
    return where;
  }
  return `${where} · ${event.permalink}`;
}

/** A standing row after a release or a drop. */
function resolvedRow({
  standing,
  event,
}: {
  standing: SlackDraftItem;
  event: Extract<SlackDraftEvent, { kind: "released" | "dropped" }>;
}): SlackDraftItem {
  if (event.kind === "released") {
    const sent = sentRow({ digest: event.digest, item: standing });
    return { ...sent, outcome: releasedOutcome({ event }), resolvedIso: event.tsIso, state: "released" };
  }
  // A released row is terminal: a drop journalled after it (a re-cut or a spend racing the release) cannot
  // un-send a message that landed, so it never rewrites where that message went.
  if (standing.state === "released") {
    return standing;
  }
  const read = event.landingsRead === undefined ? {} : { landingsRead: event.landingsRead };
  return { ...standing, ...read, outcome: event.note, resolvedIso: event.tsIso, state: "dropped" };
}

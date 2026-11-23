/**
 * Whether the conversation a parked draft lands in moved between the moment the draft was
 * recorded and the moment it is released — checked live, right before a release posts.
 *
 * ## The owner's ruling, and what this module is therefore NOT
 *
 * An approval of an outbound message stands like a human's would — a day later it is still okay unless someone
 * says otherwise. The ONE override is the world moving between the approval and the send in a way that materially
 * changes what the send means; then good judgement says probably don't send, or send only thanks for the review.
 * And no reminder to the owner that an approved message is still unsent.
 *
 * So nothing here ages an approval, and nothing here asks for a fresh one. Code cannot judge "materially changes
 * what the send means" — that is a reading, and it stays with the session releasing the draft — so what moved into
 * code is the DELTA: every message added, edited or removed since the draft's own read, named by `ts`.
 * A moved conversation stops the release with that exact set and three remedies — send as is, by clearing the set
 * (`--thread-moved-cleared <ts,...>`); withdraw the draft; or send only thanks for the review in its place
 * (`--thanks-instead`). Never "re-record it for approval". The thanks remedy fits the case where a just-in-time check finds
 * the message no longer needed: it becomes thanks for the review and leaves the board, with nothing more said.
 *
 * ## The watermark
 *
 * A row recorded by this version carries `readThrough`: the newest `ts` the recording read, and every message it saw
 * with its edit stamp, so an edit or a deletion of something the draft answered is visible and not only an addition.
 * A reply's recording reads its whole thread; a top-level row's reads the channel's newest `TOP_LEVEL_SNAPSHOT_ROWS`
 * messages (`../../cli/commands/slack/draftRecordRun.ts`), and its release re-reads from the first of them
 * ({@link releaseReadFrom}). A read that found NOTHING keeps the zero `ts` as its boundary, never nothing at all: the
 * recording instant is minted after the read, so a message posted between the two would otherwise fall outside both.
 * Two kinds of row have only the recording instant (`tsIso`), so for those the check sees additions alone — stated
 * limits, not guesses: a row addressed to a PERSON, because no DM is opened before the words are approved, and a row
 * recorded before `readThrough` existed. A top-level edit to a message older than the snapshot is outside it too.
 *
 * The recording keeps every message whoever wrote it; only the release judges authorship, and only of what it can
 * still see. A message reading now as the releasing identity's OWN bot post (`./placement.ts`'s `ownBotPost`, the
 * rule the misplacement repair applies too), added or edited, is left out; a removed one counts, since nothing of it
 * is left to judge. An app's message counts, because a person posting through one — the owner's as-me token included —
 * carries the app's `bot_id` beside their own `user`, and the cost of counting another integration's notice is one
 * `--thread-moved-cleared`, where missing a person's reply sends words the thread already overtook. Because the
 * snapshot never depends on identity, an identity read wrong can only refuse more, never hide a change.
 *
 * Pure: the conversation arrives already read, and an unreadable one is the caller's to refuse on — a release that
 * cannot see where it is about to land does not send (`SLACK_RELEASE_THREAD_UNREADABLE`).
 */
import { compareStrings } from "../../lib/compare.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { slackTsFromEpochMs } from "../../lib/slackTs.js";
import type { ParkedReadThrough, ParkedSeenMessage, ParkedSlackDraft } from "./draftRegister.js";
import { ownBotPost, type PostingIdentity } from "./placement.js";

/** The flag that sends a moved conversation's draft as is, once its exact change set is read and judged. */
const THREAD_MOVED_CLEARED_FLAG = "--thread-moved-cleared";

/** The conversation could not be read, so the release cannot see where it is about to land. */
export interface ReleaseThreadUnreadableError {
  readonly code: "SLACK_RELEASE_THREAD_UNREADABLE";
  readonly message: string;
  readonly draftId: string;
}

/** The row's watermark is unusable: no `readThrough`, and a recording instant that is not a date. */
export interface ReleaseWatermarkInvalidError {
  readonly code: "SLACK_RELEASE_WATERMARK_INVALID";
  readonly message: string;
  readonly draftId: string;
}

/** The conversation changed since the draft's read, and nothing cleared that change. */
export interface ReleaseThreadMovedError {
  readonly code: "SLACK_RELEASE_THREAD_MOVED";
  readonly message: string;
  readonly draftId: string;
  readonly changes: ConversationChanges;
}

/** `--thread-moved-cleared` named a set that is not exactly the change set read now. */
export interface ReleaseClearanceMismatchError {
  readonly code: "SLACK_RELEASE_CLEARANCE_MISMATCH";
  readonly message: string;
  readonly draftId: string;
  readonly changed: readonly string[];
  readonly cleared: readonly string[];
}

/** The earlier ask a re-ask row names was answered after the recording read it, so the shown change may be stale. */
export interface ReleasePriorAnsweredError {
  readonly code: "SLACK_RELEASE_PRIOR_ANSWERED";
  readonly message: string;
  readonly draftId: string;
  readonly permalink: string;
  readonly answeredTs: readonly string[];
}

/** Every reason a release's freshness check stops it. */
export type ReleaseFreshnessError =
  | ReleaseClearanceMismatchError
  | ReleasePriorAnsweredError
  | ReleaseThreadMovedError
  | ReleaseThreadUnreadableError
  | ReleaseWatermarkInvalidError;

/** What changed in the conversation since the draft's read, each list sorted oldest first. */
export interface ConversationChanges {
  readonly added: readonly string[];
  readonly edited: readonly string[];
  readonly removed: readonly string[];
}

/** The point a release's freshness is measured from, and what the recording saw, when it kept that. */
export interface ReleaseWatermark {
  readonly throughTs: string;
  readonly seen: readonly ParkedSeenMessage[] | undefined;
}

/**
 * The comma-joined set a session types to clear a change set — the exact form the refusal prints.
 *
 * @param changed the change set, sorted
 * @returns the flag and its value
 */
function clearanceIncantation({ changed }: { changed: readonly string[] }): string {
  return `${THREAD_MOVED_CLEARED_FLAG} ${changed.join(",")}`;
}

/**
 * Each change kind with its `ts` list, for the refusal — an empty kind says nothing.
 *
 * @param changes what moved
 * @returns one clause per non-empty kind
 */
function changeClauses({ changes }: { changes: ConversationChanges }): readonly string[] {
  const clauses: string[] = [];
  if (changes.added.length > 0) {
    clauses.push(`new: ${changes.added.join(", ")}`);
  }
  if (changes.edited.length > 0) {
    clauses.push(`edited: ${changes.edited.join(", ")}`);
  }
  if (changes.removed.length > 0) {
    clauses.push(`removed: ${changes.removed.join(", ")}`);
  }
  return clauses;
}

/**
 * How an approved draft is withdrawn: a drop alone would end the owner's yes unsent with no reason before them, so it is set down
 * first, a judgement the owner's Queue card prints (`../../cli/commands/slack/draftDropGuard.ts`).
 */
function withdrawCommands({ draftId }: { draftId: string }): string {
  return (
    `\`slopweaver slack draft hold ${draftId} --reason not-owner-yes --why "<what the owner said>"\` then ` +
    `\`slopweaver slack draft drop ${draftId} --note "<why>"\``
  );
}

/** The typed failures of a release's freshness check, each with the message a caller prints. */
export const ReleaseFreshnessErrors = {
  clearanceMismatch: ({
    changed,
    cleared,
    draftId,
  }: {
    changed: readonly string[];
    cleared: readonly string[];
    draftId: string;
  }): ReleaseClearanceMismatchError => ({
    changed,
    cleared,
    code: "SLACK_RELEASE_CLEARANCE_MISMATCH",
    draftId,
    message:
      `draft ${draftId}: ${THREAD_MOVED_CLEARED_FLAG} names ${cleared.length === 0 ? "nothing" : cleared.join(",")}, ` +
      `but what moved since its read is ${changed.length === 0 ? "nothing" : changed.join(",")} — the conversation ` +
      "moved again after you judged it. Read the new set and judge it; nothing was sent.",
  }),
  priorAnswered: ({
    answeredTs,
    draftId,
    permalink,
  }: {
    answeredTs: readonly string[];
    draftId: string;
    permalink: string;
  }): ReleasePriorAnsweredError => ({
    answeredTs,
    code: "SLACK_RELEASE_PRIOR_ANSWERED",
    draftId,
    message:
      `draft ${draftId}: the earlier ask it re-asks (${permalink}) was answered since the recording read it ` +
      `(${answeredTs.join(", ")}). Read the answer: when it settles the question, withdraw the draft once the owner's word says so (${withdrawCommands({ draftId })}); ` +
      `otherwise re-record it with --supersedes ${draftId}, so the card the owner approves shows that answer. Nothing was sent.`,
    permalink,
  }),
  threadMoved: ({ changes, draftId }: { changes: ConversationChanges; draftId: string }): ReleaseThreadMovedError => {
    const changed = changedSet({ changes });
    return {
      changes,
      code: "SLACK_RELEASE_THREAD_MOVED",
      draftId,
      message:
        `draft ${draftId}: the conversation moved since this draft read it (${changeClauses({ changes }).join("; ")}). ` +
        "The owner's approval still stands; judge whether these change what the message means, then: send it as is with " +
        `${clearanceIncantation({ changed })}; or withdraw it once the owner's word says so (${withdrawCommands({ draftId })}); or, ` +
        'when it is no longer needed, send only thanks for the review in its place with `--thanks-instead "<one line>"` ' +
        "(an as-me row), which closes the row. Nothing was sent.",
    };
  },
  unreadable: ({ cause, draftId }: { cause: string; draftId: string }): ReleaseThreadUnreadableError => ({
    code: "SLACK_RELEASE_THREAD_UNREADABLE",
    draftId,
    message: `draft ${draftId}: could not re-read where it lands before sending (${cause}) — nothing was sent.`,
  }),
  watermarkInvalid: ({ draftId, tsIso }: { draftId: string; tsIso: string }): ReleaseWatermarkInvalidError => ({
    code: "SLACK_RELEASE_WATERMARK_INVALID",
    draftId,
    message: `draft ${draftId}: its recording instant ${tsIso} is not a date, so there is no point to re-read from — nothing was sent.`,
  }),
} as const;

/** A conversation as one read found it: each live message by `ts`, and the `ts` of each deleted one's tombstone. */
interface ReadConversation {
  readonly live: ReadonlyMap<
    string,
    { readonly editedTs: string | undefined; readonly message: Record<string, unknown> }
  >;
  readonly tombstones: readonly string[];
}

/**
 * Split a read into its live messages, with the stamp of each one's last edit, and the tombstones Slack leaves where
 * a message with replies was deleted. A row with no `ts` is neither.
 *
 * @param rawMessages a conversation's raw messages, in any order
 * @returns the live messages and the tombstones
 */
function readConversation({ rawMessages }: { rawMessages: readonly unknown[] }): ReadConversation {
  const live = new Map<string, { readonly editedTs: string | undefined; readonly message: Record<string, unknown> }>();
  const tombstones: string[] = [];
  for (const message of rawMessages) {
    if (!isRecord(message) || typeof message["ts"] !== "string") {
      continue;
    }
    if (message["subtype"] === "tombstone") {
      tombstones.push(message["ts"]);
      continue;
    }
    live.set(message["ts"], { editedTs: editStampOf({ message }), message });
  }
  return { live, tombstones };
}

/**
 * The stamp an `edited` block that cannot be read is kept as. Not a timestamp, so it never equals a real one, and
 * {@link conversationChanges} counts a message carrying it as edited whatever the recording kept: an unreadable stamp
 * cannot show the message unchanged. `../../corpus/slack/writeApiRead.ts` reads the same block the same way.
 */
const EDIT_STAMP_UNREADABLE = "unreadable";

/**
 * One message's last-edit stamp. Only the ABSENCE of the `edited` key means never edited; a key whose `ts` is not a
 * string (`edited: { ts: 1790000010 }`) is {@link EDIT_STAMP_UNREADABLE}, never dropped as no edit.
 *
 * @param message one live message, as Slack returned it
 * @returns the stamp, or `undefined` for a message never edited
 */
function editStampOf({ message }: { message: Record<string, unknown> }): string | undefined {
  if (!("edited" in message)) {
    return undefined;
  }
  const edited = message["edited"];
  if (isRecord(edited) && typeof edited["ts"] === "string") {
    return edited["ts"];
  }
  return EDIT_STAMP_UNREADABLE;
}

/** Ascending, with duplicates removed. */
function sortedUnique({ values }: { values: readonly string[] }): readonly string[] {
  return [...new Set(values)].toSorted((left, right) => compareStrings({ a: left, b: right }));
}

/**
 * The boundary an EMPTY recording read keeps: before every message, so whatever a release finds is new. Spelled as a
 * whole Slack `ts`, because the register refuses a row whose `throughTs` is not one (`./draftLog.ts`).
 */
const EMPTY_READ_THROUGH_TS = "0000000000.000000";

/**
 * What a recording read of a thread, kept on the row so a release can tell an edit or a deletion from nothing:
 * the newest `ts` it saw, and EVERY live message with its edit stamp, whoever wrote it — so what a release can see
 * never depends on who it asks `auth.test` to be. A read that held nothing keeps {@link EMPTY_READ_THROUGH_TS}, never
 * the later recording instant — see this module's header.
 *
 * @param rawMessages the whole thread, as the recording read it
 * @returns the read-through
 */
export function readThroughOf({ rawMessages }: { rawMessages: readonly unknown[] }): ParkedReadThrough {
  const { live, tombstones } = readConversation({ rawMessages });
  const throughTs = sortedUnique({ values: [...live.keys(), ...tombstones] }).at(-1);
  if (throughTs === undefined) {
    return { seen: [], throughTs: EMPTY_READ_THROUGH_TS };
  }
  const seen = sortedUnique({ values: [...live.keys()] }).map((ts): ParkedSeenMessage => {
    const editedTs = live.get(ts)!.editedTs;
    return { ts, ...(editedTs === undefined ? {} : { editedTs }) };
  });
  return { seen, throughTs };
}

/**
 * The point a release re-reads from: the row's `readThrough` when it kept one, else the recording instant as a
 * Slack `ts` — which never sees the removal of a message older than that instant, because nothing recorded what was
 * there; a tombstone newer than it is a message posted and removed since, and counts. A top-level or DM re-read starts
 * at that instant and so sees additions only; a thread re-read is whole, so it also sees an edit stamped after it.
 *
 * @param draft the parked row
 * @returns the watermark, or why the row has none
 */
export function releaseWatermark({
  draft,
}: {
  draft: Pick<ParkedSlackDraft, "id" | "readThrough" | "tsIso">;
}): Result<ReleaseWatermark, ReleaseFreshnessError> {
  if (draft.readThrough !== undefined) {
    return ok({ seen: draft.readThrough.seen, throughTs: draft.readThrough.throughTs });
  }
  const ms = Date.parse(draft.tsIso);
  if (Number.isNaN(ms)) {
    return err(ReleaseFreshnessErrors.watermarkInvalid({ draftId: draft.id, tsIso: draft.tsIso }));
  }
  return ok({ seen: undefined, throughTs: slackTsFromEpochMs({ ms }) });
}

/**
 * What changed in the conversation since the watermark: messages added after it, and — when the recording kept what
 * it saw — messages edited since or removed. A tombstone newer than the watermark is a message posted AND removed
 * since, so it is removed too. The one thing left out is a message that reads NOW as the releasing identity's own
 * bot's post, added or edited; a removed message is counted whoever wrote it, because nothing of it is left to judge.
 * So an identity read wrong can only refuse more, never miss a change. An edit stamp that cannot be read counts as
 * an edit, for the same reason.
 *
 * @param rawMessages the conversation as it reads now
 * @param watermark where the draft's own read ended
 * @param self who the release posts as, as `auth.test` names its token
 * @returns the three change lists, each sorted
 */
export function conversationChanges({
  rawMessages,
  watermark,
  self,
}: {
  rawMessages: readonly unknown[];
  watermark: ReleaseWatermark;
  self: PostingIdentity;
}): ConversationChanges {
  const { live, tombstones } = readConversation({ rawMessages });
  const others = [...live].filter(([, now]) => !ownBotPost({ message: now.message, self }));
  const added = sortedUnique({ values: others.map(([ts]) => ts).filter((ts) => ts > watermark.throughTs) });
  const removedSince = tombstones.filter((ts) => ts > watermark.throughTs);
  if (watermark.seen === undefined) {
    // Nothing recorded what was there, so an older message's removal is invisible; an edit stamped after the
    // recording is not, and neither is a newer tombstone.
    const editedSince = others
      .filter(([ts, now]) => ts <= watermark.throughTs && now.editedTs !== undefined)
      .filter(([, now]) => now.editedTs! > watermark.throughTs || now.editedTs === EDIT_STAMP_UNREADABLE)
      .map(([ts]) => ts);
    return { added, edited: sortedUnique({ values: editedSince }), removed: sortedUnique({ values: removedSince }) };
  }
  const othersNow = new Map(others);
  const edited: string[] = [];
  const removed: string[] = [...removedSince];
  for (const seen of watermark.seen) {
    const now = live.get(seen.ts);
    if (now === undefined) {
      removed.push(seen.ts);
    } else if (othersNow.has(seen.ts) && (now.editedTs !== seen.editedTs || now.editedTs === EDIT_STAMP_UNREADABLE)) {
      edited.push(seen.ts);
    }
  }
  return { added, edited: sortedUnique({ values: edited }), removed: sortedUnique({ values: removed }) };
}

/**
 * The `oldest` Slack reads as "from the very start" — the same value the recording's own read sends
 * (`../../cli/commands/slack/draftWiring.ts`). The stored {@link EMPTY_READ_THROUGH_TS} is NOT one: Slack refuses
 * `oldest=0000000000.000000` with `invalid_ts_oldest`, which left a draft recorded into a never-used group DM
 * unsendable on the owner's yes.
 */
const SLACK_OLDEST_FROM_START = "0";

/**
 * Where a top-level re-read starts, `oldest` itself included: the first message the recording saw, so every one of
 * them is read again and an edit or a removal shows; or the watermark itself when it saw none — and from the start
 * when that watermark is an empty read's zero boundary, since Slack reads no `ts` before it anyway. A thread is read
 * whole and ignores it.
 *
 * @param watermark where the draft's own read ended, and what it saw
 * @returns the `ts` the re-read starts at, as Slack's `oldest` accepts it
 */
export function releaseReadFrom({ watermark }: { watermark: ReleaseWatermark }): string {
  const first = watermark.seen?.[0];
  if (first !== undefined) {
    return first.ts;
  }
  if (watermark.throughTs === EMPTY_READ_THROUGH_TS) {
    return SLACK_OLDEST_FROM_START;
  }
  return watermark.throughTs;
}

/**
 * Every `ts` a change list names, once each, sorted — the set a clearance must name exactly.
 *
 * @param changes what moved
 * @returns the sorted, de-duplicated set
 */
export function changedSet({ changes }: { changes: ConversationChanges }): readonly string[] {
  return [...new Set([...changes.added, ...changes.edited, ...changes.removed])].toSorted((left, right) =>
    compareStrings({ a: left, b: right }),
  );
}

/**
 * Whether a release may send: nothing moved and nothing was cleared; or what moved is EXACTLY the set the session
 * read, judged and cleared. A clearance is never a blanket pass — one message more or one fewer is a conversation
 * that moved again after it was judged.
 *
 * @param changes what moved since the draft's read
 * @param cleared the `ts` set `--thread-moved-cleared` named, or `undefined` when the flag was not passed
 * @param draftId the row, named in a refusal
 * @returns the cleared set the release records (empty when nothing moved), or why it may not send
 */
export function evaluateReleaseFreshness({
  changes,
  cleared,
  draftId,
}: {
  changes: ConversationChanges;
  cleared: readonly string[] | undefined;
  draftId: string;
}): Result<readonly string[], ReleaseFreshnessError> {
  const changed = changedSet({ changes });
  if (cleared === undefined) {
    if (changed.length === 0) {
      return ok([]);
    }
    return err(ReleaseFreshnessErrors.threadMoved({ changes, draftId }));
  }
  const clearedSet = [...new Set(cleared)].toSorted((left, right) => compareStrings({ a: left, b: right }));
  const exact = clearedSet.length === changed.length && clearedSet.every((ts, index) => ts === changed[index]);
  if (!exact) {
    return err(ReleaseFreshnessErrors.clearanceMismatch({ changed, cleared: clearedSet, draftId }));
  }
  return ok(changed);
}

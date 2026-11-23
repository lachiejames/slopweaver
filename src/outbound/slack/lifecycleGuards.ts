/**
 * The two guards that stand in front of every edit and delete. Both are pure predicates over already-read
 * facts, which is the only reason they can be exhaustively tested.
 *
 * **Ownership** answers "may slopweaver mutate this message at all?". Editing or deleting someone else's
 * message is out of scope and REFUSED rather than merely ungated, so the refusal has to be a decision this
 * code makes rather than a permission Slack happens not to grant.
 *
 * **Reservation exemption** answers "does this mutation need the atomic duplicate claim?". Copying PR5's
 * guard unchanged onto the lifecycle would break one of two ways: applied to every progress edit it would
 * block every tick after the first, and dropped from the final post it would defeat the double-post
 * protection that guard exists for. So the rule is stated once, as data, and asserted in both directions.
 */
import { slackTsToEpochMs } from "../../lib/slackTs.js";

/**
 * The renderer versions this build understands well enough to re-render.
 *
 * An unknown version is REFUSED rather than edited. An edit re-renders the whole message from a new form,
 * so editing a message laid out by a renderer this build does not know would silently replace one shape
 * with another — the reader sees a card that changed layout as well as content, and nothing says why.
 *
 * ## Every renderer that has EVER posted belongs here, not just the ones still writing
 *
 * This set is about RECOGNITION, which is a different question from whether a shape is still produced.
 * Slack holds messages this repository posted days ago and nobody can go back and re-stamp them, so
 * dropping a retired renderer's id here tidies nothing — it strands every message already carrying it, and
 * `slack delete` refuses those along with `slack edit`, because both reach the same ownership guard. The
 * refusal is actively misleading in that case: it tells the operator to UPGRADE slopweaver, when upgrading
 * is exactly what broke it.
 *
 * So entries are added and never removed. `slack-assistant-answer-v1` joined on the way in for the mirror
 * image of the same problem: the bot posts that shape on every turn now, and omitting it would leave the
 * owner unable to delete anything their own bot said from this build onward. `slack-assistant-answer-v2`
 * joins the same way, for the same reason, the moment an actual answer starts carrying `askIdentity`.
 */
const KNOWN_RENDERERS: ReadonlySet<string> = new Set([
  "slack-card-v1",
  "slack-no-fold-v1",
  "slack-progress-v1",
  "slack-poll-v1",
  "slack-turn-v1",
  "slack-assistant-answer-v1",
  "slack-assistant-answer-v2",
  // `./noticeMetadata.ts` — a plain bot notice. Recognised so `slack delete` can retract one; `slack edit`
  // recognises it only to refuse it by name, so recognising it here re-renders nothing.
  "slack-notice-v1",
]);

/**
 * The facts a message read-back yields, normalised away from the raw SDK response.
 *
 * `fileIds` matters more than it looks: `chat.update` without `file_ids` DETACHES whatever media the
 * message already had, so an edit has to read them back and re-send them or it silently drops the files.
 */
export interface ReadSlackMessage {
  readonly ts: string;
  /** `bot_id` — present on a message posted by a bot, absent on a human's. */
  readonly botId?: string | undefined;
  /** `user` — the posting user id (for a bot message, the bot's own user). */
  readonly userId?: string | undefined;
  /** `metadata.event_type`, when the message carries metadata at all. */
  readonly metadataEventType?: string | undefined;
  /** `metadata.event_payload.renderer`, when present. */
  readonly renderer?: string | undefined;
  /**
   * `metadata.event_payload.askIdentity`, when present, unvalidated.
   *
   * Only an ANSWER card carries one, and only the edit path reads it: a re-render must reuse the identity
   * of the ask it already answers rather than mint a new one, so it is carried through the read-back as the
   * opaque value it is and parsed by the one caller that knows its shape.
   */
  readonly askIdentity?: unknown;
  /**
   * `metadata.event_payload.turnId` / `.pollId`, when a non-empty string. The same inheritance as
   * {@link ReadSlackMessage.askIdentity}: an edit of a turn checklist or a poll re-renders under the id the message
   * already carries, never one the caller supplies, so it stays the same turn's card or the same ballot's poll.
   */
  readonly turnId?: string | undefined;
  readonly pollId?: string | undefined;
  /**
   * Slack's own `thread_ts` — which thread the message actually hangs in, absent on a channel-root message.
   *
   * Carried because a LOCAL record claiming a message belongs to a thread is an assertion and this is the
   * observation. `../../live/turn/supersession/eligibility.ts` is the one caller that needs the difference:
   * a completion row naming `(channel, threadTs)` is written by whatever process appended it, while this
   * field is what Slack says, and a correction may only delete an answer standing in its OWN thread.
   */
  readonly threadTs?: string | undefined;
  /**
   * `edited.ts` — when the message was last edited in place, absent on one never edited.
   *
   * The only field here that reports CHANGE rather than identity, and it is why it is carried: a
   * supersession decision is made about the words that were in a message, and `chat.update` can replace
   * those words without the `ts` moving. An answer repaired since this installation recorded it is no
   * longer the answer anyone judged, so the eligibility check refuses it rather than deleting the repair.
   */
  readonly editedTs?: string | undefined;
  /** The ids of files already attached, so an edit can preserve them. */
  readonly fileIds: readonly string[];
  /**
   * The subset of `fileIds` Slack reports as an `image/*` mimetype — absent when the read-back did not
   * classify them. The graph-finding floor counts these, never `fileIds`: an answer's documents ride the
   * same list, and two PDFs beside one screenshot are not three pictures.
   */
  readonly imageFileIds?: readonly string[];
  /**
   * The `blocks` Slack STORED, for checking how it parsed what we posted (`./renderCheck.ts`).
   *
   * Deliberately `unknown[]` rather than a typed block union. It is a provider response and the only thing
   * that reads it walks structurally, so typing it would be inventing a contract Slack never promised.
   *
   * Worth stating what this is NOT, because carrying message content on a WRITE transport is the kind of
   * thing that quietly becomes a second read path. This is only ever populated for a message addressed by
   * an exact `ts` the caller just posted, and its one consumer asks a question about OUR OWN render. Reading
   * anybody's messages stays with `refresh` and `slack read-thread`, which own it properly.
   */
  readonly blocks?: readonly unknown[] | undefined;
  /**
   * The rest of what Slack STORED — the top-level `text`, the raw `attachments` and the raw `metadata` — for the
   * one caller that rewrites a message from its own stored shape rather than from a new form:
   * `./claimCorrection.ts`, striking a claim in place. The same bound as {@link ReadSlackMessage.blocks} holds:
   * populated only for a message addressed by an exact `ts`, and that caller acts only on a message the ownership
   * guard has already called ours.
   */
  readonly stored?: StoredSlackContent | undefined;
}

/** The raw stored content of one message, as Slack returned it, untyped on purpose (see `blocks`). */
interface StoredSlackContent {
  readonly text?: string | undefined;
  readonly attachments?: readonly unknown[] | undefined;
  readonly metadata?: unknown;
}

/**
 * The edit a caller may not act over: `edited.ts` at or after the instant the caller's decision was made.
 *
 * A pure predicate over one already-read message, which is what lets BOTH callers share it — and sharing
 * it is the point rather than tidiness. `../../live/turn/supersession/eligibility.ts` asks it of the read
 * that decides, and `./deleteOwnedMessage.ts` asks it again of the read immediately before the delete, so
 * an edit landing between those two reads cannot slip through the window. Two copies of this comparison
 * would eventually disagree, and the direction they disagreed in would be a message deleted after somebody
 * repaired it.
 *
 * An `edited.ts` this code cannot place in time counts as an edit that HAPPENED, not one that did not: the
 * refusal direction is the safe one, and a malformed field is exactly when guessing is worst. The instant
 * comes from `slackTsToEpochMs` rather than from arithmetic here — deriving one by hand is what
 * `.claude/rules/typescript-patterns.md` § Never scale an epoch into a `Date` exists to stop.
 *
 * The comparison is INCLUSIVE for the same reason. An edit stamped at the caller's own instant could have
 * landed either side of the record, and the two are indistinguishable from here — so the tie refuses rather
 * than deletes. Both callers' tests assert that exact boundary, because `>` instead of `>=` is a one-character
 * mutation that changes only this case.
 *
 * @param live the message as Slack read it back
 * @param sinceIso the instant the caller's own record was written, which the edit must predate
 * @returns the disqualifying `edited.ts`, or `undefined` when the message is still the one that was judged
 */
export function editedAtOrAfter({ live, sinceIso }: { live: ReadSlackMessage; sinceIso: string }): string | undefined {
  const editedTs = live.editedTs;
  if (editedTs === undefined) {
    return undefined;
  }
  const editedMs = slackTsToEpochMs({ ts: editedTs });
  const sinceMs = Date.parse(sinceIso);
  if (editedMs === undefined || Number.isNaN(sinceMs) || editedMs >= sinceMs) {
    return editedTs;
  }
  return undefined;
}

/**
 * Who this token is, from `auth.test`. The comparison target for ownership.
 *
 * `teamId` is carried alongside the ownership fields even though ownership never reads it — it is the same
 * response, cached the same way, and a channel-surface `chat.startStream` needs it as `recipient_team_id`.
 * Adding a second `auth.test`-shaped type for one extra field would be the split this repo's own doctrine
 * warns against.
 */
export interface SlackSelfIdentity {
  readonly botId?: string | undefined;
  readonly userId?: string | undefined;
  readonly teamId?: string | undefined;
  /**
   * `auth.test`'s own `url` — the workspace base a permalink is built on (`./renderCheck.ts`).
   *
   * Here for exactly the reason `teamId` is: same response, cached the same way, and a second
   * `auth.test`-shaped type for one more field is the split this repo's doctrine warns against. It is also
   * what makes `chat.getPermalink` unnecessary on the send path.
   */
  readonly workspaceUrl?: string | undefined;
}

/**
 * Whether slopweaver may mutate a message, and when not, exactly why.
 *
 * The reasons are separate arms rather than one boolean because each one has a different correction for
 * the operator: a foreign message means "you targeted the wrong `ts`", a missing metadata type means
 * "this was not posted by slopweaver", and an unknown renderer means "this build is too old to edit it".
 */
export type OwnershipVerdict =
  | { readonly kind: "owned"; readonly renderer: string }
  | { readonly kind: "not-ours-bot"; readonly messageBotId: string | undefined }
  | { readonly kind: "no-slopweaver-metadata" }
  | { readonly kind: "unexpected-event-type"; readonly found: string }
  | { readonly kind: "unknown-renderer"; readonly found: string | undefined };

/**
 * Decide whether slopweaver posted this message and may therefore mutate it.
 *
 * BOTH halves are required, and neither alone would do. Matching only the bot id would let slopweaver edit
 * any message its own Slack app ever posted, including ones some other feature owns. Matching only the
 * metadata would trust a field any writer can set. Requiring both means the message was posted by this
 * token AND is shaped like something this program laid out.
 *
 * ## What this guard does and does not prove
 *
 * A review attacked the stronger claim and was right to. `metadata` is writable by anyone holding the
 * token, so another feature sharing this same bot app could post slopweaver's `event_type` and renderer and
 * would then pass this check. So the honest statement of the guarantee is:
 *
 *  - a HUMAN's message is never touched (it carries no `bot_id`);
 *  - a DIFFERENT bot app's message is never touched (its `bot_id` differs);
 *  - a message that is not shaped like a slopweaver artifact is never touched;
 *  - a message from a renderer version this build does not understand is never touched;
 *  - but a co-tenant of this exact bot token that deliberately imitates slopweaver's metadata is NOT
 *    excluded, and cannot be: anything slopweaver can write, another holder of the same token can write.
 *
 * That last case is a trust boundary rather than a security one, and it is not worth defending here —
 * whoever holds the token can already post, edit and delete anything directly, without going through this
 * code at all. The guard's job is to stop MISTAKES: a wrong `--ts` aimed at a colleague's message, a stale
 * timestamp, a message some other tool posted. It does that completely.
 *
 * @param message the normalised read-back
 * @param self who this token is, from `auth.test`
 * @param expectedEventTypes the `metadata.event_type` values this operation accepts (card and/or progress)
 * @returns the verdict, carrying the reason when it refuses
 */
export function messageOwnership({
  message,
  self,
  expectedEventTypes,
}: {
  message: ReadSlackMessage;
  self: SlackSelfIdentity;
  expectedEventTypes: readonly string[];
}): OwnershipVerdict {
  // A bot id we cannot compare is a refusal, not a pass: "we could not tell" must never read as "ours".
  if (self.botId === undefined || message.botId !== self.botId) {
    return { kind: "not-ours-bot", messageBotId: message.botId };
  }
  const eventType = message.metadataEventType;
  if (eventType === undefined || eventType.length === 0) {
    return { kind: "no-slopweaver-metadata" };
  }
  if (!expectedEventTypes.includes(eventType)) {
    return { found: eventType, kind: "unexpected-event-type" };
  }
  const renderer = message.renderer;
  if (renderer === undefined || !KNOWN_RENDERERS.has(renderer)) {
    return { found: renderer, kind: "unknown-renderer" };
  }
  return { kind: "owned", renderer };
}

/** The refused message's `bot_id` as the refusal prints it: a human's message carries none, read as `absent`. */
function refusedBotId({ messageBotId }: { messageBotId: string | undefined }): string {
  if (messageBotId === undefined) {
    return "absent";
  }
  return messageBotId;
}

/**
 * The refused message's renderer as the refusal prints it, JSON-quoted: a message whose metadata names no
 * renderer at all reads as a bare `null`, so it is not mistaken for one named `"absent"` or `""`.
 */
function refusedRenderer({ found }: { found: string | undefined }): string {
  if (found === undefined) {
    return "null";
  }
  return JSON.stringify(found);
}

/**
 * The operator-facing refusal for a verdict that is not `owned`.
 *
 * @param verdict the refusing verdict
 * @param ts the message timestamp that was targeted
 * @returns one line naming what was wrong and what to do about it
 */
export function ownershipRefusal({ verdict, ts }: { verdict: OwnershipVerdict; ts: string }): string {
  switch (verdict.kind) {
    case "owned":
      return `message ${ts} is ours`;
    case "not-ours-bot":
      return (
        `refusing to touch message ${ts}: slopweaver did not post it (bot_id ` +
        `${refusedBotId({ messageBotId: verdict.messageBotId })}). Slopweaver only ever edits or deletes its own messages — ` +
        "check the --ts you passed"
      );
    case "no-slopweaver-metadata":
      return (
        `refusing to touch message ${ts}: it carries no slopweaver metadata, so it was not posted by this ` +
        "program even though the same bot posted it"
      );
    case "unexpected-event-type":
      return (
        `refusing to touch message ${ts}: its metadata event_type is ${JSON.stringify(verdict.found)}, which ` +
        "this operation does not accept"
      );
    case "unknown-renderer":
      return (
        `refusing to touch message ${ts}: it was laid out by renderer ${refusedRenderer({ found: verdict.found })}, ` +
        "which this build does not know how to re-render. Upgrade slopweaver rather than replacing the message " +
        "with a different shape"
      );
  }
}

/** Which mutation is being performed. */
export type LifecycleOperationKind = "post" | "edit" | "delete";

/** Which kind of message it is performed on. */
export type LifecycleMessageKind = "progress" | "card";

/**
 * Whether a mutation is EXEMPT from the atomic duplicate reservation (`./sendReservation.ts`).
 *
 * The whole table, and the reasoning for each row:
 *
 * | kind     | post        | edit   | delete |
 * |----------|-------------|--------|--------|
 * | progress | exempt      | exempt | exempt |
 * | card     | **reserve** | exempt | exempt |
 *
 * A progress message is rewritten many times per task by design, so reserving on its edits would block
 * every tick after the first. Its POST is exempt too, for a different reason: it is transient and gets
 * deleted, so a duplicate progress message is litter that the sweep clears, not a duplicate artifact in
 * the permanent record. Edits and deletes of a CARD are exempt because they are idempotent — repeating an
 * identical edit converges on the same message, and a repeated delete is already gone.
 *
 * The one non-exempt cell is the card POST, which is the irreversible one, and it is exactly the cell PR5
 * built the reservation for.
 *
 * @param operation which mutation
 * @param kind which kind of message
 * @returns true when no reservation is required
 */
export function isReservationExempt({
  operation,
  kind,
}: {
  operation: LifecycleOperationKind;
  kind: LifecycleMessageKind;
}): boolean {
  return !(kind === "card" && operation === "post");
}

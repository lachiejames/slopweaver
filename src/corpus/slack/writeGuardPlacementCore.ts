/**
 * What every step of the placement read-back stands on: the seams, the one post being settled, the bounded read-back
 * and the address it is judged against, and the journal rows that open and close a repair. `./writeGuardPlacement.ts`
 * settles a post over these and carries the contract; `./writeGuardPlacementRepair.ts` performs the move and the
 * cross-link. Split under the file-size cap along that line: this module only READS and JOURNALS, never posts or
 * deletes, so every act the guard can take on Slack is in the other two. Both import from here; this imports from
 * neither.
 */
import { err, ok, type Result } from "../../lib/result.js";
import {
  PLACEMENT_SCHEMA_VERSION,
  type PlacementJournalRow,
  type PlacementRepairAct,
} from "../../live/slack/placementJournal.js";
import type { ReadSlackMessage } from "../../outbound/slack/lifecycleGuards.js";
import {
  addressedToPerson,
  compareSlackPlacement,
  type PlacedMessageRef,
  type PlacementOutcome,
  type PlacementReport,
  type SlackPlacementAddress,
} from "../../outbound/slack/placement.js";
import type { PostedMessage, SlackWriteTransport } from "./writeTransport.js";

/**
 * How many times a read-back looks for a message before calling it not visible. Slack documents no read-after-write
 * guarantee for `conversations.history`, so an empty first read is retried rather than reported — and since an
 * empty read only ever makes the post `unverified`, never repaired, the bound is a cost ceiling, not a safety one.
 */
export const READ_BACK_ATTEMPTS = 3;

/** The pause between read-back attempts. */
const READ_BACK_PAUSE_MS = 500;

/** What the guard needs beyond the transport it wraps. */
export interface PlacementGuardSeams {
  /** Every raw message in one thread, root included. */
  readonly readThread: (args: { channel: string; threadTs: string }) => Promise<Result<readonly unknown[], string>>;
  /** Append one journal row; an `Err` carries why it could not be written. */
  readonly appendRow: (args: { row: PlacementJournalRow }) => Result<void, string>;
  readonly nowIso: () => string;
  /** Wait between read-back attempts; a test passes one that returns at once. */
  readonly pause: (args: { ms: number }) => Promise<void>;
}

/** A post method, narrowed to the one shape the guard drives. */
export type Post<A> = (args: A) => Promise<PostedMessage>;

/** Everything one post's settlement reads and writes through. */
export interface Settling<A> {
  readonly transport: SlackWriteTransport;
  readonly seams: PlacementGuardSeams;
  readonly post: Post<A>;
  readonly args: A;
  readonly intended: SlackPlacementAddress;
  readonly surface: string;
}

/** The failure reasons a repair can end in. */
type RepairFailure = Extract<PlacementOutcome, { kind: "repair-failed" }>["reason"];

/**
 * An error's own words, for a detail line.
 *
 * @returns the message of an `Error`, else the value as a string
 */
export function causeText({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Read one message back once; a throw is a failed read, never an escape. */
async function readOnce({
  transport,
  posted,
}: {
  transport: SlackWriteTransport;
  posted: PlacedMessageRef;
}): Promise<Result<ReadSlackMessage | undefined, string>> {
  try {
    return ok(await transport.readMessage({ posted: { channel: posted.channel, ts: posted.ts } }));
  } catch (cause) {
    return err(causeText({ cause }));
  }
}

/**
 * Read one message back, looking again a bounded number of times while Slack has not surfaced it yet. A failed
 * read is answered at once: only "not there yet" is worth waiting on.
 *
 * @returns the message, `undefined` when it never surfaced, or why the read failed
 */
export async function readBack({
  transport,
  seams,
  posted,
}: {
  transport: SlackWriteTransport;
  seams: PlacementGuardSeams;
  posted: PlacedMessageRef;
}): Promise<Result<ReadSlackMessage | undefined, string>> {
  let read = await readOnce({ posted, transport });
  for (let attempt = 1; attempt < READ_BACK_ATTEMPTS && read.isOk() && read.value === undefined; attempt += 1) {
    await seams.pause({ ms: READ_BACK_PAUSE_MS });
    read = await readOnce({ posted, transport });
  }
  return read;
}

/**
 * The root a read-back says the message hangs under.
 *
 * @returns the root ts, or `undefined` for a top-level message
 */
export function observedRootOf({ read }: { read: ReadSlackMessage }): string | undefined {
  return read.threadTs === read.ts ? undefined : read.threadTs;
}

/**
 * The `ts` a message's conversation is read under: the root its read-back names, else the message's own `ts`, so a
 * top-level message's replies are read in its own thread.
 *
 * @param read the read-back, absent when the message could not be read
 * @param ts the message's own ts
 * @returns the thread `ts` to read
 */
export function conversationTsOf({ read, ts }: { read: ReadSlackMessage | undefined; ts: string }): string {
  if (read === undefined) {
    return ts;
  }
  const root = observedRootOf({ read });
  if (root === undefined) {
    return ts;
  }
  return root;
}

/**
 * The address a mismatch is judged against, with a reply addressed AT a reply resolved to that thread's root.
 *
 * Only consulted for a message that landed in a thread of the addressed conversation while a thread was asked
 * for. `undefined` when the addressed ts could not be read, which the caller answers as `unverified`.
 *
 * @returns the address to judge against, or `undefined` when the addressed ts could not be read
 */
export async function canonicalAddress<A>({
  settling,
  observedChannel,
}: {
  settling: Settling<A>;
  observedChannel: string;
}): Promise<SlackPlacementAddress | undefined> {
  const { intended } = settling;
  if (intended.threadTs === undefined) {
    return intended;
  }
  const root = await readOnce({
    posted: { channel: observedChannel, ts: intended.threadTs },
    transport: settling.transport,
  });
  if (root.isErr() || root.value === undefined) {
    return undefined;
  }
  const resolved = observedRootOf({ read: root.value });
  return resolved === undefined ? intended : { ...intended, threadTs: resolved };
}

/**
 * The root an UNREAD post is registered under, proven without the read that failed. A post addressed top level is
 * its own root: Slack threads a message only when `thread_ts` is passed. A reply's addressed ts is read for its own
 * root, as {@link canonicalAddress} does, because a reply addressed at a reply is threaded under that thread's root.
 * `undefined` when that read fails: a reply's ts registered as a root is a key no later read finds anything under.
 *
 * @returns the root ts, or `undefined` when it could not be proven
 */
export async function unreadRootOf<A>({
  settling,
  posted,
}: {
  settling: Settling<A>;
  posted: PlacedMessageRef;
}): Promise<string | undefined> {
  if (settling.intended.threadTs === undefined) {
    return posted.ts;
  }
  const canonical = await canonicalAddress({ observedChannel: posted.channel, settling });
  return canonical?.threadTs;
}

/** Append a row, answering a failure as text rather than a throw. */
function journal({ seams, row }: { seams: PlacementGuardSeams; row: PlacementJournalRow }): string | undefined {
  const written = seams.appendRow({ row });
  return written.isErr() ? `placement journal unwritable: ${written.error}` : undefined;
}

/** The thread a message lives in for a later re-read: its root, or itself when it is top level. */
function threadRootOf({ read }: { read: ReadSlackMessage | undefined }): string | undefined {
  if (read === undefined) {
    return undefined;
  }
  return conversationTsOf({ read, ts: read.ts });
}

/**
 * Finish one post: write its result row and hand the caller the identity that stands.
 *
 * @returns the standing message, carrying its placement report
 */
export function finish<A>({
  settling,
  outcome,
  final,
  read,
  unread,
}: {
  settling: Settling<A>;
  outcome: PlacementOutcome;
  final: PlacedMessageRef;
  read: ReadSlackMessage | undefined;
  /** When no read came back: who posted and the root it was SENT to, when provable, so a later re-read finds it. */
  unread?: {
    readonly botId: string | undefined;
    readonly userId: string | undefined;
    readonly threadRoot: string | undefined;
  };
}): PostedMessage {
  const known =
    read === undefined ? unread : { botId: read.botId, threadRoot: threadRootOf({ read }), userId: read.userId };
  const row: PlacementJournalRow = {
    botId: known?.botId,
    detail: outcome.kind === "verified" ? undefined : outcome.detail,
    final,
    intended: settling.intended,
    kind: "placement-settled",
    outcome: outcome.kind,
    schemaVersion: PLACEMENT_SCHEMA_VERSION,
    surface: settling.surface,
    threadRoot: known?.threadRoot,
    tsIso: settling.seams.nowIso(),
    userId: known?.userId,
  };
  const journalFailure = journal({ row, seams: settling.seams });
  const placement: PlacementReport = journalFailure === undefined ? { outcome } : { journalFailure, outcome };
  return { channel: final.channel, placement, ts: final.ts };
}

/**
 * A repair that stopped short: `standing` is the message the send's identity now names.
 *
 * @returns the standing message, settled `repair-failed`
 */
export function repairFailed<A>({
  settling,
  standing,
  read,
  reason,
  detail,
}: {
  settling: Settling<A>;
  standing: PlacedMessageRef;
  read: ReadSlackMessage | undefined;
  reason: RepairFailure;
  detail: string;
}): PostedMessage {
  return finish({
    final: standing,
    outcome: { detail, kind: "repair-failed", posted: standing, reason },
    read,
    settling,
  });
}

/**
 * Write the intent row; an unwritable one is the reason no repair act runs.
 *
 * @returns why the row could not be written, or `undefined` once it was
 */
export function intend<A>({
  settling,
  posted,
  act,
  engagement,
  detail,
}: {
  settling: Settling<A>;
  posted: PlacedMessageRef;
  act: PlacementRepairAct;
  engagement: readonly string[];
  detail: string;
}): string | undefined {
  return journal({
    row: {
      act,
      detail,
      engagement,
      intended: settling.intended,
      kind: "placement-repair-intended",
      posted,
      schemaVersion: PLACEMENT_SCHEMA_VERSION,
      tsIso: settling.seams.nowIso(),
    },
    seams: settling.seams,
  });
}

/**
 * For a post addressed to a PERSON, who is on the other end of the `D…` Slack answered with; undefined for any other
 * address, and when `conversations.info` names nobody or fails — which the comparison then reads as not matched.
 *
 * @returns the DM member's user id, or `undefined`
 */
export async function dmMemberOf<A>({
  settling,
  channel,
}: {
  settling: Settling<A>;
  channel: string;
}): Promise<string | undefined> {
  if (!addressedToPerson({ address: settling.intended })) {
    return undefined;
  }
  const info = await settling.transport.conversationInfo({ channel }).catch(() => undefined);
  return info?.user;
}

/**
 * Whether a just-posted message reads back where it was addressed.
 *
 * @returns the verdict, the read it rests on, and the reason when it was not right
 */
export async function landedRight<A>({
  settling,
  posted,
}: {
  settling: Settling<A>;
  posted: PlacedMessageRef;
}): Promise<{ readonly right: boolean; readonly read: ReadSlackMessage | undefined; readonly detail: string }> {
  const read = await readBack({ posted, seams: settling.seams, transport: settling.transport });
  if (read.isErr() || read.value === undefined) {
    return { detail: read.isErr() ? read.error : "not visible yet", read: undefined, right: false };
  }
  const dmMember = await dmMemberOf({ channel: posted.channel, settling });
  const match = compareSlackPlacement({
    observed: { channel: posted.channel, dmMember, threadTs: read.value.threadTs, ts: posted.ts },
    requested: settling.intended,
  });
  return { detail: match.kind === "matched" ? "" : match.detail, read: read.value, right: match.kind === "matched" };
}

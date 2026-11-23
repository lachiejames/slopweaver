/**
 * The canonical exact-ask identity — one name for the `{channel, messageTs, threadTs}` triple every capture,
 * brief, poster and queue boundary already carries as three separately-declared fields.
 *
 * `Mention` has always parsed this triple correctly: the addressing message's own `ts` versus the thread it
 * replies into. What was missing was a shared TYPE, not the data — `TurnBrief` drops `messageTs` at the brief
 * boundary, `turn answer` then reconstructs it by guessing `threadTs`, and two asks sharing a thread root
 * become indistinguishable the moment either loses the field that told them apart. `AskIdentity` closes that
 * by being the one contract every one of those boundaries extends, so a field that goes missing is a type
 * error rather than a silent guess.
 */
import { isRecord } from "../../lib/parsers.js";

/** The exact address of one ask: which channel, which message asked it, which thread it replies into. */
export interface AskIdentity {
  readonly channel: string;
  /** The addressing message's own `ts` — never reconstructed from `threadTs`. */
  readonly messageTs: string;
  /** The thread to reply in — the message's own `ts` when it started a thread, else the real thread root. */
  readonly threadTs: string;
}

/**
 * An ask identity as actually recorded: exact when the addressing timestamp was captured, or
 * `thread-only` when only the thread target was recorded (a schema-1 queue row).
 *
 * A `thread-only` record is never upgraded by inventing `messageTs` from `threadTs` — that is exactly the
 * reconstruction this contract exists to forbid, just moved to the read side instead of the write side.
 */
export type RecordedAskIdentity =
  | (AskIdentity & { readonly quality: "exact" })
  | { readonly quality: "thread-only"; readonly channel: string; readonly threadTs: string };

/**
 * Project an already-typed source down to its exact identity triple.
 *
 * @param source anything that carries the three identity fields
 * @returns a fresh, flat `AskIdentity` copy
 */
export function askIdentityOf({ source }: { source: AskIdentity }): AskIdentity {
  return { channel: source.channel, messageTs: source.messageTs, threadTs: source.threadTs };
}

/**
 * Wrap an exact identity as a `RecordedAskIdentity` of `quality: "exact"`.
 *
 * @param askIdentity the exact identity to record
 * @returns the exact-quality recorded identity
 */
export function exactRecordedAskIdentity({
  askIdentity,
}: {
  askIdentity: AskIdentity;
}): Extract<RecordedAskIdentity, { quality: "exact" }> {
  return { ...askIdentityOf({ source: askIdentity }), quality: "exact" };
}

/** A non-empty string, never a value that merely happens to be truthy. */
function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Whether a decoded value is a well-formed `AskIdentity` — every field present and non-blank.
 *
 * @param value the decoded value to check
 * @returns whether `value` is a well-formed `AskIdentity`
 */
export function isAskIdentity(value: unknown): value is AskIdentity {
  return isRecord(value) && nonBlank(value["channel"]) && nonBlank(value["messageTs"]) && nonBlank(value["threadTs"]);
}

/**
 * The spelling of `thread-only` that answer messages already standing in Slack carry in their metadata.
 * Slack keeps a posted message's metadata as it was written, so the decoder recognises this byte explicitly
 * and returns the `thread-only` arm; nothing writes it.
 */
const SLACK_STORED_THREAD_ONLY_QUALITY = "legacy";

/**
 * Decode a `RecordedAskIdentity` — either quality, every required field present and non-blank, and a
 * `thread-only` record never carrying a `messageTs` it did not earn. The thread-only arm is accepted under
 * both its spellings ({@link SLACK_STORED_THREAD_ONLY_QUALITY}) and always returned as `thread-only`; any
 * other quality is refused rather than read as either arm.
 *
 * @param value the decoded value to check
 * @returns the identity, or `undefined` when `value` is not a well-formed one
 */
export function parseRecordedAskIdentity({ value }: { value: unknown }): RecordedAskIdentity | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const quality = value["quality"];
  if (quality === "exact") {
    return isAskIdentity(value) ? { ...askIdentityOf({ source: value }), quality: "exact" } : undefined;
  }
  if (quality !== "thread-only" && quality !== SLACK_STORED_THREAD_ONLY_QUALITY) {
    return undefined;
  }
  const channel = value["channel"];
  const threadTs = value["threadTs"];
  if (!nonBlank(channel) || !nonBlank(threadTs)) {
    return undefined;
  }
  return { channel, quality: "thread-only", threadTs };
}

/**
 * Whether two ask identities name the exact same ask — every field, not merely the same thread.
 *
 * @param left one identity
 * @param right the other identity
 * @returns whether all three fields match exactly
 */
export function sameAskIdentity({ left, right }: { left: AskIdentity; right: AskIdentity }): boolean {
  return left.channel === right.channel && left.messageTs === right.messageTs && left.threadTs === right.threadTs;
}

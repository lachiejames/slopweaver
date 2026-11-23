/**
 * The PERMANENT CONVERSATION ignore registry — "never reconsider ANY tag in this conversation," the
 * channel-keyed sibling of `./ignore.ts`'s exact-ask registry.
 *
 * `./ignore.ts` gates WHO gets suppressed at the granularity of one exact message. It has no notion of
 * WHERE: the owner ruling this closes is that every tag inside the owner's own DM with the
 * bot is "completely ignorable and should be on the blacklist" — a standing fact about the CONVERSATION, not
 * a list of 21 individual messages to name one at a time. Without this registry, "blacklist the DM" was 21
 * separate `turn ignore` invocations for the asks already stale there, and did nothing at all for the next
 * tag.
 *
 * This registry is checked at the SAME entrances `./ignore.ts` is (the listener's own capture, `turn
 * brief`/`dispatch`/`resume`/`answer`, `turn dispatch --sweep`, `listen recover`), keyed the same injective way, folded with the same
 * last-entry-wins idempotence — but it is append-only over a two-way KIND rather than one-way: an `ignore`
 * entry starts suppressing a channel, an `unignore` entry stops it, and the fold's last entry for a channel
 * (whichever kind) is what every entrance reads. That is what lets `turn ignore-conversation --remove` exist
 * without ever rewriting or truncating the log.
 */
import { optStr as str } from "../../corpus/slack/shape.js";
import { parseTolerantJsonlLog } from "../../lib/jsonParse.js";

/** The conversation-ignore-registry schema version. A line at a different version is refused, not reinterpreted. */
export const IGNORED_CONVERSATION_SCHEMA_VERSION = 1;

/** Whether one entry starts or stops a conversation's standing suppression. */
type IgnoredConversationKind = "ignore" | "unignore";

/** One entry in the permanent conversation-ignore registry — the CHANNEL-keyed sibling of `IgnoredAsk`. */
export interface IgnoredConversation {
  readonly schemaVersion: 1;
  readonly channel: string;
  readonly kind: IgnoredConversationKind;
  readonly ignoredAtIso: string;
  readonly reason: string;
}

/**
 * Encode one conversation-ignore entry as a JSONL line.
 *
 * @param entry the entry to encode
 * @returns the JSON line (no trailing newline)
 */
export function ignoredConversationLine({ entry }: { entry: IgnoredConversation }): string {
  return JSON.stringify(entry);
}

/**
 * Parse one decoded line into an {@link IgnoredConversation}, or `undefined` when the shape does not match.
 *
 * @param value the decoded JSON value
 * @returns the entry, or `undefined`
 */
function ignoredConversationOfValue({ value }: { value: Record<string, unknown> }): IgnoredConversation | undefined {
  if (value["schemaVersion"] !== IGNORED_CONVERSATION_SCHEMA_VERSION) {
    return undefined;
  }
  const channel = str({ value: value["channel"] });
  const kind = value["kind"];
  const ignoredAtIso = str({ value: value["ignoredAtIso"] });
  const reason = str({ value: value["reason"] });
  if (
    channel === undefined ||
    (kind !== "ignore" && kind !== "unignore") ||
    ignoredAtIso === undefined ||
    reason === undefined
  ) {
    return undefined;
  }
  return { channel, ignoredAtIso, kind, reason, schemaVersion: IGNORED_CONVERSATION_SCHEMA_VERSION };
}

/**
 * Parse the conversation-ignore registry's raw text into entries, in file order. Tolerant of a blank or
 * malformed line — a corrupt line must not make the whole registry unreadable, but a skipped line is a lost
 * fact worth reporting rather than silently dropping.
 *
 * @param text the raw log contents
 * @returns the parsed entries and the 1-indexed line numbers that could not be read
 */
export function parseIgnoredConversationsLog({ text }: { text: string }): {
  readonly entries: readonly IgnoredConversation[];
  readonly unreadable: readonly number[];
} {
  return parseTolerantJsonlLog({ ofValue: ignoredConversationOfValue, text });
}

/**
 * Fold entries into one map keyed by `channel`. The LAST entry for a channel wins regardless of its kind —
 * an `unignore` after an `ignore` genuinely un-suppresses it, and repeating the same kind twice is idempotent
 * the same way `./ignore.ts#foldIgnoredAsks` is.
 *
 * @param entries the parsed entries, in file order
 * @returns one entry per channel ever named, keyed by `channel`
 */
export function foldIgnoredConversations({
  entries,
}: {
  entries: readonly IgnoredConversation[];
}): ReadonlyMap<string, IgnoredConversation> {
  const byChannel = new Map<string, IgnoredConversation>();
  for (const entry of entries) {
    byChannel.set(entry.channel, entry);
  }
  return byChannel;
}

/**
 * Whether one channel is CURRENTLY under a standing conversation-ignore — its latest folded entry is an
 * `ignore`, not an `unignore` and not absent.
 *
 * @param channel the channel to check
 * @param ignored the folded registry
 * @returns whether every tag in this channel is currently suppressed
 */
export function isIgnoredConversation({
  channel,
  ignored,
}: {
  channel: string;
  ignored: ReadonlyMap<string, IgnoredConversation>;
}): boolean {
  return ignored.get(channel)?.kind === "ignore";
}

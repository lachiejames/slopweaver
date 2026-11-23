/**
 * The PERMANENT ignore registry — "never reconsider this exact message," distinct from a fresh
 * `no-response` judgement.
 *
 * A `no-response` `RoutingDecision` (see `../turn/judgement.js`) is one judgement attempt's own answer, and
 * the ask-lifecycle fold (`./lifecycle.js`) already records it as `triaged-no-response`. Neither is the right
 * shape for a standing "don't ever ask about this one again" — the lifecycle fold intentionally ignores an
 * event for a key it never captured, which is exactly what a message `listen recover` later surfaces (never
 * captured live) needs to be excluded too. This registry is therefore its own small append-only log, checked
 * at every entrance a message could otherwise re-reach a turn: the listener's own capture, `turn brief`/
 * `dispatch`/`resume`/`answer`, `turn dispatch --sweep` (`../turn/sweepIgnored.ts`, added after
 * days of a killed ask being reported `ready`), and `listen recover`'s classification.
 *
 * "Permanent" means standing until someone lifts it, not irrevocable. The log is append-only over two entry
 * shapes: an ignore (the line with no `kind`, or `kind: "ignore"`) and an `unignore`, which `turn ignore
 * --remove` writes. The fold's last entry for an ask decides, so an ask ignored by mistake is reopened at
 * every entrance without ever rewriting the log — the same two-way shape `./ignoredConversation.ts` has.
 */
import { optStr as str } from "../../corpus/slack/shape.js";
import { parseTolerantJsonlLog } from "../../lib/jsonParse.js";
import type { AskIdentity } from "./identity.js";

/** The ignore-registry schema version. A line at a different version is refused, not reinterpreted. */
export const IGNORED_ASK_SCHEMA_VERSION = 1;

/** One permanently-ignored ask, keyed the same injective way as the ask-lifecycle log. */
export interface IgnoredAsk {
  readonly schemaVersion: 1;
  readonly channel: string;
  readonly messageTs: string;
  readonly ignoredAtIso: string;
  readonly reason: string;
}

/** One lifted ignore — the entry `turn ignore --remove` appends, which reopens that exact ask. */
export interface UnignoredAsk {
  readonly schemaVersion: 1;
  readonly kind: "unignore";
  readonly channel: string;
  readonly messageTs: string;
  readonly ignoredAtIso: string;
  readonly reason: string;
}

/** Any one line of the registry log, in either direction. */
export type IgnoredAskEntry = IgnoredAsk | UnignoredAsk;

/**
 * The registry's key for one ask — `(channel, messageTs)`, JSON-encoded the same injective way
 * `./lifecycle.js#askLifecycleKey` keys the lifecycle log, so a colon or any other character either field
 * happens to contain can never make two distinct asks collide on one key.
 *
 * @param askIdentity the identity to key on; only `channel`/`messageTs` matter
 * @returns the registry key
 */
export function ignoredAskKey({ askIdentity }: { askIdentity: Pick<AskIdentity, "channel" | "messageTs"> }): string {
  return JSON.stringify([askIdentity.channel, askIdentity.messageTs]);
}

/**
 * Encode one ignored-ask entry as a JSONL line.
 *
 * @param entry the entry to encode
 * @returns the JSON line (no trailing newline)
 */
export function ignoredAskLine({ entry }: { entry: IgnoredAskEntry }): string {
  return JSON.stringify(entry);
}

/**
 * Parse one decoded line into an {@link IgnoredAskEntry}, or `undefined` when the shape does not match. A
 * line with no `kind` is an ignore: that is the shape every ignore has been written in.
 *
 * @param value the decoded JSON value
 * @returns the entry, or `undefined`
 */
function ignoredAskOfValue({ value }: { value: Record<string, unknown> }): IgnoredAskEntry | undefined {
  if (value["schemaVersion"] !== IGNORED_ASK_SCHEMA_VERSION) {
    return undefined;
  }
  const kind = value["kind"];
  const channel = str({ value: value["channel"] });
  const messageTs = str({ value: value["messageTs"] });
  const ignoredAtIso = str({ value: value["ignoredAtIso"] });
  const reason = str({ value: value["reason"] });
  if (channel === undefined || messageTs === undefined || ignoredAtIso === undefined || reason === undefined) {
    return undefined;
  }
  const fields = { channel, ignoredAtIso, messageTs, reason, schemaVersion: IGNORED_ASK_SCHEMA_VERSION } as const;
  if (kind === "unignore") {
    return { ...fields, kind };
  }
  if (kind === undefined || kind === "ignore") {
    return fields;
  }
  return undefined;
}

/**
 * Parse the ignore registry's raw text into entries, in file order. Tolerant of a blank or malformed line —
 * a corrupt line must not make the whole registry unreadable, but a skipped line is a lost fact worth
 * reporting rather than silently dropping.
 *
 * @param text the raw log contents
 * @returns the parsed entries and the 1-indexed line numbers that could not be read
 */
export function parseIgnoredAsksLog({ text }: { text: string }): {
  readonly entries: readonly IgnoredAskEntry[];
  readonly unreadable: readonly number[];
} {
  return parseTolerantJsonlLog({ ofValue: ignoredAskOfValue, text });
}

/**
 * Fold entries into one map of the asks CURRENTLY ignored, keyed by {@link ignoredAskKey}. The last entry
 * for an ask wins: an `unignore` removes it, a later ignore puts it back, and repeating either is idempotent.
 *
 * @param entries the parsed entries, in file order
 * @returns one entry per currently-ignored ask, keyed by {@link ignoredAskKey}
 */
export function foldIgnoredAsks({ entries }: { entries: readonly IgnoredAskEntry[] }): ReadonlyMap<string, IgnoredAsk> {
  const byKey = new Map<string, IgnoredAsk>();
  for (const entry of entries) {
    const key = ignoredAskKey({ askIdentity: entry });
    if ("kind" in entry) {
      byKey.delete(key);
    } else {
      byKey.set(key, entry);
    }
  }
  return byKey;
}

/**
 * Whether one ask has been permanently ignored.
 *
 * @param askIdentity the identity to check; only `channel`/`messageTs` matter
 * @param ignored the folded registry
 * @returns whether this exact ask is in the registry
 */
export function isIgnoredAsk({
  askIdentity,
  ignored,
}: {
  askIdentity: Pick<AskIdentity, "channel" | "messageTs">;
  ignored: ReadonlyMap<string, IgnoredAsk>;
}): boolean {
  return ignored.has(ignoredAskKey({ askIdentity }));
}

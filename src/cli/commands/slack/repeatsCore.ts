/**
 * Pure halves of `slopweaver slack repeats`: argument handling, and the three decisions the read makes off
 * what Slack returned — which places a search named, which of a history's threads to open, and which of a
 * place's messages are this identity's own. No clock, no network; the shell is `./repeatsRun.ts`.
 */

import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { slackTsToEpochMs } from "../../../lib/slackTs.js";
import type { AuditMessage, RepeatActor } from "../../../outbound/slack/repeatAudit.js";
import { isOwnMessage, priorsFromRaw, type RepeatSelf } from "../../../outbound/slack/repeatMatch.js";
import { flagValue, flagValueOr, parseFlagTail, positiveIntFlag } from "../../optionParsers.js";

/** Every flag this verb accepts. */
const SLACK_REPEATS_FLAG_SPEC = {
  boolean: ["json"],
  value: ["days", "as", "home"],
} as const;

/** Every flag NAME, derived from the spec rather than re-listed, so the two cannot drift. */
export const SLACK_REPEATS_FLAG_NAMES: readonly string[] = [
  ...SLACK_REPEATS_FLAG_SPEC.boolean,
  ...SLACK_REPEATS_FLAG_SPEC.value,
].map((name) => `--${name}`);

/** The window the audit reads when `--days` is absent: their ruling's "the last 7 days". */
const DEFAULT_DAYS = 7;

/** The resolved invocation. */
export interface SlackRepeatsOptions {
  readonly days: number;
  /** Which identities to audit. */
  readonly actors: readonly RepeatActor[];
  readonly json: boolean;
  readonly home: string;
}

/**
 * Parse `slack repeats`'s argv tail.
 *
 * @param rest the argv after the verb
 * @param defaultHome the home used when `--home` is absent
 * @returns the options, or every usage problem at once
 */
export function parseSlackRepeatsOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<SlackRepeatsOptions> {
  const parsed = parseFlagTail({ rest, spec: SLACK_REPEATS_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const problems: string[] = [];
  const days = positiveIntFlag({ fallback: DEFAULT_DAYS, name: "days", problems, values: parsed.value.values });
  const as = flagValue({ name: "as", parsed: parsed.value });
  let actors: readonly RepeatActor[] = ["me", "bot"];
  if (as === "me" || as === "bot") {
    actors = [as];
  } else if (as !== null && as !== "both") {
    problems.push(`--as must be me, bot or both, got ${JSON.stringify(as)}`);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    actors,
    days,
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: parsed.value.flags.has("json"),
  });
}

/** One conversation, or one thread inside it. */
export interface RepeatPlace {
  readonly channel: string;
  /** The thread root, absent for the conversation's top level. */
  readonly threadTs?: string | undefined;
}

/** The `thread_ts` a search permalink carries, or `undefined` for a top-level message. */
function threadOfPermalink({ permalink }: { permalink: string }): string | undefined {
  const match = /[?&]thread_ts=(\d+\.\d+)/u.exec(permalink);
  return match === null ? undefined : match[1];
}

/**
 * The places a `from:` search named: every conversation it touched (its top level is read whole), and every
 * thread one of its matches sits in. Search is used to FIND places only — it collapses matches that sit close
 * together, which is exactly the pair an audit is looking for, so each place is then read completely.
 *
 * @param matches the search's matches, each with its channel id and permalink
 * @returns the places, each once, conversations before threads
 */
export function placesOfSearch({
  matches,
}: {
  matches: readonly { channelId: string; permalink: string }[];
}): readonly RepeatPlace[] {
  const channels = new Set<string>();
  const threads = new Map<string, RepeatPlace>();
  for (const match of matches) {
    if (match.channelId.length === 0) {
      continue;
    }
    channels.add(match.channelId);
    const threadTs = threadOfPermalink({ permalink: match.permalink });
    if (threadTs !== undefined) {
      threads.set(`${match.channelId} ${threadTs}`, { channel: match.channelId, threadTs });
    }
  }
  return [...[...channels].map((channel) => ({ channel })), ...threads.values()];
}

/** A numeric-string Slack `ts` field off a raw message, as epoch ms, or `undefined`. */
function tsFieldMs({ message, key }: { message: Record<string, unknown>; key: string }): number | undefined {
  const value = message[key];
  return typeof value === "string" ? slackTsToEpochMs({ ts: value }) : undefined;
}

/**
 * The thread roots in a history read whose latest reply lands inside the window — the threads a reply in the
 * window could be sitting in.
 *
 * @param rawMessages a complete history read
 * @param sinceMs the window's start
 * @param joinedBy when present, only roots whose `reply_users` names this user — the as-me read's cheap
 *   narrowing, beside the threads its search already named
 * @returns each such root's `ts`, in the order read
 */
export function threadRootsInWindow({
  rawMessages,
  sinceMs,
  joinedBy,
}: {
  rawMessages: readonly unknown[];
  sinceMs: number;
  joinedBy?: string | undefined;
}): readonly string[] {
  const roots: string[] = [];
  for (const message of rawMessages) {
    if (!isRecord(message) || typeof message["ts"] !== "string") {
      continue;
    }
    const latest = tsFieldMs({ key: "latest_reply", message });
    const users = message["reply_users"];
    const joined = joinedBy === undefined || (Array.isArray(users) && users.includes(joinedBy));
    if (latest !== undefined && latest >= sinceMs && joined) {
      roots.push(message["ts"]);
    }
  }
  return roots;
}

/** Whether anybody other than this identity replied under a raw message. */
function othersRepliedUnder({ message, self }: { message: Record<string, unknown>; self: RepeatSelf }): boolean {
  const users = message["reply_users"];
  if (!Array.isArray(users)) {
    return false;
  }
  return users.some((user) => typeof user === "string" && user !== self.userId);
}

/**
 * This identity's own messages in one read, inside the window, shaped for the audit.
 *
 * @param rawMessages a complete history or thread read
 * @param self the token's own identity
 * @param actor which identity this is
 * @param channel the conversation read
 * @param workspaceUrl the base a permalink is built on
 * @param sinceMs the window's start; an older message is dropped
 * @returns the messages, in the order read
 */
export function auditMessagesOfRaw({
  rawMessages,
  self,
  actor,
  channel,
  workspaceUrl,
  sinceMs,
}: {
  rawMessages: readonly unknown[];
  self: RepeatSelf;
  actor: RepeatActor;
  channel: string;
  workspaceUrl: string;
  sinceMs: number;
}): readonly AuditMessage[] {
  const messages: AuditMessage[] = [];
  for (const message of rawMessages) {
    if (!isRecord(message) || !isOwnMessage({ message, self })) {
      continue;
    }
    const [prior] = priorsFromRaw({ channel, rawMessages: [message], self, workspaceUrl });
    if (prior === undefined || prior.tsMs < sinceMs) {
      continue;
    }
    const files = message["files"];
    messages.push({
      ...prior,
      actor,
      fileCount: Array.isArray(files) ? files.length : 0,
      othersReplied: othersRepliedUnder({ message, self }),
    });
  }
  return messages;
}

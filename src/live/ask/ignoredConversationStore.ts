/**
 * The permanent conversation-ignore registry's effectful edge: append one entry, read the log back.
 *
 * Thin on purpose, the same shape as `./ignoreStore.ts` — every decision lives in `./ignoredConversation.ts`,
 * which is pure and testable by calling it directly. Fsync'd per line for the same reason: an ignore recorded
 * and then lost to a crash means the SAME channel gets re-considered, which defeats the whole point of a
 * permanent registry.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { appendLines } from "../../lib/appendSeparator.js";
import { stateHomePaths } from "../../stateHome.js";
import {
  foldIgnoredConversations,
  type IgnoredConversation,
  ignoredConversationLine,
  parseIgnoredConversationsLog,
} from "./ignoredConversation.js";

/**
 * The conversation-ignore registry's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `live/slack/ignored-conversations.jsonl`
 */
export function ignoredConversationsPath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).live.slack.ignoredConversationsJsonl;
}

/**
 * Append one entry to the conversation-ignore registry, creating the directory if needed, fsync'd so the
 * write survives a crash immediately rather than whatever the OS still had buffered.
 *
 * @param entry the entry to append
 * @param home the state home (defaults to the resolved home)
 */
export function appendIgnoredConversation({ entry, home }: { entry: IgnoredConversation; home?: string }): void {
  const path = ignoredConversationsPath(home === undefined ? {} : { home });
  mkdirSync(dirname(path), { recursive: true });
  appendLines({ durable: true, path, text: `${ignoredConversationLine({ entry })}\n` });
}

/**
 * Read the conversation-ignore registry's raw text. An absent log — a home that has never ignored a
 * conversation — is the empty string, not an error.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the log contents, or `""` when there is no log yet
 */
export function readIgnoredConversationsText({ home }: { home?: string } = {}): string {
  try {
    return readFileSync(ignoredConversationsPath(home === undefined ? {} : { home }), "utf8");
  } catch {
    return "";
  }
}

/**
 * The registry, read fresh off disk and folded — the ONE call every entrance makes to check "is this
 * conversation permanently ignored", so all of them agree on the same read+parse+fold rather than each
 * building its own.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the current registry, keyed by `channel`
 */
export function currentlyIgnoredConversations({ home }: { home?: string } = {}): ReadonlyMap<
  string,
  IgnoredConversation
> {
  const { entries } = parseIgnoredConversationsLog({
    text: readIgnoredConversationsText(home === undefined ? {} : { home }),
  });
  return foldIgnoredConversations({ entries });
}

/**
 * `slopweaver turn ignore-conversation` — permanently ignore (or un-ignore, or list) EVERY tag in one whole
 * conversation. The channel-keyed sibling of `slopweaver turn ignore`, which names one exact message.
 *
 * `turn ignore` has no notion of WHERE — the responder whitelist gates WHO, `turn ignore` gates one exact
 * WHICH-message, and neither answers "stop listening in this whole conversation". The owner ruling this
 * closes is exactly that: every tag inside the owner's own DM with the bot is completely
 * ignorable and belongs on the blacklist — a standing fact about the channel, not 21 individual messages
 * named one at a time. See `../../../live/ask/ignoredConversation.ts`'s own header for the registry this
 * writes to.
 *
 * Like `turn ignore`, it is NOT purely local: a fresh `--channel`/`--reason` add settles the live indicators
 * of every already-captured, unresolved ask this channel currently has — `./ignoreConversationIndicators.ts`.
 * `--remove` settles nothing, deliberately: lifting a suppression corrects no indicator, it only changes what
 * happens to the NEXT tag.
 */

import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import {
  appendIgnoredConversation,
  currentlyIgnoredConversations,
} from "../../../live/ask/ignoredConversationStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { str, TURN_IGNORE_CONVERSATION_FLAG_SPEC } from "./core.js";
import { settleIgnoredConversationIndicators } from "./ignoreConversationIndicators.js";
import { TURN_IGNORE_CONVERSATION_USAGE } from "./usage.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, ignore-conversation, …]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn ignore-conversation`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnIgnoreConversationArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: {
      boolean: [...TURN_IGNORE_CONVERSATION_FLAG_SPEC.boolean],
      string: [...TURN_IGNORE_CONVERSATION_FLAG_SPEC.string],
    },
  });
}

/** The `--list` mode: print every channel currently under a standing ignore, then exit. */
function runList({ home }: { home: string }): number {
  const entries = [...currentlyIgnoredConversations({ home }).values()].filter((entry) => entry.kind === "ignore");
  if (entries.length === 0) {
    logger.out({ line: "no conversation is permanently ignored" });
    return EXIT_OK;
  }
  for (const entry of entries) {
    logger.out({ line: `${entry.channel} — ${entry.reason} (${entry.ignoredAtIso})` });
  }
  return EXIT_OK;
}

/**
 * Run the ignore-conversation verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runTurnIgnoreConversation(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_IGNORE_CONVERSATION_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnIgnoreConversationArgs({ rest });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: TURN_IGNORE_CONVERSATION_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = resolveHome({ named: str({ key: "home", values }) });
  if (values["list"] === true) {
    return runList({ home });
  }
  const channel = str({ key: "channel", values });
  const reason = str({ key: "reason", values });
  const missing = [
    channel === undefined ? "--channel" : undefined,
    reason === undefined ? "--reason" : undefined,
  ].filter((flag): flag is string => flag !== undefined);
  if (channel === undefined || reason === undefined || missing.length > 0) {
    for (const flag of missing) {
      logger.error({ msg: `${flag} is required` });
    }
    logger.error({ msg: TURN_IGNORE_CONVERSATION_USAGE });
    return EXIT_USAGE;
  }
  const remove = values["remove"] === true;
  appendIgnoredConversation({
    entry: {
      channel,
      ignoredAtIso: new Date().toISOString(),
      kind: remove ? "unignore" : "ignore",
      reason,
      schemaVersion: 1,
    },
    home,
  });
  if (remove) {
    logger.out({ line: `no longer permanently ignoring ${channel} — ${reason}` });
    return EXIT_OK;
  }
  // The registry write comes FIRST and is what the exit code reports — same reasoning as `turn ignore`: the
  // entrance gate must hold even if every Slack call below fails.
  await settleIgnoredConversationIndicators({
    channel,
    home,
    reason,
    report: ({ failure }) => {
      logger.error({ msg: `turn ignore-conversation: ${channel} — ${failure}` });
    },
  });
  logger.out({ line: `permanently ignoring every tag in ${channel} — ${reason}` });
  return EXIT_OK;
}

export const turnIgnoreConversationCommand = defineCommand({ run: runTurnIgnoreConversation });

/**
 * `slopweaver turn ignore` — permanently ignore one exact ask, or lift that ignore with `--remove`.
 *
 * A standing "never reconsider this exact message" entrance-gate registry, distinct from a fresh
 * `no-response` routing decision — see `../../../live/ask/ignore.ts`'s own header for why. It never touches
 * the corpus and never runs a model.
 *
 * It is NOT purely local, and that was a defect rather than a design: ignoring is a terminal ending like any
 * other, so an ask the listener had already captured is left showing a capture reaction and a half-ticked
 * checklist card for a decision that nothing will ever be worked on. `./ignoreIndicators.ts` settles those
 * through the same seam every other terminal uses; an ask that was never captured raises nothing, so it
 * stays local-only exactly as before.
 */

import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { isIgnoredAsk } from "../../../live/ask/ignore.js";
import { appendIgnoredAsk, currentlyIgnoredAsks } from "../../../live/ask/ignoreStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { str, TURN_IGNORE_FLAG_SPEC } from "./core.js";
import { settleIgnoredAskIndicators } from "./ignoreIndicators.js";
import { TURN_IGNORE_USAGE } from "./usage.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, ignore, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn ignore`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnIgnoreArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...TURN_IGNORE_FLAG_SPEC.boolean], string: [...TURN_IGNORE_FLAG_SPEC.string] },
  });
}

/**
 * The `--remove` mode: reopen one exact ask by appending an `unignore` line. It settles nothing, the same as
 * `turn ignore-conversation --remove` — a lift corrects no indicator, it only changes what the next entrance
 * reads. An ask that is not currently ignored gets no line, so the log never records a lift of nothing.
 */
function liftIgnore({
  channel,
  home,
  messageTs,
  reason,
}: {
  channel: string;
  home: string;
  messageTs: string;
  reason: string;
}): number {
  if (!isIgnoredAsk({ askIdentity: { channel, messageTs }, ignored: currentlyIgnoredAsks({ home }) })) {
    logger.out({ line: `${channel}/${messageTs} is not permanently ignored — nothing to lift` });
    return EXIT_EXPECTED_EMPTY;
  }
  appendIgnoredAsk({
    entry: { channel, ignoredAtIso: new Date().toISOString(), kind: "unignore", messageTs, reason, schemaVersion: 1 },
    home,
  });
  logger.out({ line: `no longer permanently ignoring ${channel}/${messageTs} — ${reason}` });
  return EXIT_OK;
}

/**
 * Run the ignore verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runTurnIgnore(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_IGNORE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnIgnoreArgs({ rest });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: TURN_IGNORE_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const channel = str({ key: "channel", values });
  const messageTs = str({ key: "message-ts", values });
  const reason = str({ key: "reason", values });
  const missing = [
    channel === undefined ? "--channel" : undefined,
    messageTs === undefined ? "--message-ts" : undefined,
    reason === undefined ? "--reason" : undefined,
  ].filter((flag): flag is string => flag !== undefined);
  if (channel === undefined || messageTs === undefined || reason === undefined || missing.length > 0) {
    for (const flag of missing) {
      logger.error({ msg: `${flag} is required` });
    }
    logger.error({ msg: TURN_IGNORE_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: str({ key: "home", values }) });
  if (values["remove"] === true) {
    return liftIgnore({ channel, home, messageTs, reason });
  }
  appendIgnoredAsk({
    entry: { channel, ignoredAtIso: new Date().toISOString(), messageTs, reason, schemaVersion: 1 },
    home,
  });
  // The registry write comes FIRST and is what the exit code reports: the entrance gate must hold even if
  // every Slack call below fails, and an unsettled indicator is a courtesy this verb states rather than dies on.
  await settleIgnoredAskIndicators({
    channel,
    home,
    messageTs,
    reason,
    report: ({ failure }) => {
      logger.error({ msg: `turn ignore: ${channel}/${messageTs} — ${failure}` });
    },
  });
  logger.out({ line: `permanently ignoring ${channel}/${messageTs} — ${reason}` });
  return EXIT_OK;
}

export const turnIgnoreCommand = defineCommand({ run: runTurnIgnore });

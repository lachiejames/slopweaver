/**
 * `slopweaver turn blocked` — every ask standing against the owner right now.
 *
 * One read, two audiences. The fleet briefing's sweep reads it to card each `waiting` row on react-now,
 * one of the places the owner looks most — and a visible session reads it to find the `ready-to-resume` rows
 * it owes a re-dispatch.
 *
 * **Explicitly NOT the bot DM.** The bot DM holds so much that the owner never reads it. So nothing here
 * posts anywhere; it prints, and the briefing is what carries a block to the owner. `../../../briefing/blockedAsks.ts` is the gate
 * that refuses a briefing page which read this and then failed to card what it found.
 *
 * Diagnostic and read-only: no door, no write, no clock beyond reading the log's own instants.
 */

import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { foldAskLifecycle, parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../live/ask/store.js";
import { type BlockedAsk, blockedAsks, slackPermalinkToken } from "../../../live/turn/blockedOnHuman.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { TURN_BLOCKED_USAGE } from "./blockUsage.js";
import { cardEditHome, refuseWith } from "./cardGates.js";
import { TURN_BLOCKED_FLAG_SPEC } from "./core.js";
import { resumeCommandFor } from "./unblock.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, blocked, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network.
 *
 * @param rest the argv tail after `turn blocked`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnBlockedArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...TURN_BLOCKED_FLAG_SPEC.boolean], string: [...TURN_BLOCKED_FLAG_SPEC.string] },
  });
}

/**
 * One row as the `--json` object a briefing sweep and a resuming session both read. Pure.
 *
 * `permalinkToken` rather than a whole permalink: the workspace domain is a private identifier this
 * repository never carries, and the token is the half a real link is checkable by — see
 * `../../../live/turn/blockedOnHuman.ts`.
 *
 * @param row the folded row
 * @returns the JSON-ready object
 */
export function blockedRowJson({ row }: { row: BlockedAsk }): Record<string, string> {
  return {
    blockedIso: row.blocked.tsIso,
    channel: row.channel,
    messageTs: row.messageTs,
    need: row.blocked.need,
    permalinkToken: slackPermalinkToken({ messageTs: row.messageTs }),
    resumeCommand: resumeCommandFor({ ask: row }),
    standing: row.standing,
    threadTs: row.threadTs,
    what: row.blocked.what,
    ...(row.blocked.signInOrigin === undefined ? {} : { signInOrigin: row.blocked.signInOrigin }),
    ...(row.clearedNote === undefined ? {} : { clearedNote: row.clearedNote }),
  };
}

/**
 * One row as a line a person reads. Pure.
 *
 * It states WHEN the block was entered and never how long ago, because an elapsed figure is the beginning of
 * a deadline, and deadlines are out of this feature entirely. A reader who wants the wait can subtract.
 *
 * @param row the folded row
 * @returns the line, with no trailing newline
 */
export function blockedRowLine({ row }: { row: BlockedAsk }): string {
  const mark = row.standing === "waiting" ? "waiting on the owner" : "the owner did it — owed a resume";
  return `${row.channel}/${row.messageTs}  ${mark}  [${row.blocked.need}, since ${row.blocked.tsIso}]  ${row.blocked.what}`;
}

/**
 * Run the blocked verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export function runTurnBlocked(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_BLOCKED_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnBlockedArgs({ rest });
  if (parsed.isErr()) {
    return refuseWith({ code: EXIT_USAGE, errors: parsed.error, usage: TURN_BLOCKED_USAGE });
  }
  const home = cardEditHome({ values: parsed.value.values });
  const { events } = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) });
  const rows = blockedAsks({ folded: foldAskLifecycle({ events }) });
  if (parsed.value.values["json"] === true) {
    logger.out({
      line: JSON.stringify(
        rows.map((row) => blockedRowJson({ row })),
        null,
        2,
      ),
    });
    return rows.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  }
  if (rows.length === 0) {
    logger.out({ line: "nothing is waiting on the owner." });
    return EXIT_EXPECTED_EMPTY;
  }
  for (const row of rows) {
    logger.out({ line: blockedRowLine({ row }) });
  }
  const waiting = rows.filter((row) => row.standing === "waiting").length;
  logger.out({
    line: `${String(waiting)} waiting on the owner, ${String(rows.length - waiting)} owed a resume. Every waiting row belongs on react-now this tick.`,
  });
  return EXIT_OK;
}

export const turnBlockedCommand = defineCommand({ run: runTurnBlocked });

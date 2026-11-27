/**
 * `slopweaver talk recent` — where the last console-voice call left off: the owner's recent steers with what became of
 * each, the owner's turns typed straight into the supervisor chat, the calls themselves as they were written down (a dropped
 * one included), and the rulings and lessons recorded since, newest first. The voice's `recent_steers` tool runs it, and
 * `talk offer` reads the same thing fresh at mint (`src/talk/continuityRead.ts`); what it carries and why is
 * `src/talk/continuity.ts`.
 */
import { logger } from "../../../lib/logger.js";
import { readContinuity } from "../../../talk/continuityRead.js";
import { steerState } from "../../../talk/continuityRender.js";
import { CONTINUITY_MAX_BYTES, continuityForTool } from "../../../talk/continuityTool.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { talkHomeOf } from "./args.js";
import { TALK_RECENT_USAGE } from "./knowUsage.js";
import { parseRecentArgs } from "./recentArgs.js";
import { supervisorForContinuity } from "./supervisorRun.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "recent", ...]`. */
const VERB_ARG_OFFSET = 4;

/** Milliseconds in an hour, for the day-denominated window. */
const HOUR_MS = 60 * 60 * 1000;

/**
 * Run the `talk recent` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkRecent(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_RECENT_USAGE });
    return EXIT_OK;
  }
  const parsed = parseRecentArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_RECENT_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = talkHomeOf({ home: args.home });
  let nowIso = new Date().toISOString();
  if (args.now !== undefined) {
    nowIso = new Date(args.now).toISOString();
  }
  const continuity = await readContinuity({
    handoverDir: resolveHandoverDir({ dir: args.dir, home }),
    home,
    knowledge: "read",
    lookbackMs: args.hours * HOUR_MS,
    nowIso,
    supervisor: supervisorForContinuity({ home }),
  });
  const bounded = continuityForTool({ continuity, maxBytes: CONTINUITY_MAX_BYTES });
  if (args.json) {
    logger.out({ line: JSON.stringify(bounded) });
    return EXIT_OK;
  }
  logger.out({
    line: `talk recent: ${String(bounded.steers.length)} steer(s), ${String(bounded.typed.length)} typed turn(s), ${String(bounded.calls.length)} call(s), ${String(bounded.rulings.length)} ruling(s), ${String(bounded.knowledge.length)} lesson(s) since ${bounded.sinceIso}`,
  });
  bounded.unread.forEach((entry) => {
    logger.out({ line: `  not read — ${entry.section}: ${entry.why}` });
  });
  bounded.steers.forEach((steer) => {
    logger.out({ line: `  ${steer.atIso}  ${steer.slug}` });
    logger.out({ line: `    ${steer.words === "" ? steer.heard : steer.words}` });
    logger.out({ line: `    became: ${steerState({ steer })}` });
  });
  bounded.typed.forEach((typed) => {
    logger.out({ line: `  ${typed.atIso}  typed to the supervisor` });
    logger.out({ line: `    ${typed.text}` });
  });
  bounded.calls.forEach((call) => {
    logger.out({ line: `  ${call.openedIso}  call ${call.callId} — ${call.end}` });
    call.lines.forEach((line) => {
      const cut = line.final ? "" : " (cut off)";
      logger.out({ line: `    ${line.who} ${line.text}${cut}` });
    });
  });
  return EXIT_OK;
}

export const talkRecentCommand = defineCommand({ run: runTalkRecent });

/**
 * `slopweaver talk cut-ins` — every time what reads as the console's own progress line cut into an answer the voice
 * was already giving (`src/talk/scriptedCutIns.ts`), oldest first, each anchored to its call turn and the Codex turn
 * whose progress line it most likely was.
 *
 * The Alignment page reads `--json` to draw them per week, so the owner can watch the count go to nothing; the voice runs it
 * through its `verb` tool (`src/talk/modelReads.ts`) to tell you, when asked, whether what you just heard was ours.
 * Zero is the reading wanted, not an empty one, so it exits 0 either way.
 */
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { readCalls } from "../../../talk/callStore.js";
import { scriptedCutIns } from "../../../talk/scriptedCutIns.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { wordsWindow } from "../profile/wordsArgs.js";
import { talkHomeOf } from "./args.js";
import { type CutInsArgs, parseCutInsArgs } from "./callArgs.js";
import { TALK_CUT_INS_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "cut-ins", ...]`. */
const VERB_ARG_OFFSET = 4;

/** The window when none is named: the sixty days the Alignment page's Slack-steers chart draws beside it. */
const DEFAULT_SINCE = "60d";

/**
 * The verb's body with its inputs injected — what the unit test drives, since `logger.out` cannot be read back.
 *
 * @param args the parsed flags
 * @param home the Slopweaver home
 * @param nowIso the instant read at, which a span counts back from
 * @param out where each line goes
 * @returns 0 with or without a cut-in, 2 on a window that holds nothing, 1 when the call directory will not list
 */
export function talkCutIns({
  args,
  home,
  nowIso,
  out,
}: {
  args: CutInsArgs;
  home: string;
  nowIso: string;
  out: (line: string) => void;
}): number {
  let since = DEFAULT_SINCE;
  if (args.since !== undefined) {
    since = args.since;
  }
  const window = wordsWindow({ nowIso, since, until: undefined });
  if (window.isErr()) {
    window.error.forEach((problem) => {
      out(`talk cut-ins: ${problem}`);
    });
    return EXIT_USAGE;
  }
  const { sinceIso } = window.value;
  const read = readCalls({ home, keep: { sinceIso } });
  if (read.isErr()) {
    out(`talk cut-ins: ${read.error.message}`);
    return EXIT_ERROR;
  }
  const { calls, unreadable } = read.value;
  const cutIns = scriptedCutIns({ calls, sinceIso });
  // The rate's denominator: a typed conversation speaks no progress line, so it cannot hold a cut-in.
  const voiceCalls = calls.filter((call) => call.surface === "voice").length;
  // A line that did not read may be the segment a cut-in is in, so a short read is named, never drawn as a zero.
  const torn = calls
    .filter((call) => call.skipped > 0)
    .map((call) => `${call.callId}: ${String(call.skipped)} line(s) did not parse, so a cut-in in one is not counted`);
  const gaps = [...unreadable, ...torn];
  if (args.json) {
    out(
      safeJsonStringify({
        label: "talk cut-ins",
        value: { calls: voiceCalls, cutIns, gaps, observedAtIso: nowIso, ok: true, sinceIso },
      }),
    );
    return EXIT_OK;
  }
  out(
    `talk cut-ins: ${String(cutIns.length)} answer(s) cut into by what reads as the console's own progress line, across ` +
      `${String(voiceCalls)} voice call(s) since ${sinceIso}`,
  );
  cutIns.forEach((cut) => {
    out(`  ${cut.atIso}  ${cut.anchor}  most likely from Codex turn ${cut.likelyTurnId}`);
    out(`    …${cut.before.slice(-100)} ⟶ ${cut.line}`);
  });
  gaps.forEach((why) => {
    out(`  not read whole — ${why}`);
  });
  return EXIT_OK;
}

/**
 * Run the `talk cut-ins` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkCutIns(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_CUT_INS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCutInsArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_CUT_INS_USAGE });
    return EXIT_USAGE;
  }
  return talkCutIns({
    args: parsed.value,
    home: talkHomeOf({ home: parsed.value.home }),
    nowIso: new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
  });
}

export const talkCutInsCommand = defineCommand({ run: runTalkCutIns });

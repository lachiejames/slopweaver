/**
 * `slopweaver session fallbacks` — which live seats a safeguard fallback moved off the model they were seated
 * with, of any tier.
 *
 * The effectful edge only. The judgement is `../../../sessions/modelFallback.ts` and the fold and rendering
 * are `../../../sessions/seatFallbackReport.ts`; both are pure and both carry why this is a verb the operator
 * types rather than a column on `session depth`.
 *
 * It streams each transcript WHOLE with `readJsonlLines` rather than reading a tail, because the fallback
 * record it looks for sits wherever the trip happened — line 32 of 3,691 in the measured case. That is the
 * cost, it is stated in the headline as sessions SCANNED, and nothing else in the fleet pays it.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { readJsonlLines } from "../../../corpus/corpusStore.js";
import { logger } from "../../../lib/logger.js";
import { listLiveCmuxWorkspaces } from "../../../sessionHarness/cmuxHost.js";
import { scanSessions, transcriptPathFor } from "../../../sessions/liveSessionStore.js";
import {
  EMPTY_SEAT_FALLBACK_FOLD,
  foldSeatFallbackLine,
  type SeatFallbackFold,
  type SeatFallbackVerdict,
  seatFallbackVerdict,
} from "../../../sessions/modelFallback.js";
import {
  renderSeatFallbackReport,
  type SeatFallbackReading,
  seatFallbackReport,
} from "../../../sessions/seatFallbackReport.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseSessionArgs, sessionUsage, VERB_ARG_OFFSET } from "./core.js";

/**
 * Judge one transcript by streaming the whole file.
 *
 * Folded line by line rather than collected into an array: a 41.9 MB transcript is hundreds of thousands of
 * lines, and `sessions/modelFallback.ts` only ever needs the one in front of it.
 *
 * @param path the transcript to read
 * @returns the verdict, or the reason it could not be read
 */
export function judgeTranscriptFile({
  path,
}: {
  path: string;
}): { readonly verdict: SeatFallbackVerdict } | { readonly unreadable: string } {
  let fold: SeatFallbackFold = EMPTY_SEAT_FALLBACK_FOLD;
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        fold = foldSeatFallbackLine({ fold, line });
      },
      path,
    });
  } catch (error: unknown) {
    return { unreadable: `its transcript could not be read (${String(error)})` };
  }
  return { verdict: seatFallbackVerdict({ fold }) };
}

/** Every cmux workspace's title by its working directory, or an empty map when cmux could not be reached. */
async function titlesByCwd(): Promise<ReadonlyMap<string, string>> {
  const listed = await listLiveCmuxWorkspaces();
  if (listed.isErr()) {
    logger.error({
      msg: `session fallbacks: the cmux inventory could not be read (${listed.error.message}) — reporting seats without workspace titles`,
    });
    return new Map<string, string>();
  }
  const pairs = new Map<string, string>();
  for (const workspace of listed.value) {
    if (workspace.title !== undefined) {
      pairs.set(workspace.currentDirectory, workspace.title);
    }
  }
  return pairs;
}

/**
 * Read every live session's transcript and judge it.
 *
 * @param claudeHome the resolved `~/.claude`
 * @param titles each workspace title by its working directory
 * @returns one reading per live session
 */
export function readSeatFallbacks({
  claudeHome,
  titles,
}: {
  claudeHome: string;
  titles: ReadonlyMap<string, string>;
}): readonly SeatFallbackReading[] {
  const scan = scanSessions({ sessionsDir: join(claudeHome, "sessions") });
  return scan.records.map((record): SeatFallbackReading => {
    const base = {
      cwd: record.cwd,
      pid: record.pid,
      sessionId: record.sessionId,
      title: titles.get(record.cwd),
    };
    const path = transcriptPathFor({ projectsDir: join(claudeHome, "projects"), sessionId: record.sessionId });
    if (path === undefined) {
      return { ...base, unreadable: "no transcript was found for this session", verdict: undefined };
    }
    const judged = judgeTranscriptFile({ path });
    if ("unreadable" in judged) {
      return { ...base, unreadable: judged.unreadable, verdict: undefined };
    }
    return { ...base, unreadable: undefined, verdict: judged.verdict };
  });
}

/**
 * Run `session fallbacks`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runSessionFallbacks(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: sessionUsage({ verb: "fallbacks" }) });
    return EXIT_OK;
  }
  const parsed = parseSessionArgs({ rest, verb: "fallbacks" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: sessionUsage({ verb: "fallbacks" }) });
    return EXIT_USAGE;
  }
  const readings = readSeatFallbacks({ claudeHome: join(homedir(), ".claude"), titles: await titlesByCwd() });
  const report = seatFallbackReport({ readings });
  if (parsed.value.values["json"] === true) {
    logger.out({ line: JSON.stringify(report) });
    return EXIT_OK;
  }
  renderSeatFallbackReport({ report }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

export const sessionFallbacksCommand = defineCommand({ run: runSessionFallbacks });

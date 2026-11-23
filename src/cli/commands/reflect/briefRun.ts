/**
 * `slopweaver reflect brief [--from 24h] [--to now] [--cap 5] [--json] [--write] [--dry-run]` — the
 * loop's miner: read the bounded local substrates, rank what they say, cap it at five, and hand the result
 * to the visible session that will reason about it.
 *
 * The thin shell. Every decision is in `src/reflect/`; this resolves the window once against a single
 * `now`, builds the real filesystem reader, folds the seen ledger, prints, and appends.
 *
 * ## Why it writes two ledgers and nothing else
 *
 * The owner set the autonomy ceiling at T0 — REPORT — for the first run: the owner wants to see what it even
 * finds before it writes anything. So this verb creates no board doc, opens no pull request and sends no
 * message. The only things it appends are the loop's own memory: a sighting per candidate, so a terminal
 * `drop` sticks and the recurrence counter advances, and one heartbeat row, so a quiet day is
 * distinguishable from a day the loop did not run.
 *
 * `--dry-run` suppresses both, and exists so the miner can be developed against the real substrates without
 * moving the counters that measure it.
 *
 * ## The exit-code contract
 *
 * | situation | code | why |
 * | --- | --- | --- |
 * | a bad flag | `2` | refused before anything is read |
 * | the window is not a window | `2` | same |
 * | a run that surfaced nothing | `0` | a quiet pass is a good pass, and it still says what it could not verify |
 * | a run that surfaced something | `0` | the ordinary case |
 * | a ledger append failed | `1` | the run happened and its memory did not, which is a genuine fault |
 * | `--write` could not write the report | `1` | same class: the run happened and its output did not |
 * | `--write` with `--dry-run` | `2` | two ends of one axis, refused before anything is read |
 *
 * ## `--write` is the standing recipe row's whole reason to exist
 *
 * The `self-improvement` row writes `$home/morning/self-improvement-<today>.md`, and
 * `../../../reflect/frictionReviewGap.ts` dates that report from its FILENAME to decide whether the
 * producer is alive. So the writer and the gauge must agree on what "today" is, and they do so by calling
 * ONE function: both take it from `yyyyMmDdTodayPlus`, which is UTC. A writer on local time would name a
 * report for tomorrow whenever it ran late in the evening, and the gauge would then compute a negative age
 * for a report that had just been written.
 *
 * The write is ATOMIC for a reason this repository has already paid for once. A killed run leaving a
 * half-written file gives the gauge a filename dated today over truncated content, so a broken report reads
 * as a healthy producer — which is exactly the class the gauge was just fixed to catch, re-entering through
 * the writer. It overwrites an existing day rather than refusing, because the report is a function of its
 * window and a re-run after a crash must not need a flag.
 */
import { join } from "node:path";

import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { datadogDomainErrorLines } from "../../../datadog/domainErrors.js";
import { resolveWindow } from "../../../datadog/window.js";
import { slopweaverHome } from "../../../homeDir.js";
import { ownerDirectivePort } from "../../../judgement/ownerDirectivePort.js";
import { yyyyMmDdTodayPlus } from "../../../lib/date.js";
import { logger } from "../../../lib/logger.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import type { ReflectOwnerJudgement } from "../../../reflect/askedForMissingHeuristics.js";
import {
  composeBrief,
  mineSubstrates,
  type ReflectBrief,
  readCoverage,
  reflectPaths,
  renderBriefLines,
} from "../../../reflect/brief.js";
import { briefReportFilename, renderBriefMarkdown } from "../../../reflect/briefMarkdown.js";
import { heartbeatFor, recordHeartbeat } from "../../../reflect/heartbeat.js";
import { PER_SOURCE_CAP } from "../../../reflect/rank.js";
import { foldSeenLedger, parseSeenRows, readSeenText, recordSeen } from "../../../reflect/seen.js";
import { createFsReader } from "../../../reflect/substrate.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseReflectBriefOptions } from "./briefCore.js";
import { REFLECT_BRIEF_USAGE } from "./usage.js";

/**
 * Resolve the window once against a single `now`, printing every rejection.
 *
 * @param from the window start token
 * @param nowMs the one instant both ends resolve against
 * @param to the window end token
 * @returns the ISO bounds, or `undefined` once the caller's rejections have been printed
 */
function resolveBounds({
  from,
  nowMs,
  to,
}: {
  from: string;
  nowMs: number;
  to: string;
}): { readonly fromIso: string; readonly toIso: string } | undefined {
  const window = resolveWindow({ from, nowMs, to });
  if (window.isErr()) {
    datadogDomainErrorLines({ error: window.error }).forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: REFLECT_BRIEF_USAGE });
    return undefined;
  }
  return {
    fromIso: new Date(window.value.fromMs).toISOString(),
    toIso: new Date(window.value.toMs).toISOString(),
  };
}

/**
 * Append the run's own memory: a sighting per candidate, and one heartbeat row.
 *
 * Both failures are loud, because a run whose memory did not land will re-propose a dropped finding
 * tomorrow and will look, in the heartbeat, like a day the loop never ran.
 *
 * @param brief the composed brief
 * @returns the process exit code
 */
function recordRun({ brief }: { brief: ReflectBrief }): number {
  const seen = recordSeen({ rows: brief.seenRows });
  if (seen.isErr()) {
    seen.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }
  const heartbeat = recordHeartbeat({ row: heartbeatFor({ brief }) });
  if (heartbeat.isErr()) {
    heartbeat.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/**
 * Persist the day's report where `reflect friction-review` looks for it.
 *
 * @param brief the composed brief the report is a projection of
 * @param nowMs the one instant the run resolved its window against, so the report's day and the gauge's
 *   today come from the same clock reading
 * @returns the process exit code
 */
function writeReport({ brief, nowMs }: { brief: ReflectBrief; nowMs: number }): number {
  const date = yyyyMmDdTodayPlus({ now: new Date(nowMs), days: 0 });
  const path = join(stateHomePaths().morning, briefReportFilename({ date }));
  try {
    writeFileAtomic({ contents: `${renderBriefMarkdown({ brief, date }).join("\n")}\n`, path });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "unknown failure";
    logger.error({ msg: `reflect brief: could not write ${path} — ${detail}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `  wrote ${path}` });
  return EXIT_OK;
}

/**
 * Read the owner's active directives from the store for the asked-for-missing collector. An unreadable store is
 * that collector's residue, printed under COULD NOT VERIFY, never an empty list.
 *
 * @returns the directives, or why they could not be read
 */
async function ownerJudgementForReflect(): Promise<ReflectOwnerJudgement> {
  const read = await ownerDirectivePort().readActive({ home: slopweaverHome() });
  if (read.isErr()) {
    return { kind: "unavailable", why: read.error.message };
  }
  return { directives: read.value.directives, kind: "loaded" };
}

/** Print the composed brief: the document under `--json`, else the rendered lines. */
function printBrief({ brief, json }: { brief: ReflectBrief; json: boolean }): void {
  if (json) {
    logger.out({ line: JSON.stringify(brief, null, 2) });
    return;
  }
  renderBriefLines({ brief }).forEach((line) => {
    logger.out({ line });
  });
}

/**
 * Run the `reflect brief` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runReflectBrief(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["brief"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: REFLECT_BRIEF_USAGE });
    return EXIT_OK;
  }
  const parsed = parseReflectBriefOptions({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: REFLECT_BRIEF_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;

  const nowMs = Date.now();
  const bounds = resolveBounds({ from: options.from, nowMs, to: options.to });
  if (bounds === undefined) {
    return EXIT_USAGE;
  }

  const reader = createFsReader();
  const paths = reflectPaths({ reader });
  const ownerJudgement = await ownerJudgementForReflect();
  const doorFriction = await doorLedgerPort().readDoorFriction({
    fromIso: bounds.fromIso,
    home: slopweaverHome(),
    toIso: bounds.toIso,
  });
  const readings = mineSubstrates({ doorFriction, ownerJudgement, paths, reader, window: bounds });
  const states = foldSeenLedger({ rows: parseSeenRows({ text: readSeenText() }) });
  const brief = composeBrief({
    cap: options.cap,
    coverage: readCoverage({ paths, reader }),
    perSourceCap: PER_SOURCE_CAP,
    readings,
    states,
    tsIso: new Date(nowMs).toISOString(),
    window: bounds,
  });

  printBrief({ brief, json: options.json });

  if (options.dryRun) {
    logger.out({ line: "  (--dry-run: nothing appended to the seen ledger or the heartbeat)" });
    return EXIT_OK;
  }
  if (options.write) {
    const wrote = writeReport({ brief, nowMs });
    if (wrote !== EXIT_OK) {
      return wrote;
    }
  }
  return recordRun({ brief });
}

export const reflectBriefCommand = defineCommand({ run: runReflectBrief });

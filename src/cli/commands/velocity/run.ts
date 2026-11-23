/**
 * `slopweaver velocity [--repo <dir>] [--ref <ref>] [--days N] [--json]` — the machine's own trailing-window
 * pace, read from git and the local ledgers rather than guessed from a handover doc's estimate. Built for
 * the owner's own caution: an LLM sizing a batch of docs by eye overestimates duration by an
 * order of magnitude, so the supervisor sweep needs a number it can check a doc's own estimate against
 * instead of trusting it.
 *
 * Four measurements, each with its own reproduction command in the printed output
 * (`../../../velocity/report.js`):
 *  - PRs merged per day, the exact method the fill-to-cap capacity measurement used
 *    (`skills/supervisor/reference/fleet-capacity.md`).
 *  - Docs moved ready→done per day, from every run journal's clean `finished` events.
 *  - Median doc open→landed latency, from each landing's own `started`→`finished` span.
 *  - Turns per ask, from the ask-lifecycle log's `dispatched` counts before a terminal reply.
 *
 * Diagnostic-shaped like `doctor`/`audit`: read-only, no network, no model call — pure local aggregation
 * over git and `$SLOPWEAVER_HOME`.
 */
import { basename } from "node:path";

import { slugsWithJournals } from "../../../handover/hookJournalScan.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { repoRootFromDirectory } from "../../../lib/gitRepo.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { askLifecyclePath, readAskLifecycleText } from "../../../live/ask/store.js";
import { stateHomePaths } from "../../../stateHome.js";
import { askTurns, askTurnsInSpan } from "../../../velocity/askVelocity.js";
import { docLandings, landingsByDay, landingsInSpan, type RunJournal } from "../../../velocity/docVelocity.js";
import { mergesPerDay, resolveVelocityRef } from "../../../velocity/gitEdge.js";
import {
  composeVelocityReport,
  renderVelocityLines,
  type VelocityReport,
  velocityJson,
} from "../../../velocity/report.js";
import { spanOf, trailingDayWindows } from "../../../velocity/windows.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, parsePositiveInteger, resolveHome, verbTail } from "../../optionParsers.js";

const USAGE = "usage: slopweaver velocity [--repo <dir>] [--ref <ref>] [--days N] [--json] [--home <dir>]";

/**
 * The flag tail's shape — exported so `--help`'s advertised flags and the parser can never drift apart
 * (`.claude/rules/typescript-patterns.md`'s `help-flag-opt-out` gate).
 */
export const VELOCITY_FLAG_SPEC = {
  boolean: ["json"],
  value: ["repo", "ref", "days", "home"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** The parsed, validated options a bare invocation resolves to. */
export interface VelocityOptions {
  readonly windowDays: number;
  readonly home: string;
  readonly repoArg: string | undefined;
  readonly ref: string | undefined;
  readonly json: boolean;
}

/**
 * Parse and validate the flag tail. No I/O — a repo/git resolution failure is the caller's job to report.
 *
 * @param rest the flag tail (after the noun/verb tokens)
 * @returns the validated options, or every rejection
 */
export function parseVelocityOptions({ rest }: { rest: readonly string[] }): Result<VelocityOptions> {
  const parsed = parseFlagTail({ rest, spec: VELOCITY_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const windowDays =
    values["days"] === undefined ? 7 : parsePositiveInteger({ errors, label: "--days", value: values["days"] });
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({
    home: resolveHome({ named: values["home"] }),
    json: flags.has("json"),
    ref: values["ref"],
    repoArg: values["repo"],
    // `parsePositiveInteger` answers undefined only after pushing an error, and errors returned above.
    windowDays: windowDays!,
  });
}

/** Every doc's slug and its journal events, for whichever `runsDir` this run resolved. */
function readAllJournals({ runsDir }: { runsDir: string }): readonly RunJournal[] {
  const journals: RunJournal[] = [];
  for (const slug of slugsWithJournals({ runsDir })) {
    const read = readRunJournal({ runsDir, slug });
    if (read.isOk()) {
      journals.push({ events: read.value.events, slug });
    }
  }
  return journals;
}

/**
 * Gather every measurement and compose the report — the verb's whole act phase, once a repository has been
 * resolved.
 *
 * @param repoPath the resolved repository root
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @param windowDays how many trailing days to measure
 * @param ref an explicit base ref, when the caller supplied one
 * @returns the composed report, or `undefined` when `windowDays` produced no window at all
 */
function buildVelocityReport({
  repoPath,
  home,
  windowDays,
  ref: explicitRef,
}: {
  repoPath: string;
  home: string;
  windowDays: number;
  ref: string | undefined;
}): VelocityReport | undefined {
  const ref = resolveVelocityRef({ cwd: repoPath, ...(explicitRef !== undefined ? { ref: explicitRef } : {}) });
  const windows = trailingDayWindows({ days: windowDays, nowIso: new Date().toISOString() });
  const span = spanOf({ windows });
  if (span === undefined) {
    return undefined;
  }

  const mergesByDay = mergesPerDay({ cwd: repoPath, ref, windows });

  const runsDir = stateHomePaths({ home }).runs;
  const landings = docLandings({ journals: readAllJournals({ runsDir }) });
  const docsLandedByDay = landingsByDay({ landings, windows });
  const docLatenciesHours = landingsInSpan({ landings, sinceIso: span.sinceIso, untilIso: span.untilIso })
    .map((landing) => landing.latencyHours)
    .filter((hours): hours is number => hours !== undefined);

  const asksPath = askLifecyclePath({ home });
  const { events: askEvents } = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) });
  const turnsPerAsk = askTurnsInSpan({
    sinceIso: span.sinceIso,
    turns: askTurns({ events: askEvents }),
    untilIso: span.untilIso,
  }).map((turn) => turn.turns);

  return composeVelocityReport({
    asksPath,
    docLatenciesHours,
    docsLandedByDay,
    mergesByDay,
    ref,
    repoLabel: basename(repoPath),
    repoPath,
    runsDir,
    sinceIso: span.sinceIso,
    turnsPerAsk,
    untilIso: span.untilIso,
    windowDays,
  });
}

/** The directory whose repository is measured: `--repo` when given, else where the verb was run from. */
function measuredDirectory({ options }: { options: VelocityOptions }): string {
  if (options.repoArg === undefined) {
    return process.cwd();
  }
  return options.repoArg;
}

/**
 * Run the velocity verb.
 *
 * @param argv the full process argv (verb tail starts at index 3, or 4 for the `run` spelling)
 * @returns the process exit code
 */
export function runVelocity(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["run"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const parsed = parseVelocityOptions({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      logger.error({ msg: e });
    });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const measured = measuredDirectory({ options });

  let repoPath: string;
  try {
    repoPath = repoRootFromDirectory({ dir: measured });
  } catch (error: unknown) {
    logger.error({
      msg: `velocity: ${measured} is not inside a git repository (${error instanceof Error ? error.message : String(error)})`,
    });
    return EXIT_ERROR;
  }

  const report = buildVelocityReport({
    home: options.home,
    ref: options.ref,
    repoPath,
    windowDays: options.windowDays,
  });
  if (report === undefined) {
    logger.error({ msg: "velocity: --days produced no window to measure" });
    return EXIT_ERROR;
  }

  if (options.json) {
    logger.out({ line: JSON.stringify(velocityJson({ report }), null, 2) });
    return EXIT_OK;
  }
  for (const line of renderVelocityLines({ report })) {
    logger.info({ msg: line });
  }
  return EXIT_OK;
}

export const velocityRunCommand = defineCommand({ run: runVelocity });

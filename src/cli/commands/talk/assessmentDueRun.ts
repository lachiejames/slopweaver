/**
 * `slopweaver talk assessment-due` — the calls whose current words no visible session has classified yet, each with
 * the owner's passages exactly as the call file keeps them, for the daily call reader to classify. Nothing written.
 *
 * The worklist is `src/talk/callAssessmentRead.ts`'s. Two modes:
 *
 * - **read** (default) — every due call, its request digest, and each passage's segment id and verbatim text; then one
 *   line per call held back (live, incomplete, foreign) and the counts of the rest. The visible session classifies from this.
 * - **`--check`** — counts only, never a passage: this is the line `automation run-due` runs after the seat, and a
 *   scheduler's output is no place for the owner's words. Anything due exits {@link EXIT_DEFERRED}, so the firing is
 *   not stamped and the next pass seats the reader again; nothing due exits {@link EXIT_OK}.
 */
import type { Result } from "#lib/result.js";

import { logger } from "../../../lib/logger.js";
import {
  type CallAssessmentReadFailedError,
  type CallAssessmentWorklist,
  readCallAssessmentWorklist,
} from "../../../talk/callAssessmentRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseAssessmentDueArgs } from "./assessmentArgs.js";
import { TALK_ASSESSMENT_DUE_USAGE } from "./assessmentUsage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "assessment-due", ...]`. */
const VERB_ARG_OFFSET = 4;

/** The seams the verb performs its effects through. */
interface AssessmentDueDeps {
  /** The worklist under a home, judged at an instant. */
  readonly read: (input: {
    home: string | undefined;
    nowMs: number;
  }) => Result<CallAssessmentWorklist, CallAssessmentReadFailedError>;
  readonly nowMs: () => number;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `talk assessment-due` against injected edges.
 *
 * @param rest argv after `talk assessment-due`
 * @param deps the read and output seams
 * @returns the process exit code
 * @internal — exported so a test drives the verb over plain seams.
 */
export function runAssessmentDue({ rest, deps }: { rest: readonly string[]; deps: AssessmentDueDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(TALK_ASSESSMENT_DUE_USAGE);
    return EXIT_OK;
  }
  const parsed = parseAssessmentDueArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of [parsed.error.message, TALK_ASSESSMENT_DUE_USAGE]) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const { check, home, json } = parsed.value;
  const nowMs = instantNow({ deps, given: parsed.value.nowMs });
  const read = deps.read({ home, nowMs });
  if (read.isErr()) {
    deps.writeDiagnostic(`talk assessment-due: ${read.error.message}`);
    return EXIT_ERROR;
  }
  const worklist = read.value;
  if (check) {
    printCounts({ deps, json, worklist });
    if (worklist.due.length > 0) {
      return EXIT_DEFERRED;
    }
    return EXIT_OK;
  }
  printWorklist({ deps, json, worklist });
  return EXIT_OK;
}

/**
 * The instant to judge at: `--now` when given, else the clock read at this call.
 *
 * @param given the `--now` instant in ms, when passed
 * @returns ms since epoch
 */
function instantNow({ deps, given }: { deps: AssessmentDueDeps; given: number | undefined }): number {
  if (given !== undefined) {
    return given;
  }
  return deps.nowMs();
}

/**
 * The worklist's counts, never a passage: what `--check` prints.
 *
 * @returns the counts by standing
 */
function worklistCounts({ worklist }: { worklist: CallAssessmentWorklist }): {
  readonly due: number;
  readonly assessed: number;
  readonly live: number;
  readonly incomplete: number;
  readonly foreign: number;
  readonly silent: number;
  readonly testInstance: number;
} {
  return {
    assessed: worklist.assessed.length,
    due: worklist.due.length,
    foreign: worklist.foreign.length,
    incomplete: worklist.incomplete.length,
    live: worklist.live.length,
    silent: worklist.silent,
    testInstance: worklist.testInstance,
  };
}

/**
 * Print the counts: one JSON document, or one line.
 *
 * @param worklist the worklist read
 * @param json whether `--json` was passed
 */
function printCounts({
  deps,
  json,
  worklist,
}: {
  deps: AssessmentDueDeps;
  json: boolean;
  worklist: CallAssessmentWorklist;
}): void {
  const counts = worklistCounts({ worklist });
  if (json) {
    deps.writeOut(JSON.stringify(counts));
    return;
  }
  deps.writeOut(
    `${String(counts.due)} call(s) due for a verdict · ${String(counts.assessed)} assessed · ${String(counts.live)} live · ` +
      `${String(counts.incomplete)} incomplete · ${String(counts.foreign)} from a console not the owner's · ` +
      `${String(counts.silent)} with nothing the owner said · ` +
      `${String(counts.testInstance)} test instance`,
  );
}

/**
 * Print the whole worklist: one JSON document, or each due call with its passages verbatim, then what is held back.
 *
 * @param worklist the worklist read
 * @param json whether `--json` was passed
 */
function printWorklist({
  deps,
  json,
  worklist,
}: {
  deps: AssessmentDueDeps;
  json: boolean;
  worklist: CallAssessmentWorklist;
}): void {
  if (json) {
    deps.writeOut(
      JSON.stringify({
        counts: worklistCounts({ worklist }),
        due: worklist.due,
        foreign: worklist.foreign,
        incomplete: worklist.incomplete,
        live: worklist.live,
      }),
    );
    return;
  }
  for (const request of worklist.due) {
    deps.writeOut(`call ${request.callId}  request ${request.requestSha256}`);
    for (const passage of request.passages) {
      deps.writeOut(`  [${passage.segmentId}] ${passage.text}`);
    }
  }
  for (const held of worklist.live) {
    deps.writeOut(`held  ${held.callId}  ${held.why}`);
  }
  for (const held of worklist.incomplete) {
    deps.writeOut(`incomplete  ${held.callId}  ${held.why}`);
  }
  for (const held of worklist.foreign) {
    deps.writeOut(`foreign  ${held.callId}  ${held.why}`);
  }
  printCounts({ deps, json: false, worklist });
}

/**
 * The production seams: the worklist under the resolved home, the wall clock, the logger.
 *
 * @returns the seams
 */
function productionAssessmentDueDeps(): AssessmentDueDeps {
  return {
    nowMs: () => Date.now(),
    read: ({ home, nowMs }) => readCallAssessmentWorklist({ home: resolveHome({ named: home }), nowMs }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * `slopweaver talk assessment-due` on the real home and clock.
 *
 * @param argv the whole argv, noun and verb first
 * @returns the exit code
 */
function runTalkAssessmentDue(argv: readonly string[]): number {
  return runAssessmentDue({ deps: productionAssessmentDueDeps(), rest: argv.slice(VERB_ARG_OFFSET) });
}

/** `slopweaver talk assessment-due`. */
export const talkAssessmentDueCommand = defineCommand({ run: runTalkAssessmentDue });

/**
 * `slopweaver talk assessment-record` — the daily call reader writes down one call's verdicts: one class per passage
 * the owner spoke, each with its reason, bound to the digest `talk assessment-due` printed.
 *
 * The call is read again whole before anything is written, and its current digest must be the one passed: words added
 * since the session read them make the verdict about different words, so it is refused and the session reads again.
 * The call's class is derived here from the passage verdicts (`src/talk/callAssessment.ts`), never taken from the
 * caller. The register is `src/store/recordedDataClassAssessment.ts`; it holds no passage text.
 *
 * The verdicts file is `{"verdicts":[{"segmentId":"…","class":"public|internal|personal|restricted|undecided",
 * "reason":"…"}]}`, one entry per passage.
 *
 * Exit codes: a malformed flag or verdicts file, or verdicts that do not answer each passage exactly once, is
 * {@link EXIT_USAGE}; a file that cannot be read, a call not offered, a digest that moved, a conflicting earlier
 * verdict or a register that cannot be written is {@link EXIT_ERROR}.
 */
import { readFileSync } from "node:fs";

import type { Result } from "#lib/result.js";

import { logger } from "../../../lib/logger.js";
import {
  type RecordedAssessmentError,
  type RecordedCallAssessment,
  recordCallAssessment,
} from "../../../store/recordedDataClassAssessment.js";
import {
  aggregatePassageVerdicts,
  type CallAssessmentRequest,
  type PassageAssessmentVerdict,
  parseVerdictsFile,
} from "../../../talk/callAssessment.js";
import { type CallNotOfferedError, readCallAssessmentRequest } from "../../../talk/callAssessmentRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseAssessmentRecordArgs } from "./assessmentArgs.js";
import { TALK_ASSESSMENT_RECORD_USAGE } from "./assessmentUsage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "assessment-record", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * The seams the verb performs its effects through.
 *
 * @internal — exported so a test builds plain seams of the same shape.
 */
export interface AssessmentRecordDeps {
  /** A file's text; throws when it cannot be read. */
  readonly readText: (input: { path: string }) => string;
  /** The call's current request, read whole. */
  readonly readRequest: (input: {
    home: string | undefined;
    callId: string;
    nowMs: number;
  }) => Result<CallAssessmentRequest, CallNotOfferedError>;
  /** Append the assessment, or answer the identical one already held. */
  readonly record: (input: {
    home: string | undefined;
    assessment: RecordedCallAssessment;
  }) => Result<{ readonly record: RecordedCallAssessment; readonly written: boolean }, RecordedAssessmentError>;
  readonly nowMs: () => number;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `talk assessment-record` against injected edges.
 *
 * @param rest argv after `talk assessment-record`
 * @param deps the read, write and output seams
 * @returns the process exit code
 * @internal — exported so a test drives the verb over plain seams.
 */
export function runAssessmentRecord({ rest, deps }: { rest: readonly string[]; deps: AssessmentRecordDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(TALK_ASSESSMENT_RECORD_USAGE);
    return EXIT_OK;
  }
  const parsed = parseAssessmentRecordArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of [parsed.error.message, TALK_ASSESSMENT_RECORD_USAGE]) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const { callId, home, json, requestSha256, verdictsFile } = parsed.value;
  const nowMs = instantNow({ deps, given: parsed.value.nowMs });
  const verdicts = readVerdicts({ callId, deps, verdictsFile });
  if ("exit" in verdicts) {
    return verdicts.exit;
  }
  const request = deps.readRequest({ callId, home, nowMs });
  if (request.isErr()) {
    deps.writeDiagnostic(`talk assessment-record: ${request.error.message}`);
    return EXIT_ERROR;
  }
  if (request.value.requestSha256 !== requestSha256) {
    deps.writeDiagnostic(
      `talk assessment-record: call ${callId}'s words changed since they were read (request is now ` +
        `${request.value.requestSha256}), so nothing was written; run talk assessment-due again and classify what it prints`,
    );
    return EXIT_ERROR;
  }
  const verdict = aggregatePassageVerdicts({ request: request.value, verdicts: verdicts.verdicts });
  if (verdict.isErr()) {
    deps.writeDiagnostic(`talk assessment-record: ${verdict.error.message}`);
    return EXIT_USAGE;
  }
  const recorded = deps.record({
    assessment: {
      callId,
      passageVerdicts: [...verdicts.verdicts],
      recordedAtIso: new Date(nowMs).toISOString(),
      requestSha256,
      verdict: verdict.value,
      version: 1,
    },
    home,
  });
  if (recorded.isErr()) {
    deps.writeDiagnostic(`talk assessment-record: ${recorded.error.message}`);
    return EXIT_ERROR;
  }
  printRecorded({ deps, json, recorded: recorded.value });
  return EXIT_OK;
}

/**
 * The instant to judge at: `--now` when given, else the clock read at this call.
 *
 * @param given the `--now` instant in ms, when passed
 * @returns ms since epoch
 */
function instantNow({ deps, given }: { deps: AssessmentRecordDeps; given: number | undefined }): number {
  if (given !== undefined) {
    return given;
  }
  return deps.nowMs();
}

/**
 * Read and parse the verdicts file, saying why on the diagnostic channel when either step fails.
 *
 * @param callId the call every verdict in the file must name
 * @param verdictsFile the path `--verdicts-file` named
 * @returns the passage verdicts, or the exit code to stop with
 */
function readVerdicts({
  callId,
  deps,
  verdictsFile,
}: {
  callId: string;
  deps: AssessmentRecordDeps;
  verdictsFile: string;
}): { readonly exit: number } | { readonly verdicts: readonly PassageAssessmentVerdict[] } {
  let text: string;
  try {
    text = deps.readText({ path: verdictsFile });
  } catch (cause) {
    deps.writeDiagnostic(
      `talk assessment-record: the verdicts file ${verdictsFile} could not be read (${String(cause)})`,
    );
    return { exit: EXIT_ERROR };
  }
  const verdicts = parseVerdictsFile({ callId, text });
  if (verdicts.isErr()) {
    deps.writeDiagnostic(`talk assessment-record: ${verdicts.error.message}`);
    return { exit: EXIT_USAGE };
  }
  return { verdicts: verdicts.value };
}

/**
 * Print what the register now holds for the call: one JSON document, or one line.
 *
 * @param recorded the register's line, and whether this call wrote it
 * @param json whether `--json` was passed
 */
function printRecorded({
  deps,
  json,
  recorded,
}: {
  deps: AssessmentRecordDeps;
  json: boolean;
  recorded: { readonly record: RecordedCallAssessment; readonly written: boolean };
}): void {
  const { record, written } = recorded;
  if (json) {
    deps.writeOut(
      JSON.stringify({ callId: record.callId, requestSha256: record.requestSha256, verdict: record.verdict, written }),
    );
    return;
  }
  let outcome: string = record.verdict.kind;
  if (record.verdict.kind === "classified") {
    outcome = record.verdict.dataClass;
  }
  let prefix = "already recorded";
  if (written) {
    prefix = "recorded";
  }
  deps.writeOut(`${prefix}  ${record.callId}  ${outcome}  ${record.verdict.reason}`);
}

/**
 * The production seams: the disk, the register under the resolved home, the wall clock, the logger.
 *
 * @returns the seams
 */
function productionAssessmentRecordDeps(): AssessmentRecordDeps {
  return {
    nowMs: () => Date.now(),
    readRequest: ({ home, callId, nowMs }) =>
      readCallAssessmentRequest({ callId, home: resolveHome({ named: home }), nowMs }),
    readText: ({ path }) => readFileSync(path, "utf8"),
    record: ({ home, assessment }) => recordCallAssessment({ assessment, home: resolveHome({ named: home }) }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * `slopweaver talk assessment-record` on the real home and clock.
 *
 * @param argv the whole argv, noun and verb first
 * @returns the exit code
 */
function runTalkAssessmentRecord(argv: readonly string[]): number {
  return runAssessmentRecord({ deps: productionAssessmentRecordDeps(), rest: argv.slice(VERB_ARG_OFFSET) });
}

/** `slopweaver talk assessment-record`. */
export const talkAssessmentRecordCommand = defineCommand({ run: runTalkAssessmentRecord });

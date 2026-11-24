/**
 * `talk assessment-record` against plain seams: the call is read again and its digest must match before anything is
 * recorded, the call's class is derived from the passage verdicts rather than taken from the caller, and each failure
 * exits with what actually happened. Synthetic words and ids only.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "#lib/result.js";

import {
  type AssessmentRecordDeps,
  runAssessmentRecord,
} from "../../../../../cli/commands/talk/assessmentRecordRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import {
  RecordedAssessmentErrors,
  type RecordedCallAssessment,
} from "../../../../../store/recordedDataClassAssessment.js";
import { type CallAssessmentRequest, callAssessmentDigest } from "../../../../../talk/callAssessment.js";
import { CallAssessmentReadErrors } from "../../../../../talk/callAssessmentRead.js";

const CALL = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const PASSAGES = [
  { segmentId: "s-1", text: "the staging pool ran dry" },
  { segmentId: "s-2", text: "remind me to book the dentist" },
];
const DIGEST = callAssessmentDigest({ callId: CALL, passages: PASSAGES });
const REQUEST: CallAssessmentRequest = { callId: CALL, passages: PASSAGES, requestSha256: DIGEST };
const NOW_ISO = "2026-09-25T21:30:00.000Z";

const VERDICTS = JSON.stringify({
  verdicts: [
    { class: "internal", reason: "a work system", segmentId: "s-1" },
    { class: "personal", reason: "a personal appointment", segmentId: "s-2" },
  ],
});

/** The argv naming the call, the digest and a verdicts file. */
const argv = ({ request = DIGEST }: { request?: string } = {}): readonly string[] => [
  "--call",
  CALL,
  "--request",
  request,
  "--verdicts-file",
  "/scratch/verdicts.json",
  "--now",
  NOW_ISO,
];

/** Run the verb, capturing every line and every assessment it asked to record. */
function run({
  rest = argv(),
  over = {},
}: {
  rest?: readonly string[];
  over?: Partial<AssessmentRecordDeps>;
} = {}) {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const recorded: RecordedCallAssessment[] = [];
  const deps: AssessmentRecordDeps = {
    nowMs: () => 0,
    readRequest: () => ok(REQUEST),
    readText: () => VERDICTS,
    record: ({ assessment }) => {
      recorded.push(assessment);
      return ok({ record: assessment, written: true });
    },
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
    ...over,
  };
  const code = runAssessmentRecord({ deps, rest });
  return { code, diagnostics, out, recorded };
}

describe("runAssessmentRecord", () => {
  it("records one verdict per passage and the call's class derived as the highest", () => {
    const { code, out, recorded } = run();
    expect(code).toBe(EXIT_OK);
    expect(recorded).toEqual([
      {
        callId: CALL,
        passageVerdicts: [
          { dataClass: "internal", kind: "classified", reason: "a work system", segmentId: "s-1" },
          { dataClass: "personal", kind: "classified", reason: "a personal appointment", segmentId: "s-2" },
        ],
        recordedAtIso: NOW_ISO,
        requestSha256: DIGEST,
        verdict: {
          dataClass: "personal",
          kind: "classified",
          reason: "the highest class of 2 passage(s), set by segment s-2",
        },
        version: 1,
      },
    ]);
    expect(out).toEqual([`recorded  ${CALL}  personal  the highest class of 2 passage(s), set by segment s-2`]);
  });

  it("says a re-record of identical verdicts wrote nothing", () => {
    const { code, out } = run({
      over: { record: ({ assessment }) => ok({ record: assessment, written: false }) },
    });
    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([`already recorded  ${CALL}  personal  the highest class of 2 passage(s), set by segment s-2`]);
  });

  it("refuses verdicts about words that changed since they were read, recording nothing", () => {
    const { code, diagnostics, recorded } = run({ rest: argv({ request: "b".repeat(64) }) });
    expect(code).toBe(EXIT_ERROR);
    expect(recorded).toEqual([]);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]).toContain(`call ${CALL}'s words changed since they were read (request is now ${DIGEST})`);
  });

  it("refuses a set that leaves a passage unanswered as a usage error", () => {
    const { code, diagnostics, recorded } = run({
      over: {
        readText: () => JSON.stringify({ verdicts: [{ class: "public", reason: "a work system", segmentId: "s-1" }] }),
      },
    });
    expect(code).toBe(EXIT_USAGE);
    expect(recorded).toEqual([]);
    expect(diagnostics[0]).toContain("segment s-2 has no verdict");
  });

  it("refuses a verdicts file that is not one, as a usage error", () => {
    const { code, recorded } = run({ over: { readText: () => '{"verdicts":"all public"}' } });
    expect(code).toBe(EXIT_USAGE);
    expect(recorded).toEqual([]);
  });

  it("fails when the verdicts file cannot be read", () => {
    const { code, diagnostics } = run({
      over: {
        readText: () => {
          throw new Error("ENOENT");
        },
      },
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("the verdicts file /scratch/verdicts.json could not be read");
  });

  it("fails on a call that is not offered, saying why", () => {
    const { code, diagnostics, recorded } = run({
      over: { readRequest: () => err(CallAssessmentReadErrors.notOffered({ callId: CALL, why: "still live" })) },
    });
    expect(code).toBe(EXIT_ERROR);
    expect(recorded).toEqual([]);
    expect(diagnostics).toEqual([`talk assessment-record: call ${CALL} is not offered for a verdict: still live`]);
  });

  it("fails on a conflicting earlier verdict", () => {
    const { code, diagnostics } = run({
      over: { record: () => err(RecordedAssessmentErrors.conflict({ callId: CALL, requestSha256: DIGEST })) },
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain(`call ${CALL} already has different verdicts`);
  });

  it("refuses a request that is not a 64-hex digest before reading anything", () => {
    const { code, diagnostics, recorded } = run({ rest: argv({ request: "abc" }) });
    expect(code).toBe(EXIT_USAGE);
    expect(recorded).toEqual([]);
    expect(diagnostics[0]).toBe("--request is required: the 64-hex request digest `talk assessment-due` printed");
  });
});

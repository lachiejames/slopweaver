/**
 * The assessment register over a throwaway home: one line per assessed call, identical re-records written once,
 * different verdicts for the same words refused, and an unparseable line refusing every read. The port over it is
 * `../talk/callAssessmentPort.test.ts`. Synthetic ids only; the register never holds passage text.
 */
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  assessmentRegisterPath,
  type RecordedCallAssessment,
  readRecordedAssessments,
  recordCallAssessment,
} from "../../../store/recordedDataClassAssessment.js";

const CALL = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DIGEST = "a".repeat(64);

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "assessment-register-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One recorded assessment, internal on its one passage. */
const assessment = ({
  dataClass = "internal",
  requestSha256 = DIGEST,
}: {
  dataClass?: "internal" | "personal";
  requestSha256?: string;
} = {}): RecordedCallAssessment => ({
  callId: CALL,
  passageVerdicts: [{ dataClass, kind: "classified", reason: "a work system", segmentId: "s-1" }],
  recordedAtIso: "2026-11-20T21:30:00.000Z",
  requestSha256,
  verdict: { dataClass, kind: "classified", reason: "the highest class of 1 passage(s), set by segment s-1" },
  version: 1,
});

describe("recordCallAssessment", () => {
  it("appends one line, owner-only, holding no passage text", () => {
    const written = unwrap(recordCallAssessment({ assessment: assessment(), home }));
    expect(written.written).toBe(true);
    const path = assessmentRegisterPath({ home });
    expect(path).toBe(join(home, "judgement", "data-class-assessments.jsonl"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(unwrap(readRecordedAssessments({ home }))).toEqual([assessment()]);
    expect(readFileSync(path, "utf8")).not.toContain('"text"');
  });

  it("answers the line already there for identical verdicts, writing nothing", () => {
    unwrap(recordCallAssessment({ assessment: assessment(), home }));
    const again = unwrap(recordCallAssessment({ assessment: assessment(), home }));
    expect(again.written).toBe(false);
    expect(unwrap(readRecordedAssessments({ home })).length).toBe(1);
  });

  it("refuses different verdicts for the same words, keeping the first", () => {
    unwrap(recordCallAssessment({ assessment: assessment(), home }));
    const error = unwrapErr(recordCallAssessment({ assessment: assessment({ dataClass: "personal" }), home }));
    expect(error.code).toBe("ASSESSMENT_CONFLICT");
    expect(error.message).toContain(`call ${CALL} already has different verdicts`);
    expect(unwrap(readRecordedAssessments({ home }))).toEqual([assessment()]);
  });

  it("appends a second line when the call's words moved on", () => {
    unwrap(recordCallAssessment({ assessment: assessment(), home }));
    unwrap(recordCallAssessment({ assessment: assessment({ requestSha256: "b".repeat(64) }), home }));
    expect(unwrap(readRecordedAssessments({ home })).map((record) => record.requestSha256)).toEqual([
      DIGEST,
      "b".repeat(64),
    ]);
  });
});

describe("readRecordedAssessments", () => {
  it("reads an absent register as nothing assessed", () => {
    expect(unwrap(readRecordedAssessments({ home }))).toEqual([]);
  });

  it("refuses every read over a line that is not a recorded assessment, naming it", () => {
    unwrap(recordCallAssessment({ assessment: assessment(), home }));
    appendFileSync(assessmentRegisterPath({ home }), '{"version":1}\n');
    const error = unwrapErr(readRecordedAssessments({ home }));
    expect(error.code).toBe("ASSESSMENT_REGISTER_UNREADABLE");
    expect(error.message).toContain("line 2 is not a recorded assessment");
  });

  it("refuses a recording over an unreadable register rather than appending past it", () => {
    mkdirSync(dirname(assessmentRegisterPath({ home })), { recursive: true });
    appendFileSync(assessmentRegisterPath({ home }), "not json\n");
    const error = unwrapErr(recordCallAssessment({ assessment: assessment(), home }));
    expect(error.code).toBe("ASSESSMENT_REGISTER_UNREADABLE");
    expect(readFileSync(assessmentRegisterPath({ home }), "utf8")).toBe("not json\n");
  });
});

/**
 * `talk assessment-due` against plain seams: read mode prints each due call's passages verbatim, `--check` prints
 * counts and never a passage, and exits deferred while anything is due so the automation firing stays unstamped.
 * Synthetic words only.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "#lib/result.js";

import { runAssessmentDue } from "../../../../../cli/commands/talk/assessmentDueRun.js";
import { TALK_ASSESSMENT_DUE_USAGE } from "../../../../../cli/commands/talk/assessmentUsage.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { CallAssessmentReadErrors, type CallAssessmentWorklist } from "../../../../../talk/callAssessmentRead.js";

const CALL = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const WORDS = "the staging pool ran dry at noon";

/** A worklist with one call due and one of each held kind. */
const ONE_DUE: CallAssessmentWorklist = {
  assessed: [],
  due: [{ callId: CALL, passages: [{ segmentId: "s-1", text: WORDS }], requestSha256: "a".repeat(64) }],
  foreign: [{ callId: "f", why: "stretch s-1 was written by a console that is not the owner's" }],
  incomplete: [{ callId: "i", why: "1 line(s) did not parse, and may hold words the owner said" }],
  live: [{ callId: "l", why: "still live: last heard 2026-09-25T15:05:00.000Z" }],
  silent: 2,
  testInstance: 1,
};

/** Nothing due. */
const NONE_DUE: CallAssessmentWorklist = { ...ONE_DUE, due: [] };

/** Run the verb over a worklist, capturing every line and the instant it was read at. */
function run({ rest, worklist = ONE_DUE }: { rest: readonly string[]; worklist?: CallAssessmentWorklist }) {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const readAt: number[] = [];
  const code = runAssessmentDue({
    deps: {
      nowMs: () => 1_000,
      read: ({ nowMs }) => {
        readAt.push(nowMs);
        return ok(worklist);
      },
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    rest,
  });
  return { code, diagnostics, out, readAt };
}

const COUNTS_LINE =
  "1 call(s) due for a verdict · 0 assessed · 1 live · 1 incomplete · 1 from a console not the owner's · " +
  "2 with nothing the owner said · 1 test instance";

describe("runAssessmentDue", () => {
  it("prints each due call with its passages verbatim, then what is held and the counts", () => {
    const { code, out } = run({ rest: [] });
    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([
      `call ${CALL}  request ${"a".repeat(64)}`,
      `  [s-1] ${WORDS}`,
      "held  l  still live: last heard 2026-09-25T15:05:00.000Z",
      "incomplete  i  1 line(s) did not parse, and may hold words the owner said",
      "foreign  f  stretch s-1 was written by a console that is not the owner's",
      COUNTS_LINE,
    ]);
  });

  it("prints one JSON document carrying the passages under --json", () => {
    const { code, out } = run({ rest: ["--json"] });
    expect(code).toBe(EXIT_OK);
    expect(out.length).toBe(1);
    expect(JSON.parse(out[0]!)).toEqual({
      counts: { assessed: 0, due: 1, foreign: 1, incomplete: 1, live: 1, silent: 2, testInstance: 1 },
      due: ONE_DUE.due,
      foreign: ONE_DUE.foreign,
      incomplete: ONE_DUE.incomplete,
      live: ONE_DUE.live,
    });
  });

  it("prints counts and no passage under --check, deferring while a call is due", () => {
    const { code, out } = run({ rest: ["--check"] });
    expect(code).toBe(EXIT_DEFERRED);
    expect(out).toEqual([COUNTS_LINE]);
    expect(out.join("\n")).not.toContain(WORDS);
  });

  it("exits OK under --check once nothing is due", () => {
    const { code } = run({ rest: ["--check", "--json"], worklist: NONE_DUE });
    expect(code).toBe(EXIT_OK);
  });

  it("judges liveness at --now when given, and at the clock otherwise", () => {
    expect(run({ rest: ["--now", "2026-09-25T16:00:00Z"] }).readAt).toEqual([Date.parse("2026-09-25T16:00:00Z")]);
    expect(run({ rest: [] }).readAt).toEqual([1_000]);
  });

  it("refuses a --now that is not an instant before reading anything", () => {
    const { code, diagnostics, readAt } = run({ rest: ["--now", "tomorrow"] });
    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics).toEqual([
      "--now tomorrow is not an ISO instant, such as 2026-10-08T23:00:00Z",
      TALK_ASSESSMENT_DUE_USAGE,
    ]);
    expect(readAt).toEqual([]);
  });

  it("fails on an unreadable worklist rather than reading it as nothing due", () => {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const code = runAssessmentDue({
      deps: {
        nowMs: () => 1_000,
        read: () =>
          err(CallAssessmentReadErrors.readFailed({ detail: "register line 1 is not a recorded assessment" })),
        writeDiagnostic: (line) => {
          diagnostics.push(line);
        },
        writeOut: (line) => {
          out.push(line);
        },
      },
      rest: ["--check"],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(diagnostics).toEqual([
      "talk assessment-due: the call worklist could not be read, so nothing is offered as due or as done: " +
        "register line 1 is not a recorded assessment",
    ]);
  });
});

/**
 * The data-class assessment port over a throwaway home: it reads the call's CURRENT owner passages itself and answers
 * only a verdict recorded over exactly those words. The counterexample it closes: a call assessed `public`, then
 * spoken on again, must not keep answering `public` for the words it now holds. Synthetic calls and words only.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { assessmentRegisterPath, recordCallAssessment } from "../../../store/recordedDataClassAssessment.js";
import { callAssessmentDigest } from "../../../talk/callAssessment.js";
import { recordedDataClassAssessment } from "../../../talk/callAssessmentPort.js";
import type { CallEntry } from "../../../talk/callRecord.js";
import { callsDir } from "../../../talk/callStore.js";
import { CLOSED, said } from "./cardUtteranceFixture.js";

const CALL = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const FIRST = { segmentId: "s-1", text: "the build is green" };
/** Long after every fixture line, so no call reads live. */
const LATER_MS = Date.parse("2026-09-26T00:00:00.000Z");

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "assessment-port-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One call file holding these lines. */
function call({ lines }: { lines: readonly CallEntry[] }): void {
  const dir = callsDir({ home });
  mkdirSync(dir, { mode: 0o700, recursive: true });
  writeFileSync(join(dir, `${CALL}.jsonl`), lines.map((line) => `${JSON.stringify(line)}\n`).join(""), {
    mode: 0o600,
  });
}

/** Record `public` for the call's first passage, over the words it held then. */
function assessedPublic(): void {
  unwrap(
    recordCallAssessment({
      assessment: {
        callId: CALL,
        passageVerdicts: [{ dataClass: "public", kind: "classified", reason: "a build status", segmentId: "s-1" }],
        recordedAtIso: "2026-09-25T21:30:00.000Z",
        requestSha256: callAssessmentDigest({ callId: CALL, passages: [FIRST] }),
        verdict: {
          dataClass: "public",
          kind: "classified",
          reason: "the highest class of 1 passage(s), set by segment s-1",
        },
        version: 1,
      },
      home,
    }),
  );
}

/** The port's answer about the call. */
const answer = async () =>
  recordedDataClassAssessment({ home, nowMs: () => LATER_MS })({
    request: { body: "", subject: { callId: CALL, kind: "talk-call" }, title: null },
  });

describe("recordedDataClassAssessment — the port", () => {
  it("answers the verdict recorded over the call's current words", async () => {
    call({ lines: [said({ at: "01:00", id: "s-1", open: undefined, text: FIRST.text }), CLOSED] });
    assessedPublic();
    expect(unwrap(await answer())).toEqual({
      dataClass: "public",
      kind: "classified",
      reason: "the highest class of 1 passage(s), set by segment s-1",
    });
  });

  it("stops answering the earlier class once the owner says more on the call", async () => {
    call({
      lines: [
        said({ at: "01:00", id: "s-1", open: undefined, text: FIRST.text }),
        said({ at: "02:00", id: "s-2", open: undefined, text: "the vault code is on the whiteboard" }),
        CLOSED,
      ],
    });
    assessedPublic();
    expect(unwrap(await answer())).toEqual({
      kind: "undecided",
      reason: "no visible session has assessed this call's current words",
    });
  });

  it("answers undecided for a call held back from the worklist, naming why", async () => {
    call({ lines: [said({ at: "01:00", id: "s-1", open: undefined, text: FIRST.text }), CLOSED] });
    assessedPublic();
    appendFileSync(join(callsDir({ home }), `${CALL}.jsonl`), '{"kind":"segment","te\n');
    expect(unwrap(await answer())).toEqual({
      kind: "undecided",
      reason: `call ${CALL} is not offered for a verdict: 1 line(s) did not parse, and may hold words the owner said`,
    });
  });

  it("answers undecided for a stored row, which no session assesses yet", async () => {
    const stored = await recordedDataClassAssessment({ home, nowMs: () => LATER_MS })({
      request: {
        body: "",
        subject: {
          facts: {
            author: null,
            container: null,
            kind: "message",
            source: "slack",
            table: "content",
            visibility: "private",
          },
          kind: "stored-row",
          ruleId: "default-assess",
        },
        title: null,
      },
    });
    expect(unwrap(stored)).toEqual({ kind: "undecided", reason: "no visible session assesses stored rows yet" });
  });

  it("fails rather than answering undecided over an unreadable register", async () => {
    call({ lines: [said({ at: "01:00", id: "s-1", open: undefined, text: FIRST.text }), CLOSED] });
    mkdirSync(join(home, "judgement"), { recursive: true });
    writeFileSync(assessmentRegisterPath({ home }), "not json\n");
    const error = unwrapErr(await answer());
    expect(error.code).toBe("DATA_CLASS_ASSESSMENT_FAILED");
    expect(error.message).toContain("line 1 is not a recorded assessment");
  });
});

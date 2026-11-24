/**
 * The call reader's worklist over a throwaway home: a call is due until the register holds a verdict for its CURRENT
 * words, and every call that is not offered — still live, torn, written by a console not the owner's, silent, or the
 * test instance's — is said rather than dropped. Synthetic calls and words only.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { recordCallAssessment } from "../../../store/recordedDataClassAssessment.js";
import { callAssessmentDigest } from "../../../talk/callAssessment.js";
import {
  foreignOwnerSegment,
  LIVE_QUIET_MS,
  readCallAssessmentRequest,
  readCallAssessmentWorklist,
} from "../../../talk/callAssessmentRead.js";
import type { CallOrigin } from "../../../talk/callOrigin.js";
import type { CallEntry } from "../../../talk/callRecord.js";
import { callsDir } from "../../../talk/callStore.js";
import { CLOSED, said } from "./cardUtteranceFixture.js";

const OLDER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NEWER = "1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";
/** Long after every fixture line, so no closed or quiet call reads live. */
const LATER_MS = Date.parse("2026-09-26T00:00:00.000Z");

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "assessment-worklist-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** An origin served by the owner's console, or by another. */
const origin = ({ owners }: { owners: boolean }): CallOrigin => ({
  checkoutRoot: "/checkout",
  defaultPort: 3000,
  mainWorktree: owners,
  port: 3000,
});

/** An open line at a fixed instant, carrying an origin or none. */
const opened = ({ at, served }: { at: string; served: CallOrigin | undefined }): CallEntry => ({
  atIso: `2026-09-25T15:${at}.000Z`,
  kind: "open",
  model: "m",
  origin: served,
  sessionId: "sess",
  voice: "v",
});

/** One call file holding these lines. */
function call({ callId, lines }: { callId: string; lines: readonly CallEntry[] }): void {
  const dir = callsDir({ home });
  mkdirSync(dir, { mode: 0o700, recursive: true });
  writeFileSync(join(dir, `${callId}.jsonl`), lines.map((line) => `${JSON.stringify(line)}\n`).join(""), {
    mode: 0o600,
  });
}

/** A closed call on which the owner said one thing, opened at `at`. */
const spoken = ({ at, text }: { at: string; text: string }): readonly CallEntry[] => [
  said({ at, id: "s-1", open: undefined, text }),
  CLOSED,
];

/** Record an internal verdict for a call's one passage at these words. */
function assessed({ callId, text }: { callId: string; text: string }): void {
  const requestSha256 = callAssessmentDigest({ callId, passages: [{ segmentId: "s-1", text }] });
  unwrap(
    recordCallAssessment({
      assessment: {
        callId,
        passageVerdicts: [{ dataClass: "internal", kind: "classified", reason: "work talk", segmentId: "s-1" }],
        recordedAtIso: "2026-09-25T21:30:00.000Z",
        requestSha256,
        verdict: {
          dataClass: "internal",
          kind: "classified",
          reason: "the highest class of 1 passage(s), set by segment s-1",
        },
        version: 1,
      },
      home,
    }),
  );
}

describe("readCallAssessmentWorklist", () => {
  it("reads an absent call directory as nothing due", () => {
    const worklist = unwrap(readCallAssessmentWorklist({ home, nowMs: LATER_MS }));
    expect(worklist.due).toEqual([]);
    expect(worklist.silent).toBe(0);
  });

  it("offers every unassessed call, oldest first, with the owner's words verbatim", () => {
    call({ callId: NEWER, lines: spoken({ at: "20:00", text: "the build cache is stale" }) });
    call({ callId: OLDER, lines: spoken({ at: "05:00", text: "the staging pool ran dry" }) });
    const worklist = unwrap(readCallAssessmentWorklist({ home, nowMs: LATER_MS }));
    expect(worklist.due.map((request) => request.callId)).toEqual([OLDER, NEWER]);
    expect(worklist.due[0]!.passages).toEqual([{ segmentId: "s-1", text: "the staging pool ran dry" }]);
  });

  it("counts a call assessed for its current words, and offers it again once a word is added", () => {
    call({ callId: OLDER, lines: spoken({ at: "05:00", text: "the staging pool ran dry" }) });
    assessed({ callId: OLDER, text: "the staging pool ran dry" });
    const before = unwrap(readCallAssessmentWorklist({ home, nowMs: LATER_MS }));
    expect(before.due).toEqual([]);
    expect(before.assessed.map((one) => one.verdict)).toEqual([
      { dataClass: "internal", kind: "classified", reason: "the highest class of 1 passage(s), set by segment s-1" },
    ]);
    call({ callId: OLDER, lines: spoken({ at: "05:00", text: "the staging pool ran dry at noon" }) });
    const after = unwrap(readCallAssessmentWorklist({ home, nowMs: LATER_MS }));
    expect(after.due.map((request) => request.callId)).toEqual([OLDER]);
    expect(after.assessed).toEqual([]);
  });

  it("holds an unended call heard within the quiet window, and offers it once quiet", () => {
    call({ callId: OLDER, lines: [said({ at: "05:00", id: "s-1", open: undefined, text: "one moment" })] });
    const heardMs = Date.parse("2026-09-25T15:05:00.000Z");
    const live = unwrap(readCallAssessmentWorklist({ home, nowMs: heardMs + LIVE_QUIET_MS - 1 }));
    expect(live.due).toEqual([]);
    expect(live.live).toEqual([{ callId: OLDER, why: "still live: last heard 2026-09-25T15:05:00.000Z" }]);
    const quiet = unwrap(readCallAssessmentWorklist({ home, nowMs: heardMs + LIVE_QUIET_MS }));
    expect(quiet.due.map((request) => request.callId)).toEqual([OLDER]);
  });

  it("holds a call with a torn line, since the torn line may hold the owner's words", () => {
    call({ callId: OLDER, lines: spoken({ at: "05:00", text: "the staging pool ran dry" }) });
    appendFileSync(join(callsDir({ home }), `${OLDER}.jsonl`), '{"kind":"segment","te\n');
    const worklist = unwrap(readCallAssessmentWorklist({ home, nowMs: LATER_MS }));
    expect(worklist.due).toEqual([]);
    expect(worklist.incomplete).toEqual([
      { callId: OLDER, why: "1 line(s) did not parse, and may hold words the owner said" },
    ]);
  });

  it("holds a call an owner-side stretch of which a console not the owner's wrote", () => {
    call({
      callId: OLDER,
      lines: [
        opened({ at: "00:00", served: origin({ owners: false }) }),
        said({ at: "05:00", id: "s-1", open: undefined, text: "testing one two" }),
        CLOSED,
      ],
    });
    const worklist = unwrap(readCallAssessmentWorklist({ home, nowMs: LATER_MS }));
    expect(worklist.due).toEqual([]);
    expect(worklist.foreign).toEqual([
      { callId: OLDER, why: "stretch s-1 was written by a console that is not the owner's" },
    ]);
  });

  it("counts a call the owner said nothing on, and one the desktop test instance opened", () => {
    call({
      callId: OLDER,
      lines: [said({ at: "05:00", id: "v-1", open: undefined, text: "hello?", who: "voice" }), CLOSED],
    });
    call({
      callId: NEWER,
      lines: [
        opened({ at: "00:00", served: { ...origin({ owners: true }), instance: "e2e" } }),
        said({ at: "05:00", id: "s-1", open: undefined, text: "walk speech" }),
        CLOSED,
      ],
    });
    const worklist = unwrap(readCallAssessmentWorklist({ home, nowMs: LATER_MS }));
    expect(worklist.due).toEqual([]);
    expect(worklist.silent).toBe(1);
    expect(worklist.testInstance).toBe(1);
  });

  it("fails the whole read over an unreadable register, never reading as nothing due", () => {
    call({ callId: OLDER, lines: spoken({ at: "05:00", text: "the staging pool ran dry" }) });
    mkdirSync(join(home, "judgement"), { recursive: true });
    writeFileSync(join(home, "judgement", "data-class-assessments.jsonl"), "not json\n");
    const error = unwrapErr(readCallAssessmentWorklist({ home, nowMs: LATER_MS }));
    expect(error.code).toBe("CALL_ASSESSMENT_READ_FAILED");
    expect(error.message).toContain("line 1 is not a recorded assessment");
  });
});

describe("foreignOwnerSegment", () => {
  it("passes an owner's console and an unstamped open, and names the first stretch under another console", () => {
    expect(
      foreignOwnerSegment({
        entries: [
          opened({ at: "00:00", served: origin({ owners: true }) }),
          said({ at: "01:00", id: "s-1", open: undefined, text: "mine" }),
        ],
      }),
    ).toBeUndefined();
    expect(
      foreignOwnerSegment({
        entries: [
          opened({ at: "00:00", served: undefined }),
          said({ at: "01:00", id: "s-1", open: undefined, text: "mine" }),
          opened({ at: "02:00", served: origin({ owners: false }) }),
          said({ at: "03:00", id: "v-1", open: undefined, text: "the voice", who: "voice" }),
          said({ at: "04:00", id: "s-2", open: undefined, text: "not mine" }),
        ],
      }),
    ).toBe("s-2");
  });
});

describe("readCallAssessmentRequest", () => {
  it("answers the current request for an offered call", () => {
    call({ callId: OLDER, lines: spoken({ at: "05:00", text: "the staging pool ran dry" }) });
    const request = unwrap(readCallAssessmentRequest({ callId: OLDER, home, nowMs: LATER_MS }));
    expect(request.requestSha256).toBe(
      callAssessmentDigest({ callId: OLDER, passages: [{ segmentId: "s-1", text: "the staging pool ran dry" }] }),
    );
  });

  it("refuses a call that is not offered, saying why", () => {
    call({
      callId: OLDER,
      lines: [said({ at: "05:00", id: "v-1", open: undefined, text: "hello?", who: "voice" }), CLOSED],
    });
    const error = unwrapErr(readCallAssessmentRequest({ callId: OLDER, home, nowMs: LATER_MS }));
    expect(error.code).toBe("CALL_NOT_OFFERED");
    expect(error.message).toBe(
      `call ${OLDER} is not offered for a verdict: it holds nothing the owner said, so there is nothing to classify`,
    );
  });
});

/**
 * The call reader's pure half: which passages a call asks about, the digest that binds a verdict to those exact words,
 * the verdicts file decoded, and the call's class derived as the highest of its passages. Synthetic words only.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  aggregatePassageVerdicts,
  type CallAssessmentRequest,
  callAssessmentDigest,
  callAssessmentRequest,
  PASSAGE_REASON_MAX_CHARS,
  type PassageAssessmentVerdict,
  parseVerdictsFile,
} from "../../../talk/callAssessment.js";
import { foldCall } from "../../../talk/callRecord.js";
import { CLOSED, said } from "./cardUtteranceFixture.js";

const CALL = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** A folded call holding these lines. */
const folded = ({ lines }: { lines: Parameters<typeof foldCall>[0]["entries"] }) =>
  foldCall({ callId: CALL, entries: lines, skipped: 0 })!;

/** A request over two synthetic passages. */
const TWO: CallAssessmentRequest = {
  callId: CALL,
  passages: [
    { segmentId: "s-1", text: "the staging pool ran dry at noon" },
    { segmentId: "s-2", text: "remind me to book the dentist" },
  ],
  requestSha256: callAssessmentDigest({
    callId: CALL,
    passages: [
      { segmentId: "s-1", text: "the staging pool ran dry at noon" },
      { segmentId: "s-2", text: "remind me to book the dentist" },
    ],
  }),
};

/** One classified verdict. */
const classified = ({
  segmentId,
  dataClass,
}: {
  segmentId: string;
  dataClass: "public" | "internal" | "personal" | "restricted";
}): PassageAssessmentVerdict => ({ dataClass, kind: "classified", reason: "decided by its words", segmentId });

describe("callAssessmentRequest", () => {
  it("asks about every stretch the owner spoke, in order and verbatim, and never the voice's", () => {
    const record = folded({
      lines: [
        said({ at: "01:00", id: "s-1", open: undefined, text: "  the staging pool ran dry at noon  " }),
        said({ at: "01:10", id: "v-1", open: undefined, text: "I can look into that", who: "voice" }),
        said({ at: "01:20", final: false, id: "s-2", open: undefined, text: "remind me to book" }),
        CLOSED,
      ],
    });
    expect(callAssessmentRequest({ record })!.passages).toEqual([
      { segmentId: "s-1", text: "  the staging pool ran dry at noon  " },
      { segmentId: "s-2", text: "remind me to book" },
    ]);
  });

  it("asks nothing of a call the owner said nothing on", () => {
    const record = folded({
      lines: [said({ at: "01:10", id: "v-1", open: undefined, text: "hello?", who: "voice" }), CLOSED],
    });
    expect(callAssessmentRequest({ record })).toBeUndefined();
  });

  it("keeps the digest when only a snapshot's time moves, and changes it when a word does", () => {
    const at = ({ when, text }: { when: string; text: string }) =>
      callAssessmentRequest({
        record: folded({ lines: [said({ at: when, id: "s-1", open: undefined, text }), CLOSED] }),
      })!.requestSha256;
    const first = at({ text: "the staging pool ran dry", when: "01:00" });
    expect(at({ text: "the staging pool ran dry", when: "02:30" })).toBe(first);
    expect(at({ text: "the staging pool ran dry at noon", when: "01:00" })).not.toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe("parseVerdictsFile", () => {
  it("decodes a class or undecided per passage", () => {
    const text = JSON.stringify({
      verdicts: [
        { class: "internal", reason: "a work system", segmentId: "s-1" },
        { class: "undecided", reason: "too short to tell", segmentId: "s-2" },
      ],
    });
    expect(unwrap(parseVerdictsFile({ callId: CALL, text }))).toEqual([
      { dataClass: "internal", kind: "classified", reason: "a work system", segmentId: "s-1" },
      { kind: "undecided", reason: "too short to tell", segmentId: "s-2" },
    ]);
  });

  it("refuses text that is not JSON, naming the call", () => {
    const error = unwrapErr(parseVerdictsFile({ callId: CALL, text: "{" }));
    expect(error.code).toBe("CALL_ASSESSMENT_VERDICTS_INVALID");
    expect(error.message).toContain(`call ${CALL}`);
    expect(error.problems).toEqual(["the verdicts file is not JSON (invalid JSON)"]);
  });

  it("refuses a class outside the scheme, and an `unknown` the reader may not assign", () => {
    const text = JSON.stringify({ verdicts: [{ class: "unknown", reason: "r", segmentId: "s-1" }] });
    const error = unwrapErr(parseVerdictsFile({ callId: CALL, text }));
    expect(error.code).toBe("CALL_ASSESSMENT_VERDICTS_INVALID");
    expect(error.problems.length).toBe(1);
    expect(error.problems[0]).toContain("verdicts.0.class");
  });

  it("refuses an empty verdict list", () => {
    const error = unwrapErr(parseVerdictsFile({ callId: CALL, text: JSON.stringify({ verdicts: [] }) }));
    expect(error.problems[0]).toContain("verdicts");
  });
});

describe("aggregatePassageVerdicts", () => {
  it("gives the call the highest class any passage holds, naming the passage that set it", () => {
    const verdict = aggregatePassageVerdicts({
      request: TWO,
      verdicts: [
        classified({ dataClass: "internal", segmentId: "s-1" }),
        classified({ dataClass: "personal", segmentId: "s-2" }),
      ],
    });
    expect(unwrap(verdict)).toEqual({
      dataClass: "personal",
      kind: "classified",
      reason: "the highest class of 2 passage(s), set by segment s-2",
    });
  });

  it("names the first passage when two share the highest class", () => {
    const verdict = aggregatePassageVerdicts({
      request: TWO,
      verdicts: [
        classified({ dataClass: "public", segmentId: "s-1" }),
        classified({ dataClass: "public", segmentId: "s-2" }),
      ],
    });
    expect(unwrap(verdict)).toEqual({
      dataClass: "public",
      kind: "classified",
      reason: "the highest class of 2 passage(s), set by segment s-1",
    });
  });

  it("leaves the call undecided when any one passage is, whatever the others hold", () => {
    const verdict = aggregatePassageVerdicts({
      request: TWO,
      verdicts: [
        classified({ dataClass: "public", segmentId: "s-1" }),
        { kind: "undecided", reason: "too short to tell", segmentId: "s-2" },
      ],
    });
    expect(unwrap(verdict)).toEqual({
      kind: "undecided",
      reason: "1 of 2 passage(s) undecided, so the call stays unknown",
    });
  });

  it("refuses a missing, a repeated and a stray passage together, so a call is never classed on part of it", () => {
    const error = unwrapErr(
      aggregatePassageVerdicts({
        request: TWO,
        verdicts: [
          classified({ dataClass: "public", segmentId: "s-1" }),
          classified({ dataClass: "public", segmentId: "s-1" }),
          classified({ dataClass: "public", segmentId: "s-9" }),
        ],
      }),
    );
    expect(error.code).toBe("CALL_ASSESSMENT_VERDICTS_INVALID");
    expect(error.problems).toEqual([
      "segment s-1 is answered more than once",
      "segment s-9 is not one of the owner's passages on this call",
      "segment s-2 has no verdict",
    ]);
  });

  it("refuses a blank reason and one past the bound", () => {
    const error = unwrapErr(
      aggregatePassageVerdicts({
        request: TWO,
        verdicts: [
          { dataClass: "public", kind: "classified", reason: "   ", segmentId: "s-1" },
          {
            dataClass: "public",
            kind: "classified",
            reason: "x".repeat(PASSAGE_REASON_MAX_CHARS + 1),
            segmentId: "s-2",
          },
        ],
      }),
    );
    expect(error.problems).toEqual([
      "segment s-1 carries no reason",
      "segment s-2's reason is past 300 characters; say why in one sentence",
    ]);
  });
});

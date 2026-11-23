/*
 * The reader for `slopweaver talk cut-ins --json`, against the payload shape the verb prints, and the live row the
 * Alignment page reads it through. One cut-in that does not read refuses the whole reading: a chart missing a point
 * draws a fall that did not happen.
 */

import { describe, expect, it } from "vitest";

import { readScriptedCutIns } from "../../components/live/readScriptedCutIns";
import { liveVerbFor } from "../../lib/liveVerbs";

const CALL = "a0000030-0000-4000-8000-000000000033";

/** The payload the verb printed over the reported call. */
const PAYLOAD = {
  calls: 146,
  cutIns: [
    {
      anchor: `talk-call:${CALL}#turn_000000000000000000012`,
      atIso: "2026-10-06T11:41:44.809Z",
      before: "Yes, that's it — make the change. Next card is",
      callId: CALL,
      line: "Sorry, this one's slow. I'm writing some of it up.",
      likelyTurnId: "a0000002-0000-4000-8000-000000000002",
    },
  ],
  gaps: [`${CALL}: 1 line(s) did not parse, so a cut-in in one is not counted`],
  observedAtIso: "2026-10-08T16:00:00.000Z",
  ok: true,
  sinceIso: "2026-08-09T16:00:00.000Z",
};

describe("readScriptedCutIns", () => {
  it("reads the verb's payload whole", () => {
    expect(readScriptedCutIns(PAYLOAD)).toEqual({
      calls: 146,
      cutIns: [
        {
          anchor: `talk-call:${CALL}#turn_000000000000000000012`,
          atIso: "2026-10-06T11:41:44.809Z",
          before: "Yes, that's it — make the change. Next card is",
          line: "Sorry, this one's slow. I'm writing some of it up.",
        },
      ],
      gaps: [`${CALL}: 1 line(s) did not parse, so a cut-in in one is not counted`],
      observedAtIso: "2026-10-08T16:00:00.000Z",
      sinceIso: "2026-08-09T16:00:00.000Z",
    });
  });

  it("refuses the whole reading when one cut-in has no instant", () => {
    const torn = { ...PAYLOAD, cutIns: [{ ...PAYLOAD.cutIns[0], atIso: "yesterday" }] };
    expect(readScriptedCutIns(torn)).toBeUndefined();
  });

  it("refuses a payload with no gaps list, so a zero is never drawn without saying what it could not read", () => {
    const { gaps: _gaps, ...withoutGaps } = PAYLOAD;
    expect(readScriptedCutIns(withoutGaps)).toBeUndefined();
  });

  it("refuses a payload that is not an object", () => {
    expect(readScriptedCutIns("talk cut-ins: 1 answer(s)")).toBeUndefined();
  });

  it("is read through the slow-lane row that runs the verb", () => {
    const verb = liveVerbFor({ slug: "scripted-cut-ins" })!;
    expect([verb.argv, verb.lane]).toEqual([["talk", "cut-ins", "--json"], "slow"]);
  });
});

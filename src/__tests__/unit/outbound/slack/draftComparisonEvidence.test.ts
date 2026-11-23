/**
 * `draftComparisonEvidence.ts` — a retried comparison sees what the original's recording read: a message added since
 * is cut away, and an edit or removal since refuses the retry.
 */
import { describe, expect, it } from "vitest";

import { recordedEvidence } from "../../../../outbound/slack/draftComparisonEvidence.js";

/** A row whose recording read two messages, the second edited once. */
const DRAFT = {
  id: "sd-11112222",
  readThrough: {
    seen: [{ ts: "1760000001.000100" }, { editedTs: "1760000003.000100", ts: "1760000002.000100" }],
    throughTs: "1760000002.000100",
  },
  tsIso: "2026-10-09T11:06:00.000Z",
};

const FIRST = { text: "who owns ISO?", ts: "1760000001.000100", user: "U0SETH" };
const SECOND = { edited: { ts: "1760000003.000100" }, text: "anyone?", ts: "1760000002.000100", user: "U0SETH" };

describe("recordedEvidence", () => {
  it("hands back the conversation unchanged when nothing moved", () => {
    expect(recordedEvidence({ draft: DRAFT, rows: [FIRST, SECOND] })).toEqual({
      kind: "as-recorded",
      rows: [FIRST, SECOND],
    });
  });

  it("cuts away a message added since the recording read", () => {
    const later = { text: "it's Ari", ts: "1760000009.000100", user: "U0JO" };
    expect(recordedEvidence({ draft: DRAFT, rows: [FIRST, SECOND, later] })).toEqual({
      kind: "as-recorded",
      rows: [FIRST, SECOND],
    });
  });

  it("refuses when a message the recording read was edited since, or removed", () => {
    const reEdited = { ...SECOND, edited: { ts: "1760000008.000100" } };
    expect(recordedEvidence({ draft: DRAFT, rows: [FIRST, reEdited] })).toEqual({
      kind: "moved",
      why:
        "the conversation was edited or had messages removed since sd-11112222 was recorded (1760000002.000100), so " +
        "a Codex draft now could not see what the original saw",
    });
    expect(recordedEvidence({ draft: DRAFT, rows: [SECOND] }).kind).toBe("moved");
  });

  it("cuts by the recording instant on a row that kept no read-through", () => {
    const { readThrough: _none, ...bare } = DRAFT;
    const before = { text: "before", ts: "1760000000.000100", user: "U0SETH" };
    const after = { text: "after", ts: "1799000000.000100", user: "U0SETH" };
    expect(recordedEvidence({ draft: bare, rows: [before, after] })).toEqual({ kind: "as-recorded", rows: [before] });
  });
});

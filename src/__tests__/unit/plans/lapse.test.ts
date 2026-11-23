/**
 * The one lapse wording both `plans list` and every `PLAN` line print: the recorded instant verbatim, or
 * UNRECORDED — never a clock-judged state, so a past date reads exactly as it was written.
 */
import { describe, expect, it } from "vitest";

import { lapseProblems, renderPlanLapse } from "../../../plans/lapse.js";

describe("lapseProblems", () => {
  it("accepts an absent lapse and a strict instant", () => {
    expect(lapseProblems({ at: "row 1", lapsesAtIso: undefined })).toStrictEqual([]);
    expect(lapseProblems({ at: "row 1", lapsesAtIso: "2026-11-17T00:00:00+11:00" })).toStrictEqual([]);
  });

  it.each(["3 Mar", 1763337600, null])("refuses a lapse of %s, naming the row", (lapsesAtIso) => {
    expect(lapseProblems({ at: "row 1", lapsesAtIso })).toStrictEqual([
      "row 1's `lapsesAtIso`, when present, must be an ISO-8601 instant",
    ]);
  });
});

describe("renderPlanLapse", () => {
  it("prints a recorded lapse exactly as typed, an offset kept and a past date unjudged", () => {
    expect(renderPlanLapse({ lapsesAtIso: "2026-11-17T00:00:00+11:00" })).toBe("lapses 2026-11-17T00:00:00+11:00");
    expect(renderPlanLapse({ lapsesAtIso: "2020-01-01T00:00:00Z" })).toBe("lapses 2020-01-01T00:00:00Z");
  });

  it("says UNRECORDED when nobody has recorded one, rather than printing nothing", () => {
    expect(renderPlanLapse({})).toBe("lapse UNRECORDED");
  });

  const stated = {
    kind: "stated",
    lastCheckedIso: "2026-01-20T10:11:12.654321+00:00",
    paidThroughIso: "2026-02-02T03:04:05.123456+00:00",
  } as const;

  it("prints a provider-stated date in place of UNRECORDED, with when the provider checked it", () => {
    expect(renderPlanLapse({ paidThrough: stated })).toBe(
      "paid through 2026-02-02T03:04:05.123456+00:00 (provider-stated, checked 2026-01-20T10:11:12.654321+00:00)",
    );
  });

  it("drops a recorded lapse that names the same instant, written another way", () => {
    expect(renderPlanLapse({ lapsesAtIso: "2026-02-02T14:04:05.1234560+11:00", paidThrough: stated })).toBe(
      "paid through 2026-02-02T03:04:05.123456+00:00 (provider-stated, checked 2026-01-20T10:11:12.654321+00:00)",
    );
  });

  it("keeps a recorded lapse that differs only below a millisecond, which Date.parse alone would read as equal", () => {
    expect(Date.parse("2026-02-02T03:04:05.123Z")).toBe(Date.parse(stated.paidThroughIso));
    expect(renderPlanLapse({ lapsesAtIso: "2026-02-02T03:04:05.123Z", paidThrough: stated })).toBe(
      "paid through 2026-02-02T03:04:05.123456+00:00 (provider-stated, checked 2026-01-20T10:11:12.654321+00:00)" +
        " · lapses 2026-02-02T03:04:05.123Z DIFFERS",
    );
  });

  it("keeps a recorded lapse that disagrees with the stated date, flagged", () => {
    expect(renderPlanLapse({ lapsesAtIso: "2026-03-01T00:00:00Z", paidThrough: stated })).toBe(
      "paid through 2026-02-02T03:04:05.123456+00:00 (provider-stated, checked 2026-01-20T10:11:12.654321+00:00)" +
        " · lapses 2026-03-01T00:00:00Z DIFFERS",
    );
  });

  it("says a failed provider read was UNREAD and keeps the recorded clause beside it", () => {
    const unread = { kind: "unread", reason: "no sign-in" } as const;

    expect(renderPlanLapse({ paidThrough: unread })).toBe("paid through UNREAD (no sign-in) · lapse UNRECORDED");
    expect(renderPlanLapse({ lapsesAtIso: "2026-03-01T00:00:00Z", paidThrough: unread })).toBe(
      "paid through UNREAD (no sign-in) · lapses 2026-03-01T00:00:00Z",
    );
  });
});

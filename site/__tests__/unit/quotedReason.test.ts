import { describe, expect, it } from "vitest";
import { leadBeforeReason, reasonTextOf, withLeadsMapped } from "../../lib/quotedReason";

describe("reasonTextOf", () => {
  it("keeps the console's own words as themselves", () => {
    expect(reasonTextOf({ reason: "the board is loading" })).toBe("the board is loading");
  });

  it("sets each quoted reason after its lead, for a mark that folds the raw itself", () => {
    expect(
      reasonTextOf({
        reason: [
          { lead: "GitHub's open list for acme/app could not be read", why: "HTTP 429 Too Many Requests" },
          { lead: "GitHub's open list for acme/web could not be read", why: "GitHub answered 502" },
        ],
      }),
    ).toBe(
      "GitHub's open list for acme/app could not be read: HTTP 429 Too Many Requests; GitHub's open list for acme/web could not be read: GitHub answered 502",
    );
  });

  it("says an empty list of quoted reasons as nothing", () => {
    expect(reasonTextOf({ reason: [] })).toBe("");
  });
});

describe("withLeadsMapped", () => {
  const closed = (words: string): string => `${words}, so this card cannot be drawn`;

  it("re-frames the console's own sentence whole", () => {
    expect(withLeadsMapped({ lead: closed, reason: "no quote is stored" })).toBe(
      "no quote is stored, so this card cannot be drawn",
    );
  });

  it("re-frames each lead and passes every raw reason through byte for byte", () => {
    expect(
      withLeadsMapped({
        lead: closed,
        reason: [{ lead: "the quote does not read", why: "  ENOENT: no such file\n  at read (x.ts:1)" }],
      }),
    ).toEqual([
      {
        lead: "the quote does not read, so this card cannot be drawn",
        why: "  ENOENT: no such file\n  at read (x.ts:1)",
      },
    ]);
  });
});

describe("leadBeforeReason", () => {
  it("closes a bare lead with a full stop, so the plain reason reads as its own sentence", () => {
    expect(leadBeforeReason({ lead: "The board did not read" })).toBe("The board did not read. ");
  });

  it("keeps a lead's own closing punctuation and drops its trailing space", () => {
    expect(
      ["Did the board read?  ", "The board did not read:", "The board did not read.", "Read failed;"].map((lead) =>
        leadBeforeReason({ lead }),
      ),
    ).toEqual(["Did the board read? ", "The board did not read: ", "The board did not read. ", "Read failed; "]);
  });

  it("closes an empty lead as a lone full stop, the boundary case a caller never sends", () => {
    expect(leadBeforeReason({ lead: "" })).toBe(". ");
  });
});

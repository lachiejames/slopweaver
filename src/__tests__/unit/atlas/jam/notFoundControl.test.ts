/**
 * The oracle that tells Jam's rendered not-found page apart from a real one.
 *
 * Every byte length here is synthetic, chosen to reproduce the SHAPE live walks produced, because the
 * spread is the point: within one run the not-found page sits inside 1% of its control, and across runs the
 * control itself moves several percent because the page animates. That is why the band is taken from the
 * same run's control rather than baked in, and this file fails if it ever stops separating the two things
 * it was measured against.
 */
import { describe, expect, it } from "vitest";

import {
  jamLooksLikeNotFound,
  NOT_FOUND_BAND,
  notFoundControlBytes,
  notFoundControlsAgree,
} from "../../../../atlas/jam/notFoundControl.js";

/** The control's own screenshot, a synthetic round size. */
const CONTROL_BYTES = 100_000;

/** Build one candidate without restating the shape at every call site. */
function candidate({ surface, bytes }: { surface: string; bytes: number | null }): {
  artifacts: readonly { byteLength: number }[];
  surface: string;
} {
  return { artifacts: bytes === null ? [] : [{ byteLength: bytes }], surface };
}

describe("notFoundControlBytes", () => {
  it("reads the control's own screenshot size off the walk", () => {
    const bytes = notFoundControlBytes({
      controlSurface: "not-found-control",
      pages: [
        candidate({ bytes: 250_000, surface: "overview" }),
        candidate({ bytes: CONTROL_BYTES, surface: "not-found-control" }),
      ],
    });
    expect(bytes).toBe(CONTROL_BYTES);
  });

  it("answers null when the control was never visited", () => {
    expect(
      notFoundControlBytes({
        controlSurface: "not-found-control",
        pages: [candidate({ bytes: 250_000, surface: "overview" })],
      }),
    ).toBe(null);
  });

  it("answers null when the control was visited and not photographed, rather than defaulting", () => {
    expect(
      notFoundControlBytes({
        controlSurface: "not-found-control",
        pages: [candidate({ bytes: null, surface: "not-found-control" })],
      }),
    ).toBe(null);
  });
});

describe("jamLooksLikeNotFound", () => {
  it("catches every not-found render of one walk, each a different size inside 1% of the control", () => {
    const notFound = [99_300, 99_400, 99_550, 99_700, 99_850, 100_050, 100_200, 100_400, 100_600];
    for (const bytes of notFound) {
      expect(jamLooksLikeNotFound({ controlBytes: CONTROL_BYTES, page: candidate({ bytes, surface: "x" }) })).toBe(
        true,
      );
    }
  });

  it("catches the control itself, which is what proves the check can fire", () => {
    expect(
      jamLooksLikeNotFound({
        controlBytes: CONTROL_BYTES,
        page: candidate({ bytes: CONTROL_BYTES, surface: "not-found-control" }),
      }),
    ).toBe(true);
  });

  it("clears every real application page of the same walk", () => {
    const realPages = [112_000, 160_000, 175_000, 215_000, 930_000];
    for (const bytes of realPages) {
      expect(jamLooksLikeNotFound({ controlBytes: CONTROL_BYTES, page: candidate({ bytes, surface: "s/x" }) })).toBe(
        false,
      );
    }
  });

  it("still clears them against a LATER walk's control, which came back 5% larger", () => {
    const laterControl = 105_000;
    // The two nearest real pages either side of that control: a nearly empty subscription tab well below,
    // and the same account tab as before, now much nearer above. That nearer distance is the margin this rule
    // actually has, rather than the wider one a single run suggested.
    for (const bytes of [88_000, 112_000, 150_000, 160_000, 920_000]) {
      expect(jamLooksLikeNotFound({ controlBytes: laterControl, page: candidate({ bytes, surface: "s/x" }) })).toBe(
        false,
      );
    }
    expect(
      jamLooksLikeNotFound({ controlBytes: laterControl, page: candidate({ bytes: laterControl, surface: "c" }) }),
    ).toBe(true);
  });

  // The first walk after the invented control moved to the bare origin. The nearest real page is the account
  // tab again, just outside the band above the anchor: the thinnest margin this band has been measured at.
  it("separates the bare-origin anchor's walk: both controls in, every real page out", () => {
    const anchor = 101_000;
    expect(notFoundControlsAgree({ anchorBytes: anchor, declaredBytes: 100_000 })).toBe(null);
    expect(jamLooksLikeNotFound({ controlBytes: anchor, page: candidate({ bytes: 100_000, surface: "c" }) })).toBe(
      true,
    );
    const realPages = [88_000, 107_000, 150_000, 160_000, 163_000, 175_000, 215_000, 245_000, 860_000];
    expect(
      realPages.filter((bytes) =>
        jamLooksLikeNotFound({ controlBytes: anchor, page: candidate({ bytes, surface: "s/x" }) }),
      ),
    ).toEqual([]);
  });

  it("clears a page with no screenshot at all, because there is nothing to compare", () => {
    expect(jamLooksLikeNotFound({ controlBytes: CONTROL_BYTES, page: candidate({ bytes: null, surface: "x" }) })).toBe(
      false,
    );
  });

  it("holds the band exactly at its stated edges", () => {
    const edge = Math.floor(CONTROL_BYTES * (1 + NOT_FOUND_BAND));
    expect(jamLooksLikeNotFound({ controlBytes: CONTROL_BYTES, page: candidate({ bytes: edge, surface: "x" }) })).toBe(
      true,
    );
    expect(
      jamLooksLikeNotFound({ controlBytes: CONTROL_BYTES, page: candidate({ bytes: edge + 5_000, surface: "x" }) }),
    ).toBe(false);
  });
});

describe("notFoundControlsAgree", () => {
  it("agrees when the two controls rendered the same-sized page", () => {
    expect(notFoundControlsAgree({ anchorBytes: CONTROL_BYTES, declaredBytes: CONTROL_BYTES })).toBe(null);
    expect(notFoundControlsAgree({ anchorBytes: 100_000, declaredBytes: 100_600 })).toBe(null);
  });

  it("REFUSES on the counterexample: /404 becomes a real page", () => {
    const why = notFoundControlsAgree({ anchorBytes: 100_000, declaredBytes: 200_000 });
    expect(why).toContain("do not corroborate each other");
    expect(why).toContain("serving something real at /404");
  });

  it("names both sizes and the drift, so a reader can judge it without re-running the walk", () => {
    const why = notFoundControlsAgree({ anchorBytes: 100_000, declaredBytes: 120_000 });
    expect(why).toContain("100000");
    expect(why).toContain("120000");
    expect(why).toContain("20.0%");
  });

  it("refuses a drift just outside the band and allows one just inside it", () => {
    const edge = Math.floor(100_000 * (1 + NOT_FOUND_BAND));
    expect(notFoundControlsAgree({ anchorBytes: 100_000, declaredBytes: edge })).toBe(null);
    expect(notFoundControlsAgree({ anchorBytes: 100_000, declaredBytes: edge + 100 })).not.toBe(null);
  });
});

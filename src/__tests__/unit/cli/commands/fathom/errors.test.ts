/**
 * Unit: the `fathom share` run's typed failures — each factory's code, and the message a caller prints.
 */
import { describe, expect, it } from "vitest";

import { FathomCommandErrors } from "../../../../../cli/commands/fathom/errors.js";
import { FathomShareErrors } from "../../../../../corpus/fathom/shareErrors.js";

const URL = "https://fathom.video/share/cPAstBybUhyaoL9wD_xuMQK_byssuMG_";

describe("FathomCommandErrors", () => {
  it("carries the page's own refusal whole, and prints its code beside its message", () => {
    const cause = FathomShareErrors.transcriptAbsent({ url: URL });
    const error = FathomCommandErrors.pageRefused({ cause });
    expect(error.code).toBe("PAGE_REFUSED");
    expect(error.cause).toBe(cause);
    expect(error.message).toBe(`TRANSCRIPT_ABSENT: ${cause.message}`);
  });

  it("joins a multi-line transport or bronze failure into one message", () => {
    expect(FathomCommandErrors.pageUnread({ problems: ["a", "b"] })).toEqual({ code: "PAGE_UNREAD", message: "a; b" });
    expect(FathomCommandErrors.bronzeWriteFailed({ problems: ["disk full"] })).toEqual({
      code: "BRONZE_WRITE_FAILED",
      message: "disk full",
    });
  });

  it("says bronze already holds the transcript when only the store leg failed", () => {
    expect(FathomCommandErrors.storeLegFailed({ problems: ["no store"] }).message).toBe(
      "bronze holds the transcript, but the store leg failed: no store",
    );
  });

  it("names the address the denylist excluded", () => {
    expect(FathomCommandErrors.denylistExcluded({ url: URL })).toEqual({
      code: "DENYLIST_EXCLUDED",
      message: `the sync denylist excluded this call's host, so nothing was stored for ${URL}`,
      url: URL,
    });
  });
});

/**
 * Unit: the share page's typed failures — one code per next action, and a message that names it.
 */
import { describe, expect, it } from "vitest";

import { FathomShareErrors } from "../../../../corpus/fathom/shareErrors.js";

const URL = "https://fathom.video/share/cPAstBybUhyaoL9wD_xuMQK_byssuMG_";

describe("FathomShareErrors", () => {
  it("names where the browser landed when it never reached the share page", () => {
    const landedOn = "https://fathom.video/users/sign_in?share_token=x";
    const error = FathomShareErrors.notShown({ landedOn, url: URL });
    expect(error.code).toBe("NOT_SHOWN");
    expect(error.landedOn).toBe(landedOn);
    expect(error.message).toContain(`landed on ${landedOn}`);
  });

  it("points a changed page at the snippet that reads it", () => {
    const error = FathomShareErrors.shapeChanged({ url: URL, what: "the call carries no numeric id" });
    expect(error).toEqual({
      code: "SHAPE_CHANGED",
      message: `${URL}: the call carries no numeric id — Fathom's share page no longer has the shape browser/fathomShareSnippet.ts reads`,
      url: URL,
    });
  });

  it("reads a page with no spoken line as Fathom still processing", () => {
    expect(FathomShareErrors.transcriptAbsent({ url: URL })).toEqual({
      code: "TRANSCRIPT_ABSENT",
      message: `${URL} carries no spoken line yet — Fathom may still be processing the recording`,
      url: URL,
    });
  });

  it("names why an address is not a share link", () => {
    const error = FathomShareErrors.urlInvalid({ url: "nope", why: "it is not a URL" });
    expect(error.code).toBe("URL_INVALID");
    expect(error.message).toBe("nope is not a Fathom share link (https://fathom.video/share/<token>): it is not a URL");
  });
});

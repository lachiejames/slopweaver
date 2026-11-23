/** Unit: the evidence pipeline's typed failures, and the one-line-per-problem view a printer reads. */
import { describe, expect, it } from "vitest";

import { unwrapErr } from "../../../lib/result.js";
import { captionBelow } from "../../../visualEvidence/annotate.js";
import { VisualEvidenceErrors, visualEvidenceErrorLines } from "../../../visualEvidence/evidenceErrors.js";

describe("visualEvidenceErrorLines", () => {
  it("gives a refused region list back one entry per line, never the joined message", () => {
    const error = VisualEvidenceErrors.regionsRefused({
      reasons: ["region 'flat' has no area (10x0)", "region 'below' lies outside the 2016x883 frame"],
    });
    expect(visualEvidenceErrorLines({ error })).toEqual([
      "region 'flat' has no area (10x0)",
      "region 'below' lies outside the 2016x883 frame",
    ]);
    expect(error.message).toBe("region 'flat' has no area (10x0); region 'below' lies outside the 2016x883 frame");
  });

  it("gives a refused caption back one bound per line, off the real captioner", async () => {
    const error = unwrapErr(await captionBelow({ bytes: new Uint8Array(), lines: [" ", "x".repeat(300)] }));
    expect(error.code).toBe("CAPTION_REFUSED");
    expect(visualEvidenceErrorLines({ error })).toEqual([
      "a caption line cannot be blank",
      "a caption line may carry at most 240 characters, got 300",
    ]);
  });

  it("gives a single-line failure back as its message alone", () => {
    const error = VisualEvidenceErrors.noRegions();
    expect(visualEvidenceErrorLines({ error })).toEqual(["a crop needs at least one required region"]);
    expect(error.code).toBe("NO_REGIONS");
  });
});

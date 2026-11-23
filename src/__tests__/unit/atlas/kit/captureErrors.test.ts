/**
 * The atlas kit's capture failures: each factory renders the exact text the `readonly string[]` it replaced
 * carried, and {@link atlasCaptureErrorLines} gives a list variant one line per problem, in order.
 */
import { describe, expect, it } from "vitest";

import { AtlasCaptureErrors, atlasCaptureErrorLines } from "../../../../atlas/kit/captureErrors.js";

describe("AtlasCaptureErrors", () => {
  it("prints a walk that missed its declared pages as the count line, then the not-published line", () => {
    const error = AtlasCaptureErrors.walkCoverageMismatch({ duplicated: 1, missing: 2, undeclared: 3 });
    expect(error.code).toBe("WALK_COVERAGE_MISMATCH");
    expect(atlasCaptureErrorLines({ error })).toEqual([
      "this walk does not cover the declared page list: 2 declared page(s) absent, 3 row(s) for a page that is " +
        "not declared, 1 duplicated row(s)",
      "nothing was published — a publisher that graded this against its own array would report full coverage " +
        "over whatever it was handed",
    ]);
  });

  it("keeps the backticks around paths in the no-paths refusal", () => {
    const error = AtlasCaptureErrors.openApiNoPaths({ specId: "hex-public" });
    expect(atlasCaptureErrorLines({ error })).toEqual([
      "hex-public declares no `paths` object — refusing rather than reporting an empty surface",
    ]);
  });

  it("prints a non-success HTTP status as the bare status line", () => {
    const error = AtlasCaptureErrors.pinnedHttpStatus({ status: 404 });
    expect(error.code).toBe("PINNED_HTTP_STATUS");
    expect(atlasCaptureErrorLines({ error })).toEqual(["HTTP 404"]);
  });

  it("names both byte counts when a stored screenshot is not the captured size", () => {
    const error = AtlasCaptureErrors.screenshotSizeMismatch({ captured: 10, onDisk: 7, relativePath: "shots/a.png" });
    expect(error.message).toBe("the screenshot at shots/a.png is 7 bytes on disk against the 10 that were captured");
  });

  it("forwards a refused screenshot write one line per reason", () => {
    const error = AtlasCaptureErrors.screenshotWriteRefused({ reasons: ["first", "second"] });
    expect(atlasCaptureErrorLines({ error })).toEqual(["first", "second"]);
  });
});

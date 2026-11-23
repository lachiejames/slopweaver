/*
 * `landedCommitsOf` — reading `git log`'s squash history into landed commits, and refusing the whole history on one
 * malformed line. It moved here when `fleet landed`'s pure-join tests were split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { landedCommitsOf } from "../../../../fleet/landed.js";
import { LandedErrors } from "../../../../fleet/landedErrors.js";
import { unwrap } from "../../../../lib/result.js";
import { SHA_A } from "./harness.js";

const SHA_B = "b".repeat(40);

describe("landedCommitsOf", () => {
  it("reads sha, instant and a subject that itself carries a tab", () => {
    const text = `${SHA_A}\t2026-10-05T02:54:54Z\tOne (#1843)\n${SHA_B}\t2026-10-05T02:49:03Z\tTwo\tthree (#1844)\n`;
    expect(unwrap(landedCommitsOf({ text }))).toEqual([
      { mergedIso: "2026-10-05T02:54:54Z", sha: SHA_A, subject: "One (#1843)" },
      { mergedIso: "2026-10-05T02:49:03Z", sha: SHA_B, subject: "Two\tthree (#1844)" },
    ]);
  });

  it("reads an empty history as no landings", () => {
    expect(unwrap(landedCommitsOf({ text: "" }))).toEqual([]);
  });

  it("refuses the whole history on one line that is not the shape, naming it", () => {
    const text = `${SHA_A}\t2026-10-05T02:54:54Z\tOne (#1843)\nabc\tnot a time\tTwo\n`;
    const read = landedCommitsOf({ text });
    expect(read._unsafeUnwrapErr()).toEqual(LandedErrors.gitLineMalformed({ line: "abc\tnot a time\tTwo" }));
  });
});

/**
 * Every spelling canon uses for a measurement anchor resolves to one lookup key, a bare hash to the body, and
 * an anchor that cites no measurement file is refused with the reason.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { resolveMeasurementRef } from "../../../../store/fleet/measurementAnchor.js";

const HOME = "/Users/someone/.slopweaver";
const PATH = "evidence/sup-3534/console-draft.png";
const SHA = "a".repeat(64);

describe("resolveMeasurementRef", () => {
  it.each([
    [`~/.slopweaver/${PATH}`],
    [`$SLOPWEAVER_HOME/${PATH}`],
    [`${HOME}/${PATH}`],
    [PATH],
    [`${PATH}#shot-2`],
    [`state:${PATH}`],
  ])("reads %s as the one path under the home", (ref) => {
    expect(unwrap(resolveMeasurementRef({ home: HOME, ref }))).toEqual({ kind: "path", relativePath: PATH });
  });

  it("reads a bare 64-hex token as the body's own hash", () => {
    expect(unwrap(resolveMeasurementRef({ home: HOME, ref: SHA }))).toEqual({ bodySha256: SHA, kind: "sha" });
  });

  it("refuses a transcript anchor, which cites no file", () => {
    const error = unwrapErr(resolveMeasurementRef({ home: HOME, ref: "transcript:a0000007#33dac8fe" }));

    expect(error.code).toBe("UNSTORABLE_MEASUREMENT");
    expect(error.message).toContain("names a transcript or other record, not a file");
  });

  it("refuses an absolute path outside the home", () => {
    expect(unwrapErr(resolveMeasurementRef({ home: HOME, ref: `/tmp/${PATH}` })).message).toContain(
      "outside the state home",
    );
  });

  it("refuses a path under the home that is not one of the four roots", () => {
    expect(unwrapErr(resolveMeasurementRef({ home: HOME, ref: "datadog/hits.jsonl" })).message).toContain(
      "not a file under bakeoff/, datadog-shots/, evidence/ or proof/",
    );
  });
});

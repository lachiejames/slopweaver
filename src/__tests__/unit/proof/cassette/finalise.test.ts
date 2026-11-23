import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseProbedSize } from "../../../../proof/cassette/finalise.js";

describe("parseProbedSize", () => {
  it("reads the WIDTHxHEIGHT ffprobe prints, trailing newline included", () => {
    expect(unwrap(parseProbedSize({ text: "1200x600\n" }))).toStrictEqual({ heightPx: 600, widthPx: 1200 });
  });

  it("refuses text that is not one size, and an empty frame", () => {
    expect(unwrapErr(parseProbedSize({ text: "" }))).toStrictEqual(['ffprobe reported no video size: ""']);
    expect(unwrapErr(parseProbedSize({ text: "1200x600\n1200x600" }))[0]).toContain("ffprobe reported no video size");
    expect(unwrapErr(parseProbedSize({ text: "0x600" }))).toStrictEqual([
      "ffprobe reported an empty video frame: 0x600",
    ]);
  });
});

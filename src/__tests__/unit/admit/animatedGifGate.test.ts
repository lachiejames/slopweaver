import { describe, expect, it } from "vitest";

import { ANIMATED_GIF_OVERRIDE, animatedGifFindings } from "../../../admit/animatedGifGate.js";
import { gifWithFrames } from "../../gifFixtures.js";

describe("animatedGifFindings", () => {
  it("refuses a looping recording, naming the frame count and the video route", () => {
    const findings = animatedGifFindings({
      files: [{ bytes: gifWithFrames({ frames: 3, loop: true }), ref: "proof.gif" }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("ANIMATED_GIF");
    expect(findings[0]!.severity).toBe("warn");
    expect(findings[0]!.summary).toBe(
      "proof.gif is an animated GIF (3 frames): it autoplays and loops with no timeline control",
    );
    expect(findings[0]!.correction).toContain("slopweaver proof cassette --tape <tape> --out <name>.mp4");
  });

  it("carries the override token the hatch register names", () => {
    const findings = animatedGifFindings({ files: [{ bytes: gifWithFrames({ frames: 2 }), ref: "a.gif" }] });
    expect(findings.map((finding) => (finding.severity === "warn" ? finding.override : ""))).toStrictEqual([
      ANIMATED_GIF_OVERRIDE,
    ]);
  });

  it("passes a still GIF", () => {
    expect(animatedGifFindings({ files: [{ bytes: gifWithFrames({ frames: 1 }), ref: "still.gif" }] })).toStrictEqual(
      [],
    );
  });

  it("passes a video, whose bytes are not a GIF at all", () => {
    const mp4 = Buffer.from([0, 0, 0, 0x18, ...Buffer.from("ftypisom", "latin1"), 0, 0, 2, 0]);
    expect(animatedGifFindings({ files: [{ bytes: mp4, ref: "proof.mp4" }] })).toStrictEqual([]);
  });

  it("reports each animated file of several, and only those", () => {
    const findings = animatedGifFindings({
      files: [
        { bytes: gifWithFrames({ frames: 2 }), ref: "one.gif" },
        { bytes: gifWithFrames({ frames: 1 }), ref: "still.gif" },
        { bytes: gifWithFrames({ frames: 4 }), ref: "two.gif" },
      ],
    });
    expect(findings.map((finding) => finding.summary.split(" ")[0])).toStrictEqual(["one.gif", "two.gif"]);
  });
});

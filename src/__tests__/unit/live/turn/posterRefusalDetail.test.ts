import { describe, expect, it } from "vitest";
import { answerQualityFindings } from "../../../../admit/answerQualityGate.js";
import { refusalDetail } from "../../../../live/turn/poster.js";

/**
 * What the owner reads in Slack when a turn will not send. The status alone said "warn", which names no
 * cause and no fix — this pins the text that replaced it, through the real gate rather than a literal.
 */
describe("refusalDetail", () => {
  it("names the missing verdict and the fix, in the gate's own words", () => {
    const detail = refusalDetail({
      decision: {
        findings: answerQualityFindings({ answerDigest: `sha256:${"a".repeat(64)}`, verdict: undefined }),
        overridden: [],
        status: "warn",
      },
    });

    expect(detail.split("\n")).toEqual([
      "the door did not admit this (warn). Nothing was changed.",
      "posting this turn's answer blocked because no review verdict accompanies this answer, so nothing but" +
        " its author has read it [ANSWER_UNREVIEWED].",
      "To satisfy it instead: have a different visible session review the answer and supply its verdict",
      "Legitimate exceptions may include the ask genuinely has a one-line answer and the gate is counting" +
        " shape rather than substance; the evidence is a screenshot or a link the gate cannot read as prose.",
      'To override use the designated escape hatch slopweaver hatch open answer-quality --reason "<why this' +
        " one is a legitimate exception>\", then re-run posting this turn's answer.",
      "Use good judgement to determine whether the owner would approve of this, then proceed or correct your approach.",
    ]);
  });

  it("says the door's own verdict line when the door refused with no finding to explain it", () => {
    expect(refusalDetail({ decision: { findings: [], overridden: [], status: "hold" } })).toBe(
      "the door did not admit this (hold). Nothing was changed.",
    );
  });
});

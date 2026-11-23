import { describe, expect, it } from "vitest";

import {
  bandOfShare,
  IMPACT_BANDS,
  type ImpactBand,
  impactBasisSentence,
  impactCell,
  MATRIX_SEVERITIES,
  PRIORITIES,
  PRIORITY_MATRIX,
  priorityOf,
  rankAlerts,
  shareOfImpact,
  topPriority,
} from "../../../../outbound/artifact/priority.js";
import { SEVERITIES, type Severity } from "../../../../outbound/artifact/severity.js";

describe("shareOfImpact — two counted numbers, and the guards that are measurements", () => {
  it("divides the numerator by the denominator", () => {
    expect(shareOfImpact({ reading: { matched: 34, scope: 1000 } })).toBe(0.034);
  });

  it("yields NOTHING for a zero denominator, rather than an infinite blast radius", () => {
    expect(shareOfImpact({ reading: { matched: 12, scope: 0 } })).toBeUndefined();
  });

  it("CLAMPS at 1 when the numerator overtook a denominator read moments apart", () => {
    expect(shareOfImpact({ reading: { matched: 1200, scope: 1000 } })).toBe(1);
  });

  it("is zero when the alert matched nothing at all", () => {
    expect(shareOfImpact({ reading: { matched: 0, scope: 1000 } })).toBe(0);
  });
});

describe("bandOfShare — the decade boundaries a reader already thinks in", () => {
  it("bands ten percent and above as broad", () => {
    expect(bandOfShare({ share: 0.1 })).toBe("broad");
    expect(bandOfShare({ share: 1 })).toBe("broad");
  });

  it("bands one percent up to ten as wide", () => {
    expect(bandOfShare({ share: 0.01 })).toBe("wide");
    expect(bandOfShare({ share: 0.099 })).toBe("wide");
  });

  it("bands a tenth of a percent up to one as narrow", () => {
    expect(bandOfShare({ share: 0.001 })).toBe("narrow");
    expect(bandOfShare({ share: 0.009 })).toBe("narrow");
  });

  it("bands anything smaller, zero included, as slim", () => {
    expect(bandOfShare({ share: 0.0009 })).toBe("slim");
    expect(bandOfShare({ share: 0 })).toBe("slim");
  });

  it("bands an unmeasured share as unknown, which is a band and not a missing value", () => {
    expect(bandOfShare({ share: undefined })).toBe("unknown");
  });
});

describe("priorityOf — every cell of the matrix, because a cell nobody walked is a cell nobody agreed", () => {
  it("declares a priority for every severity and every band", () => {
    expect(MATRIX_SEVERITIES.length).toBeGreaterThan(0);
    expect(IMPACT_BANDS.length).toBeGreaterThan(0);
    const missing = MATRIX_SEVERITIES.flatMap((severity) =>
      IMPACT_BANDS.filter((band) => !PRIORITIES.includes(PRIORITY_MATRIX[severity][band])).map(
        (band) => `${severity}/${band}`,
      ),
    );

    expect(missing).toEqual([]);
  });

  it("reads the same cell through the function as through the table, for every severity", () => {
    expect(SEVERITIES.length).toBeGreaterThan(0);
    const disagreements = SEVERITIES.flatMap((severity: Severity) =>
      IMPACT_BANDS.filter((band: ImpactBand) => priorityOf({ band, severity }) !== PRIORITY_MATRIX[severity][band]).map(
        (band) => `${severity}/${band}`,
      ),
    );

    expect(disagreements).toEqual([]);
  });

  it("makes P0 the red-and-broad cell ALONE, which is what keeps the token worth scanning for", () => {
    const p0 = MATRIX_SEVERITIES.flatMap((severity) =>
      IMPACT_BANDS.filter((band) => PRIORITY_MATRIX[severity][band] === "P0").map((band) => `${severity}/${band}`),
    );

    expect(p0).toEqual(["red/broad"]);
  });

  it("never lets a recovered alert exceed P2, because a recovered alert is history", () => {
    const tooHigh = IMPACT_BANDS.filter(
      (band) => PRIORITIES.indexOf(PRIORITY_MATRIX.green[band]) < PRIORITIES.indexOf("P2"),
    );

    expect(tooHigh).toEqual([]);
  });

  it("ranks an ABSENT severity exactly as a recovered one, because no lifecycle word is not a claim", () => {
    const disagreements = IMPACT_BANDS.filter((band) => PRIORITY_MATRIX.absent[band] !== PRIORITY_MATRIX.green[band]);

    expect(disagreements).toEqual([]);
  });

  it("ranks an unmeasured blast radius where a narrow one ranks, for every severity", () => {
    const disagreements = MATRIX_SEVERITIES.filter(
      (severity) => PRIORITY_MATRIX[severity].unknown !== PRIORITY_MATRIX[severity].narrow,
    );

    expect(disagreements).toEqual(["green", "absent"]);
  });

  it("treats an undefined severity as the absent row", () => {
    expect(priorityOf({ band: "broad", severity: undefined })).toBe("P2");
  });
});

describe("impactCell — the tilde is what marks the number an estimate on the line itself", () => {
  it("prints a measured share to one decimal, behind a tilde", () => {
    expect(impactCell({ share: 0.034 })).toBe("~3.4%");
  });

  it("prints `<0.1%` rather than a rounded zero for a share that is really there", () => {
    expect(impactCell({ share: 0.0004 })).toBe("<0.1%");
  });

  it("prints an exact zero as a zero, because nothing matched is not something small", () => {
    expect(impactCell({ share: 0 })).toBe("~0.0%");
  });

  it("says `impact ?` when nothing measured it, rather than leaving the column blank", () => {
    expect(impactCell({ share: undefined })).toBe("impact ?");
  });
});

describe("rankAlerts — priority first, then blast radius, then noise, then the label", () => {
  it("puts a quiet red-and-broad alert above a very noisy recovered one", () => {
    const ranked = rankAlerts({
      alerts: [
        { count: 4000, label: "backup chatter", severity: "green" },
        { count: 2, impact: { matched: 40, scope: 100 }, label: "checkout down", severity: "red" },
      ],
    });

    expect(ranked.map((entry) => [entry.alert.label, entry.priority])).toEqual([
      ["checkout down", "P0"],
      ["backup chatter", "P4"],
    ]);
  });

  it("breaks a priority tie on the WIDER blast radius, not the louder count", () => {
    const ranked = rankAlerts({
      alerts: [
        { count: 900, impact: { matched: 1, scope: 1000 }, label: "noisy narrow", severity: "red" },
        { count: 3, impact: { matched: 9, scope: 1000 }, label: "quiet wider", severity: "red" },
      ],
    });

    expect(ranked.map((entry) => entry.alert.label)).toEqual(["quiet wider", "noisy narrow"]);
  });

  it("sorts an UNMEASURED row behind every measured row of its own priority", () => {
    const ranked = rankAlerts({
      alerts: [
        { count: 900, label: "unmeasured", severity: "red" },
        { count: 3, impact: { matched: 2, scope: 1000 }, label: "measured", severity: "red" },
      ],
    });

    // Both derive P2 — `unknown` ranks where `narrow` ranks — so what separates them is that a share of nothing
    // measured is not a share of zero.
    expect(ranked.map((entry) => [entry.alert.label, entry.priority])).toEqual([
      ["measured", "P2"],
      ["unmeasured", "P2"],
    ]);
  });

  it("is a TOTAL order: two alerts alike in every rank key fall back to the label", () => {
    const ranked = rankAlerts({
      alerts: [
        { count: 12, label: "zebra", severity: "orange" },
        { count: 12, label: "aardvark", severity: "orange" },
      ],
    });

    expect(ranked.map((entry) => entry.alert.label)).toEqual(["aardvark", "zebra"]);
  });

  it("attaches the share and the band beside each alert, so nothing downstream recomputes them", () => {
    const ranked = rankAlerts({ alerts: [{ count: 1, impact: { matched: 25, scope: 1000 }, label: "one" }] });

    expect(ranked[0]).toEqual({
      alert: { count: 1, impact: { matched: 25, scope: 1000 }, label: "one" },
      band: "wide",
      priority: "P3",
      share: 0.025,
    });
  });
});

describe("topPriority — the token eleven cards are scanned for", () => {
  it("is the most urgent priority present, whatever order the rows arrived in", () => {
    const ranked = rankAlerts({
      alerts: [
        { count: 1, label: "quiet", severity: "green" },
        { count: 1, impact: { matched: 50, scope: 100 }, label: "loud", severity: "orange" },
      ],
    });

    expect(topPriority({ ranked })).toBe("P1");
  });

  it("is nothing at all on a quiet window, because there is no alert for a priority to be about", () => {
    expect(topPriority({ ranked: rankAlerts({ alerts: [] }) })).toBeUndefined();
  });
});

describe("impactBasisSentence — the card admits its estimate in one place", () => {
  it("names what was divided by what, says it is not a user count, and counts the measured rows", () => {
    expect(impactBasisSentence({ measured: 7, query: "monitor", total: 10 })).toBe(
      "Impact is an ESTIMATE: each alert's own MONITOR query as a share of that service's own telemetry volume " +
        "over this window, not a count of users. Measured on 7 of 10.",
    );
  });

  it("names a digest's PROBE query rather than claiming a monitor was rerun", () => {
    expect(impactBasisSentence({ measured: 2, query: "probe", total: 5 })).toBe(
      "Impact is an ESTIMATE: each alert's own PROBE query as a share of that service's own telemetry volume " +
        "over this window, not a count of users. Measured on 2 of 5.",
    );
  });

  it("says nothing at all when nothing on the card was measured, rather than explaining an absent number", () => {
    expect(impactBasisSentence({ measured: 0, query: "monitor", total: 10 })).toBeUndefined();
  });
});

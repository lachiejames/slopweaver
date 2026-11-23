/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { shotDetailLines } from "../../../../../cli/commands/automation/digestShotLines.js";

const LOGS_CITATION =
  "https://ap1.datadoghq.com/logs?query=service%3Aintegrity-audit" +
  "&from_ts=1789472188368&to_ts=1789558588368&live=false";

const STRANDED_CITATION =
  "https://ap1.datadoghq.com/logs?query=service%3Aintegrity-audit%20%40state%3Astranded" +
  "&from_ts=1789472188368&to_ts=1789558588368&live=false";

/** A real integrity-audit card in miniature: two facet-sum rows firing, one count row firing. */
const FORM = JSON.stringify({
  items: [
    {
      citationUrl: `${LOGS_CITATION}&agg_m=%40violations&agg_t=sum`,
      count: 2134,
      severity: "red",
      title: "Chronic violations",
    },
    {
      citationUrl: `${STRANDED_CITATION}&agg_m=%40violations&agg_t=sum`,
      count: 323,
      severity: "red",
      title: "Stranded violations",
    },
    { citationUrl: LOGS_CITATION, count: 140, severity: "orange", title: "AU stranded" },
  ],
  kind: "digest",
  label: "Integrity audit",
  window: "24h",
});

describe("shotDetailLines", () => {
  it("prints no shot command for a facet-sum view, and one for the count view beside it", () => {
    const lines = shotDetailLines({ form: FORM, home: "/nonexistent-home", media: [], recipeId: "integrity-audit" });
    expect(lines[0]).toBe("recipe integrity-audit · shots · 0 image(s) attached for 1 firing view(s)");
    expect(lines.filter((line) => line.includes("slopweaver browser shot"))).toHaveLength(1);
    expect(lines[1]).toContain("recipe integrity-audit · shot 1 · AU stranded · slopweaver browser shot");
    expect(lines.filter((line) => line.startsWith("recipe integrity-audit · no shot · "))).toHaveLength(2);
    expect(lines[2]).toContain("no shot · Chronic violations · ");
    expect(lines[3]).toContain("no shot · Stranded violations · ");
    expect(lines[3]).toContain("takes the sum of @violations");
  });
});

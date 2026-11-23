import { describe, expect, it } from "vitest";

import { digestFormSchema, digestItemsInCardOrder, digestToUpdate } from "../../../../outbound/artifact/digest.js";
import { rankItems } from "../../../../outbound/artifact/digestAlerts.js";
import {
  DIGEST_ALERT_LEAD_VISIBLE_MAX,
  DIGEST_LEAD_VISIBLE_MAX,
  DIGEST_LINE_VISIBLE_MAX,
  type DigestForm,
} from "../../../../outbound/artifact/digestFields.js";
import { DETAIL_PROSE_VISIBLE_MAX, updateArtifactSchema } from "../../../../outbound/artifact/schema.js";
import type { DetailBlock, InlineRun } from "../../../../outbound/artifact/types.js";
import { visibleLengthOfDetail, visibleLengthOfRuns } from "../../../../outbound/artifact/visibleLength.js";

/** An alerts digest in the shape `datadog alert-digest` builds: one broad orange, one narrow red, one green. */
function alertsForm({ trend }: { trend: NonNullable<DigestForm["alerts"]>["trend"] }): DigestForm {
  return {
    alerts: trend === undefined ? {} : { trend },
    items: [
      {
        citationUrl: "https://example.invalid/logs?query=a",
        count: 4,
        impact: { matched: 4, scope: 2000, service: "jobs-api" },
        severity: "red",
        state: "third digest",
        title: "NZ push-token registration",
      },
      {
        citationUrl: "https://example.invalid/logs?query=b",
        count: 300,
        impact: { matched: 300, scope: 1000, service: "jobs-api" },
        severity: "orange",
        title: "purchase-payment-pending 422",
        trend: "rising",
      },
      { count: 0, severity: "green", title: "notification transition race" },
    ],
    kind: "digest",
    label: "Knock",
    lead: "NZ is still dark.",
    window: "24h",
  };
}

/** The plain text of a run sequence, a citation chip read as its id. */
function textOf({ runs }: { runs: readonly InlineRun[] }): string {
  return runs.map((run) => textOfRun({ run })).join("");
}

/** One run's plain text: a citation chip as its id, a run with no text as nothing. */
function textOfRun({ run }: { run: InlineRun }): string {
  if (run.type === "citation") {
    return `[${run.citationId}]`;
  }
  if ("text" in run) {
    return run.text;
  }
  return "";
}

/** The one table a detail carries, or a thrown failure naming its absence. */
function tableOf({ detail }: { detail: readonly DetailBlock[] }): Extract<DetailBlock, { type: "table" }> {
  const found = detail.find((block) => block.type === "table");
  if (found === undefined) {
    throw new Error("the derived detail carries no table");
  }
  return found;
}

/** The same form with the `alerts` block and every item `impact` removed: the triage card it opts out to. */
function triageOf({ form }: { form: DigestForm }): DigestForm {
  return {
    items: form.items.map((item) => ({ count: item.count, severity: item.severity, title: item.title })),
    kind: form.kind,
    label: form.label,
    window: form.window,
  };
}

/** The text of every paragraph in a detail, in order. */
function paragraphsOf({ detail }: { detail: readonly DetailBlock[] }): readonly string[] {
  return detail.filter((block) => block.type === "paragraph").map((block) => textOf({ runs: block.runs }));
}

describe("an ALERTS digest", () => {
  it("ranks by the priority matrix, where a broad orange (P1) sits above a narrow red (P2)", () => {
    const { artifact } = digestToUpdate({
      form: alertsForm({ trend: { priorTotal: 30, priorWindows: 3 } }),
      isKnownPerson: () => false,
    });
    expect(artifact.indexStyle).toBe("ordered");
    expect(artifact.index.map((runs) => textOf({ runs }))).toEqual([
      "🟠 [c1] P1 · purchase-payment-pending 422 · ~30.0% · 300×, rising",
      "🔴 [c2] P2 · NZ push-token registration · ~0.2% · 4×",
      "🟢 P4 · notification transition race · impact ? · 0×",
    ]);
  });

  it("leads its TL;DR with the worst priority and compares the firing total with the baseline", () => {
    const { artifact } = digestToUpdate({
      form: alertsForm({ trend: { priorTotal: 30, priorWindows: 3 } }),
      isKnownPerson: () => false,
    });
    expect(artifact.tldr).toBe(
      "Knock 24h · P1 · 1 red, 1 orange, 1 green. 30.4× the prior 3 windows. NZ is still dark.",
    );
  });

  it("omits the trend clause with no baseline, and says below the fold that nothing was compared", () => {
    const { artifact } = digestToUpdate({ form: alertsForm({ trend: undefined }), isKnownPerson: () => false });
    expect(artifact.tldr).toBe("Knock 24h · P1 · 1 red, 1 orange, 1 green. NZ is still dark.");
    expect(paragraphsOf({ detail: artifact.detail }).at(-1)).toBe("No comparison with the prior windows was made.");
  });

  it("derives the four-column matrix table, with the state riding the issue cell", () => {
    const { artifact } = digestToUpdate({ form: alertsForm({ trend: undefined }), isKnownPerson: () => false });
    const table = tableOf({ detail: artifact.detail });
    expect(table.columns).toEqual(["P", "Issue", "Impact", "24h"]);
    expect(table.rows.map((row) => row.map((cell) => textOf({ runs: cell })))).toEqual([
      ["🟠 P1", "purchase-payment-pending 422", "~30.0%", "300, rising"],
      ["🔴 P2", "NZ push-token registration · third digest", "~0.2%", "4"],
      ["🟢 P4", "notification transition race", "impact ?", "0"],
    ]);
  });

  it("states the impact basis and the raw baseline below the fold", () => {
    const { artifact, warnings } = digestToUpdate({
      form: alertsForm({ trend: { priorTotal: 30, priorWindows: 3 } }),
      isKnownPerson: () => false,
    });
    expect(paragraphsOf({ detail: artifact.detail })).toEqual([
      "Impact is an ESTIMATE: each alert's own PROBE query as a share of that service's own telemetry volume over " +
        "this window, not a count of users. Measured on 2 of 3.",
      "Prior 3 × 24h: 30 counted, 10.0 per window. This window: 304.",
    ]);
    expect(warnings).toEqual([]);
  });

  it("sheds the trend sentence first and the basis second, warning for each, when the prose overflows", () => {
    const loud: DigestForm = {
      ...alertsForm({ trend: { priorTotal: 30, priorWindows: 3 } }),
      items: ["one", "two", "three"].map((id) => ({
        count: 9,
        impact: { matched: 9, scope: 1000, service: "jobs-api" },
        severity: "red" as const,
        substance: `${id} `.repeat(150).trim().slice(0, 590),
        title: `probe ${id}`,
      })),
    };
    const { artifact, warnings } = digestToUpdate({ form: loud, isKnownPerson: () => false });
    expect(warnings).toEqual([
      "the trend-baseline sentence was left off the card's detail so the rest fits the below-fold budget",
      "the impact-basis sentence was left off the card's detail so the rest fits the below-fold budget",
    ]);
    expect(visibleLengthOfDetail({ citations: artifact.citations, detail: artifact.detail })).toBeLessThanOrEqual(
      DETAIL_PROSE_VISIBLE_MAX,
    );
    expect(digestFormSchema.safeParse(loud).success).toBe(true);
  });

  it("says the card is over budget, never that the rest fits, when the items alone overrun the detail", () => {
    const overrun: DigestForm = {
      ...alertsForm({ trend: undefined }),
      items: ["one", "two", "three", "four"].map((id) => ({
        count: 1,
        severity: "red" as const,
        substance: `${id} `.repeat(200).slice(0, 600),
        title: `probe ${id}`,
      })),
    };
    const { artifact, warnings } = digestToUpdate({ form: overrun, isKnownPerson: () => false });
    expect(warnings).toEqual([
      "the card's detail is over the below-fold budget even with its optional sentences left off: the item " +
        "paragraphs and recommendations exceed it on their own, so the door refuses it until one is shortened, unless this session holds a truncated-send grant",
    ]);
    expect(visibleLengthOfDetail({ citations: artifact.citations, detail: artifact.detail })).toBeGreaterThan(
      DETAIL_PROSE_VISIBLE_MAX,
    );
    expect(digestFormSchema.safeParse(overrun).success).toBe(false);
  });

  it("fits its widest possible index line by dropping the item trend, then clipping the title on a whole character", () => {
    const widest: DigestForm = {
      alerts: { trend: { priorTotal: Number.MAX_SAFE_INTEGER, priorWindows: 9 } },
      items: [
        {
          citationUrl: "https://example.invalid/logs?query=a",
          count: Number.MAX_SAFE_INTEGER,
          impact: { matched: 1, scope: 1_000_000_000_000, service: "s".repeat(80) },
          severity: "red",
          ticket: { id: "T".repeat(40), url: "https://example.invalid/T" },
          title: `🔥${"x".repeat(78)}`,
          trend: "r".repeat(40),
        },
      ],
      kind: "digest",
      label: "L".repeat(40),
      lead: "a".repeat(DIGEST_ALERT_LEAD_VISIBLE_MAX),
      window: "w".repeat(12),
    };
    const { artifact } = digestToUpdate({ form: widest, isKnownPerson: () => false });
    const line = artifact.index[0]!;
    expect(visibleLengthOfRuns({ citations: artifact.citations, runs: line })).toBeLessThanOrEqual(
      DIGEST_LINE_VISIBLE_MAX,
    );
    expect(textOf({ runs: line })).not.toContain("rrrr");
    expect(line.some((run) => run.type === "text" && run.bold === true && run.text.endsWith("x…"))).toBe(true);
    expect(updateArtifactSchema.safeParse(artifact).success).toBe(true);
    expect(digestFormSchema.safeParse(widest).success).toBe(true);
  });
});

describe("an ALERTS digest whose firing total cannot be summed exactly", () => {
  it("declines the trend rather than printing a rounded total, and warns", () => {
    const huge: DigestForm = {
      alerts: { trend: { priorTotal: 30, priorWindows: 3 } },
      items: ["a", "b", "c"].map((title) => ({ count: Number.MAX_SAFE_INTEGER, severity: "red" as const, title })),
      kind: "digest",
      label: "Knock",
      window: "24h",
    };
    const { artifact, warnings } = digestToUpdate({ form: huge, isKnownPerson: () => false });
    expect(artifact.tldr).toBe("Knock 24h · P2 · 3 red.");
    expect(paragraphsOf({ detail: artifact.detail }).at(-1)).toBe("No comparison with the prior windows was made.");
    expect(warnings[0]).toBe(
      "no trend: this window's firing total is past the largest safe integer, so it is not compared",
    );
  });
});

describe("the ALERTS opt-in is refused where it cannot be read", () => {
  it("refuses an item impact on a triage digest, naming the field", () => {
    const form = alertsForm({ trend: undefined });
    const parsed = digestFormSchema.safeParse({ items: form.items, kind: "digest", label: "Knock", window: "24h" });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.path.join("."))).toEqual(["items.0.impact", "items.1.impact"]);
  });

  it("caps an alerts lead at the narrower width a triage lead is still allowed", () => {
    const lead = "a".repeat(DIGEST_ALERT_LEAD_VISIBLE_MAX + 1);
    const alerts = digestFormSchema.safeParse({ ...alertsForm({ trend: undefined }), lead });
    expect(alerts.success).toBe(false);
    expect(alerts.error!.issues.map((issue) => issue.path.join("."))).toEqual(["lead"]);
    const triage = digestFormSchema.safeParse({
      items: [{ count: 1, severity: "red", title: "one" }],
      kind: "digest",
      label: "Knock",
      lead,
      window: "24h",
    });
    expect(triage.success).toBe(true);
    expect(DIGEST_LEAD_VISIBLE_MAX).toBeGreaterThan(DIGEST_ALERT_LEAD_VISIBLE_MAX);
  });
});

describe("digestItemsInCardOrder", () => {
  it("is the priority ranking on an alerts card", () => {
    const form = alertsForm({ trend: undefined });
    expect(digestItemsInCardOrder({ form }).map((item) => item.title)).toEqual([
      "purchase-payment-pending 422",
      "NZ push-token registration",
      "notification transition race",
    ]);
  });

  it("is worst severity first on a triage card", () => {
    const triage = triageOf({ form: alertsForm({ trend: undefined }) });
    expect(digestItemsInCardOrder({ form: triage }).map((item) => item.title)).toEqual([
      "NZ push-token registration",
      "purchase-payment-pending 422",
      "notification transition race",
    ]);
  });
});

describe("rankItems", () => {
  it("ranks the broad orange above the narrow red: impact outranks severity on the matrix", () => {
    const ranked = rankItems({ items: alertsForm({ trend: undefined }).items });
    expect(ranked.map((alert) => [alert.alert.label, alert.priority])).toEqual([
      ["purchase-payment-pending 422", "P1"],
      ["NZ push-token registration", "P2"],
      ["notification transition race", "P4"],
    ]);
  });
});

describe("an ALERTS digest with more items than the index holds", () => {
  it("keeps the evidence and ticket of an item ranked past the index, below the fold", () => {
    const broad = Array.from({ length: 9 }, (_unused, position) => ({
      count: 100,
      impact: { matched: 50, scope: 100, service: "svc" },
      severity: "orange" as const,
      title: `broad ${String(position + 1)}`,
    }));
    const form: DigestForm = {
      alerts: {},
      items: [
        {
          citationUrl: "https://example.invalid/red-evidence",
          count: 1,
          impact: { matched: 1, scope: 1000, service: "svc" },
          severity: "red",
          ticket: { id: "RED-1", url: "https://example.invalid/RED-1" },
          title: "red narrow issue",
        },
        ...broad,
      ],
      kind: "digest",
      label: "X",
      window: "24h",
    };
    const { artifact } = digestToUpdate({ form, isKnownPerson: () => false });
    expect(artifact.index.length).toBe(9);
    expect(artifact.citations).toEqual([{ id: "c1", label: "[1]", url: "https://example.invalid/red-evidence" }]);
    expect(artifact.detail.filter((block) => block.type === "paragraph").slice(0, 1)).toEqual([
      {
        runs: [
          { citationId: "c1", type: "citation" },
          { text: " ", type: "text" },
          { label: "RED-1", type: "link", url: "https://example.invalid/RED-1" },
          { text: " ", type: "text" },
          { text: "red narrow issue", type: "text" },
        ],
        type: "paragraph",
      },
    ]);
    expect(updateArtifactSchema.safeParse(artifact).success).toBe(true);
  });
});

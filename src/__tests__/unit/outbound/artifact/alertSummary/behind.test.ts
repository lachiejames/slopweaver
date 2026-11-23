/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import {
  ALERT_SUMMARY_COUNT_MAX,
  ALERT_SUMMARY_LABEL_MAX,
  ALERT_SUMMARY_LEAD_VISIBLE_MAX,
  ALERT_SUMMARY_ROW_LABEL_MAX,
  type AlertSummaryForm,
  alertSummaryFormSchema,
  alertSummaryToUpdate,
  withoutQuotedFlags,
} from "../../../../../outbound/artifact/alertSummary.js";
import {
  BULLET_ITEM_VISIBLE_MAX,
  TABLE_MAX_ROWS,
  updateArtifactSchema,
} from "../../../../../outbound/artifact/schema.js";
import { visibleLengthOfDetail } from "../../../../../outbound/artifact/visibleLength.js";
import { DETAIL_PROSE_VISIBLE_MAX } from "../../../../../outbound/assistant/contentLimits.js";
import { everyRun, labelsOf, NO_TREND_SENTENCE, paragraphTexts, tallyForm, widthOf } from "./harness.js";

describe("alertSummaryToUpdate — the `behind it` section, which is the telemetry half of the card", () => {
  const behindForm = (): AlertSummaryForm => ({
    ...tallyForm(),
    behind: [
      {
        citationUrl: "https://ap1.datadoghq.com/logs?query=x",
        events: 485,
        groups: [
          { count: 474, name: "jobs-api" },
          { count: 11, name: "core-api" },
        ],
        monitor: "Worker lease stalled",
      },
    ],
  });

  it("names the monitor, the events its own query matched, and each group's share", () => {
    const artifact = alertSummaryToUpdate({ form: behindForm() });
    const lines = artifact.detail.findLast((block) => block.type === "list")!;

    expect(paragraphTexts({ detail: artifact.detail })).toContain(
      "Behind the noisiest monitors: each one's own Datadog query, rerun over the last 7d, by service.",
    );
    expect(
      (lines.type === "list" ? lines.items : [])
        .map((runs) => runs.map((run) => (run.type === "text" ? run.text : "")).join(""))
        .join(""),
    ).toBe(" Worker lease stalled · 485 matching event(s): jobs-api 97.7%, core-api 2.3%");
  });

  it("continues the row citations' numbering rather than restarting it", () => {
    const artifact = alertSummaryToUpdate({ form: behindForm() });

    // One row of the reference tally carries a query URL, so the behind entry is the SECOND citation.
    expect(artifact.citations.map((citation) => [citation.label, citation.url])).toEqual([
      ["[1]", "https://example.invalid/logs?q=timeout"],
      ["[2]", "https://ap1.datadoghq.com/logs?query=x"],
    ]);
  });

  it("still states the trend's absence beside a behind section, because the two answer different questions", () => {
    // The old assertion here was that a filler line (`Every alert this window fired is listed above.`) gave way
    // once the card had something more to show. That line is gone; the sentence in its structural place is a
    // CLAIM about the baseline, so it does not give way to a telemetry reading — it sits beside one.
    expect(paragraphTexts({ detail: alertSummaryToUpdate({ form: behindForm() }).detail })).toContain(
      NO_TREND_SENTENCE,
    );
  });

  it("derives a card the layout schema accepts with a full tally and a full behind section", () => {
    const rows = Array.from({ length: TABLE_MAX_ROWS }, (_unused, index) => ({
      citationUrl: `https://example.invalid/logs?q=${String(index)}`,
      count: TABLE_MAX_ROWS - index,
      label: `monitor number ${String(index)} with a fairly long name`,
    }));
    const form = alertSummaryFormSchema.parse({
      ...behindForm(),
      behind: [
        { ...behindForm().behind![0]!, monitor: "x".repeat(ALERT_SUMMARY_ROW_LABEL_MAX) },
        {
          citationUrl: "https://ap1.datadoghq.com/logs?query=y",
          events: 3,
          groups: [{ count: 3, name: "y".repeat(40) }],
          monitor: "z".repeat(ALERT_SUMMARY_ROW_LABEL_MAX),
        },
      ],
      rows,
    });
    const artifact = alertSummaryToUpdate({ form });

    expect(updateArtifactSchema.safeParse(withoutQuotedFlags({ artifact })).success).toBe(true);
    // Ten row chips plus two behind chips. This used to land EXACTLY on a 12 `behindSection` borrowed from
    // the answer form's CITATIONS_MAX, and the comment here reasoned about a drop branch that is now gone:
    // `updateArtifactSchema` puts no maximum on `citations` at all, so there was never a refusal to avoid.
    // The count below is unchanged because no chip was being dropped at this width either way — the test
    // that proves the removal is "keeps every behind chip past the twelve".

    expect(artifact.citations.length).toBe(12);
  });

  // MEASURED here: with the recommendations lane present this card emits 17 chips — ten rows, two behind
  // entries, five recommendations, IN THAT ORDER — which is what `CHIP_VISIBLE_WIDTH`'s two-digit reasoning
  // now rests on, and it is also what disproves the story the removed `> CITATIONS_MAX` branch told. The
  // behind chips are [11] and [12] whatever the recommendations lane does, because it numbers after them, so
  // that branch was unreachable rather than harmful. This case is the guard: it reddens the day a lane is
  // reordered or a row cap is raised, which is the only way the borrowed ceiling would ever have bitten.
  it("keeps every behind chip past the twelve the answer form's cap used to borrow", () => {
    const form = alertSummaryFormSchema.parse({
      behind: ["a", "b"].map((key) => ({
        citationUrl: `https://ap1.datadoghq.com/logs?query=${key}`,
        events: 40,
        groups: [{ count: 30, name: `svc-${key}` }],
        monitor: `Worker lease stalled ${key}`,
      })),
      kind: "alert-summary",
      label: "Gateway",
      recommendations: [1, 2, 3, 4, 5].map((n) => ({
        act: "tune-monitor",
        change: `raise the pooler threshold ${String(n)}`,
        evidenceUrl: `https://example.invalid/e${String(n)}`,
        finding: "red",
      })),
      rows: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
        citationUrl: `https://example.invalid/r${String(n)}`,
        count: 90 - n,
        label: `alert ${String(n)}`,
      })),
      skipped: 0,
      window: "7d",
    });
    const artifact = alertSummaryToUpdate({ form });

    expect(updateArtifactSchema.safeParse(withoutQuotedFlags({ artifact })).success).toBe(true);
    // The behind readings sit at [11] and [12] — the exact number the borrowed ceiling stopped at, so this is
    // the boundary case rather than a comfortable one.
    expect(artifact.citations.length).toBe(17);
    expect(artifact.citations.slice(10, 12).map((citation) => [citation.label, citation.url])).toEqual([
      ["[11]", "https://ap1.datadoghq.com/logs?query=a"],
      ["[12]", "https://ap1.datadoghq.com/logs?query=b"],
    ]);
    // And the five recommendations number past it, which is where a two-digit chip actually comes from.
    expect(artifact.citations.slice(-1).map((citation) => [citation.label, citation.url])).toEqual([
      ["[17]", "https://example.invalid/e5"],
    ]);
    // Falsifiable the other way: every one of the 17 is REFERENCED, so none is an orphan the door would refuse.
    const cited = new Set(
      everyRun({ artifact })
        .filter((run) => run.type === "citation")
        .map((run) => run.citationId),
    );
    expect(artifact.citations.filter((citation) => !cited.has(citation.id)).map((citation) => citation.label)).toEqual(
      [],
    );
  });

  // MEASURED by a review pass: three long service names like the ones below derived a list item over the
  // 200 cap, and the card is REFUSED rather than truncated — so a
  // SUCCESSFUL Datadog read was what stopped the whole tally posting. The groups give way now, in order.
  it("never derives a behind line over the per-item cap, whatever the group names are", () => {
    const widest = [
      "acme-nightly-job-rebuild-search-index-for-archived-rows",
      "acme-nightly-job-purge-expired-upload-sessions",
      "acme-nightly-job-compact-event-log-into-archives",
      "z".repeat(ALERT_SUMMARY_ROW_LABEL_MAX),
    ];
    const over = [1, 2, 3, 4].map((groups) => {
      const form = alertSummaryFormSchema.parse({
        ...tallyForm(),
        behind: [
          {
            citationUrl: "https://ap1.datadoghq.com/logs?query=x",
            events: 489,
            groups: widest.slice(0, Math.min(groups, 3)).map((name, index) => ({ count: 100 - index, name })),
            monitor: "Worker lease stalled — scheduler pausing or delaying batch run",
          },
        ],
      });
      const artifact = alertSummaryToUpdate({ form });
      const labels = labelsOf({ artifact });
      const items = artifact.detail.findLast((block) => block.type === "list")!;
      const widths = (items.type === "list" ? items.items : []).map((runs) => widthOf({ labels, runs }));
      return { groups, over: widths.filter((width) => width > BULLET_ITEM_VISIBLE_MAX) };
    });

    expect(over).toEqual([1, 2, 3, 4].map((groups) => ({ groups, over: [] })));
  });

  it("keeps the monitor readable and the count intact when the groups do not fit", () => {
    const form = alertSummaryFormSchema.parse({
      ...tallyForm(),
      behind: [
        {
          events: 489,
          groups: [
            { count: 200, name: "acme-nightly-job-rebuild-search-index-for-archived-rows" },
            { count: 180, name: "acme-nightly-job-purge-expired-upload-sessions" },
            { count: 109, name: "acme-nightly-job-compact-event-log-into-archives" },
          ],
          monitor: "Worker lease stalled — scheduler pausing or delaying batch run",
        },
      ],
    });
    const items = alertSummaryToUpdate({ form }).detail.findLast((block) => block.type === "list")!;
    const line = (items.type === "list" ? items.items : [])
      .map((runs) => runs.map((run) => (run.type === "text" ? run.text : "")).join(""))
      .join("");

    // Two group names fit once the monitor label gives way, and the label still reads as itself: the trim
    // floor is what stops it collapsing to one character, and the count clause is never touched.
    expect(line).toBe(
      "Worker lease stalled — scheduler pausing or delaying batch… · 489 matching event(s): " +
        "acme-nightly-job-rebuild-search-index-for-archived-rows 40.9%, " +
        "acme-nightly-job-purge-expired-upload-sessions 36.8%",
    );
  });

  // A review pass measured this: the blocks were dropped on a quiet window while their citations were kept,
  // so the card carried a chip nothing cited and the layout schema refused the whole thing — a successful
  // Datadog read stopping the card again, by a second route.
  it("keeps the behind section on a QUIET window, so its citation is never left uncited", () => {
    const form = alertSummaryFormSchema.parse({
      ...tallyForm(),
      behind: [
        {
          citationUrl: "https://ap1.datadoghq.com/logs?query=x",
          events: 485,
          groups: [{ count: 474, name: "jobs-api" }],
          monitor: "Worker lease stalled",
        },
      ],
      lead: undefined,
      rows: [],
    });
    const artifact = alertSummaryToUpdate({ form });

    expect(updateArtifactSchema.safeParse(withoutQuotedFlags({ artifact })).success).toBe(true);
    expect(paragraphTexts({ detail: artifact.detail })).toContain("No alerts fired in this window.");
    expect(artifact.citations.map((citation) => citation.url)).toEqual(["https://ap1.datadoghq.com/logs?query=x"]);
  });

  // MEASURED by a review pass: ten maximal rows plus five maximal recommendations came to
  // 1308 of the 1800 prose budget, two maximal behind entries added 489, and a longer `skipped` tipped the
  // total to 1801 — so the DOOR refused the card, naming above-fold fields a caller could not shorten to fix
  // it. The behind lane sheds now, and the lane below it measures what is left.
  it("sheds behind entries rather than deriving a card over the below-fold prose budget", () => {
    const pad = ({ prefix, to }: { prefix: string; to: number }) =>
      prefix + "x".repeat(Math.max(0, to - prefix.length));
    const form = alertSummaryFormSchema.parse({
      behind: ["a", "b"].map((key) => ({
        citationUrl: `https://ap1.datadoghq.com/logs?query=${key}`,
        events: 489,
        groups: ["p", "q", "r"].map((group) => ({ count: 100, name: pad({ prefix: `job-${key}-${group}-`, to: 80 }) })),
        monitor: pad({ prefix: `Worker lease stalled — ${key} `, to: ALERT_SUMMARY_ROW_LABEL_MAX }),
      })),
      kind: "alert-summary",
      label: pad({ prefix: "alerts-platform ", to: ALERT_SUMMARY_LABEL_MAX }),
      lead: pad({ prefix: "the pooler kept dropping connections ", to: ALERT_SUMMARY_LEAD_VISIBLE_MAX }),
      omitted: { count: 99, monitors: 7 },
      recommendations: [1, 2, 3, 4, 5].map((n) => ({
        act: "tune-monitor",
        change: pad({ prefix: `raise the pooler threshold ${String(n)} `, to: 90 }),
        evidenceUrl: `https://example.invalid/e${String(n)}`,
        finding: "red",
        owner: pad({ prefix: `owner${String(n)} `, to: 24 }),
        target: pad({ prefix: `svc/pooler${String(n)} `, to: 57 }),
      })),
      rows: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
        citationUrl: `https://example.invalid/r${String(n)}`,
        count: ALERT_SUMMARY_COUNT_MAX - n,
        label: pad({ prefix: `alert ${String(n)} `, to: ALERT_SUMMARY_ROW_LABEL_MAX }),
      })),
      skipped: 124_000,
      window: "7d",
    });
    const artifact = alertSummaryToUpdate({ form });

    expect(updateArtifactSchema.safeParse(withoutQuotedFlags({ artifact })).success).toBe(true);
    expect(visibleLengthOfDetail({ citations: artifact.citations, detail: artifact.detail })).toBeLessThanOrEqual(
      DETAIL_PROSE_VISIBLE_MAX,
    );
    // The section is still THERE — shedding means fewer entries, never a silent absence.
    expect(paragraphTexts({ detail: artifact.detail }).some((text) => text.startsWith("Behind the noisiest"))).toBe(
      true,
    );
  });

  it("says `<0.1%` rather than a rounded zero for a group that is really there", () => {
    const form: AlertSummaryForm = {
      ...tallyForm(),
      behind: [{ events: 100_000, groups: [{ count: 10, name: "core-api" }], monitor: "noisy" }],
    };
    const lines = alertSummaryToUpdate({ form }).detail.findLast((block) => block.type === "list")!;

    expect(
      (lines.type === "list" ? lines.items : [])
        .map((runs) => runs.map((run) => (run.type === "text" ? run.text : "")).join(""))
        .join(""),
    ).toContain("core-api <0.1%");
  });
});

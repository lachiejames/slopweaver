/**
 * The derived successor summary's markdown: what it says about a covered outcome, an uncovered one, and the
 * whole ready set — and the two places it cuts rather than runs long.
 */
import { describe, expect, it } from "vitest";

import {
  renderSuccessorSummary,
  SUMMARY_READY_ROWS,
  type SummaryOutcome,
  type SummaryRow,
} from "../../../../supervisor/outcomes/successorSummary.js";

/** One outcome as the reconciliation reported it. */
const outcome = (over: Partial<SummaryOutcome> & { id: string }): SummaryOutcome => ({
  anchor: `transcript:s#${over.id}`,
  liveSessions: [],
  title: `the ${over.id} outcome`,
  unspawned: [],
  words: `they said ${over.id}`,
  ...over,
});

/** One ready row. */
const row = (over: Partial<SummaryRow> & { rank: number }): SummaryRow => ({
  id: `row-${String(over.rank)}`,
  kind: "doc",
  label: `what row ${String(over.rank)} is about`,
  priority: "p2",
  ...over,
});

const GENERATED = "2026-09-15T04:00:00.000Z";

describe("renderSuccessorSummary", () => {
  it("opens by saying it is derived, carries the headline, and says every outcome has somebody", () => {
    const body = renderSuccessorSummary({
      generatedIso: GENERATED,
      headline: "3 of 19 live session(s) are on the board's top 5.",
      outcomes: [outcome({ id: "gcp-backups", liveSessions: ["workspace:1"] })],
      ready: [],
    });

    expect(body).toContain(`# Successor summary — derived ${GENERATED}`);
    expect(body).toContain("**This file is derived, never written.**");
    expect(body).toContain("3 of 19 live session(s) are on the board's top 5.");
    expect(body).toContain("Every one of the owner's kept outcomes has somebody on it.");
    expect(body).toContain("On it now: workspace:1.");
  });

  it("names the uncovered outcomes in bold at the top, and says NOBODY is on each of them", () => {
    const body = renderSuccessorSummary({
      generatedIso: GENERATED,
      headline: "h",
      outcomes: [
        outcome({ id: "notion-new-pages", unspawned: [{ id: "notion-ingest", label: "pull the new pages" }] }),
        outcome({ id: "gcp-backups", liveSessions: ["workspace:2"] }),
      ],
      ready: [],
    });

    expect(body).toContain("**1 of the owner's kept outcomes have nobody on them: notion-new-pages.**");
    expect(body).toContain("**Nobody is on this.**");
    expect(body).toContain("1 ready row(s) unspawned, highest first:");
    expect(body).toContain("- `notion-ingest` — pull the new pages");
    expect(body).toContain("No ready row under it is unspawned.");
  });

  it("says the owner has kept no outcome yet when their register holds none, and claims no coverage", () => {
    const body = renderSuccessorSummary({ generatedIso: GENERATED, headline: "h", outcomes: [], ready: [] });

    expect(body).toContain(
      "The owner has kept no outcome on the Workstreams register yet, so there is nothing to hold the fleet to.",
    );
    expect(body).not.toContain("has somebody on it");
  });

  it("carries the owner's words verbatim under each outcome, with the anchor a reader can check", () => {
    const body = renderSuccessorSummary({
      generatedIso: GENERATED,
      headline: "h",
      outcomes: [outcome({ id: "gcp-backups", liveSessions: ["workspace:2"], words: "scheduled backups into GCP" })],
      ready: [],
    });

    expect(body).toContain("> scheduled backups into GCP");
    expect(body).toContain("Anchor: `transcript:s#gcp-backups`");
  });

  it("lists ten unspawned rows under an outcome and counts the rest", () => {
    const body = renderSuccessorSummary({
      generatedIso: GENERATED,
      headline: "h",
      outcomes: [
        outcome({
          id: "many",
          unspawned: Array.from({ length: 13 }, (_, index) => ({ id: `r${String(index)}`, label: "a row" })),
        }),
      ],
      ready: [],
    });

    expect(body).toContain("- `r9` — a row");
    expect(body).not.toContain("- `r10` — a row");
    expect(body).toContain("- … and 3 more");
  });

  it("carries the whole ready set ranked, cutting at the cap and counting what is left", () => {
    const ready = Array.from({ length: SUMMARY_READY_ROWS + 4 }, (_, index) => row({ rank: index + 1 }));

    const body = renderSuccessorSummary({ generatedIso: GENERATED, headline: "h", outcomes: [], ready });

    expect(body).toContain(`${String(SUMMARY_READY_ROWS + 4)} ready row(s).`);
    expect(body).toContain("1. [p2 doc] `row-1` — what row 1 is about");
    expect(body).toContain(`${String(SUMMARY_READY_ROWS)}. [p2 doc] \`row-${String(SUMMARY_READY_ROWS)}\``);
    expect(body).not.toContain(`${String(SUMMARY_READY_ROWS + 1)}. [p2 doc]`);
    expect(body).toContain("… and 4 more");
  });

  it("flattens and cuts a paragraph-long row label rather than printing it whole", () => {
    const long = `${"word ".repeat(80)}end`;

    const body = renderSuccessorSummary({
      generatedIso: GENERATED,
      headline: "h",
      outcomes: [],
      ready: [row({ label: `line one\n\nline two ${long}`, rank: 1 })],
    });

    expect(body).toContain("line one line two word");
    expect(body).toContain("…");
    expect(body).not.toContain("end");
  });
});

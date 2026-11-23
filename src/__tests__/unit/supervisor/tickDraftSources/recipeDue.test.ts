/** The `automation due --json` document turned into the tick's recipe-due observation. */
import { describe, expect, it } from "vitest";

import { diagnosticOf, dueDocument, dueRow, factsOf, refusalFor, sourcesWith } from "../tickDraftSourcesFixture.js";

describe("draftTickSources — recipe due", () => {
  it("keeps a held row's holder and maps lateness to whole minutes", () => {
    const capture = dueDocument({
      rows: [
        dueRow({ recipeId: "resync-atlas-airtable" }),
        dueRow({ actionable: false, claimedBy: "workspace:9", recipeId: "knock-alert", shape: "spawn" }),
        { ...dueRow({ actionable: false, recipeId: "not-due" }), due: false },
      ],
    });
    const sources = sourcesWith({ capture, kind: "recipeDue" });

    expect(sources.recipeDue.status).toBe("read");
    expect(factsOf({ observation: sources.recipeDue }).rows).toStrictEqual([
      { heldBy: null, id: "resync-atlas-airtable", label: "resync-atlas-airtable", lateMinutes: 6, runs: "in-process" },
      { heldBy: "workspace:9", id: "knock-alert", label: "knock-alert", lateMinutes: 6, runs: "spawn" },
    ]);
  });

  it("omits a row whose holder the producer would not vouch for, rather than calling it unheld", () => {
    const sources = sourcesWith({
      capture: dueDocument({
        rows: [
          dueRow({ recipeId: "resync-atlas-airtable" }),
          dueRow({ actionable: false, recipeId: "resync-atlas-braze" }),
        ],
      }),
      kind: "recipeDue",
    });

    expect(sources.recipeDue.status).toBe("partial");
    expect(factsOf({ observation: sources.recipeDue }).rows.length).toBe(1);
    expect(diagnosticOf({ observation: sources.recipeDue })).toBe(
      "resync-atlas-braze is due but unactionable with no claim, so its holder is not established",
    );
  });

  it("is unavailable — not an empty list — when every due row was unrepresentable", () => {
    const sources = sourcesWith({
      capture: dueDocument({ rows: [dueRow({ actionable: false, recipeId: "resync-atlas-braze" })] }),
      kind: "recipeDue",
    });

    expect(sources.recipeDue.status).toBe("unavailable");
    expect(diagnosticOf({ observation: sources.recipeDue })).toBe(
      "no due ask could be recorded from recipe-due.json, so this tick knows of none: resync-atlas-braze is due but unactionable with no claim, so its holder is not established",
    );
  });

  it("is unavailable when every definition was rejected, which establishes nothing about the schedule", () => {
    const sources = sourcesWith({
      capture: dueDocument({ rejected: ["metrics.yaml", "knock.yaml"], rows: [] }),
      kind: "recipeDue",
    });

    expect(sources.recipeDue.status).toBe("unavailable");
    expect(diagnosticOf({ observation: sources.recipeDue })).toBe(
      "no due ask could be recorded from recipe-due.json, so this tick knows of none: 2 definition(s) rejected",
    );
  });

  it("refuses a tolerance band outside the producer's own vocabulary", () => {
    const refusal = refusalFor({
      capture: dueDocument({ rows: [dueRow({ band: "whenever", recipeId: "resync-atlas-airtable" })] }),
      kind: "recipeDue",
    });

    expect(refusal[0]).toBe("--recipe-due recipe-due.json is not a `slopweaver automation due --json` document:");
    expect(refusal[1]).toContain("band");
  });

  it("reads an empty list as a quiet schedule only when nothing was due at all", () => {
    const sources = sourcesWith({
      capture: dueDocument({ rows: [{ ...dueRow({ recipeId: "not-due" }), due: false }] }),
      kind: "recipeDue",
    });

    expect(sources.recipeDue.status).toBe("read");
    expect(factsOf({ observation: sources.recipeDue }).rows.length).toBe(0);
  });

  it("omits a row the tick schema cannot hold, naming it and any rejected definition", () => {
    const capture = dueDocument({
      rejected: ["metrics.yaml"],
      rows: [
        dueRow({ recipeId: "resync-atlas-airtable" }),
        dueRow({ actionable: false, recipeId: "metrics-push", shape: "no-executor" }),
        dueRow({ actionable: false, band: "unschedulable", lateByMs: null, recipeId: "broken-cadence" }),
      ],
    });
    const sources = sourcesWith({ capture, kind: "recipeDue" });

    expect(factsOf({ observation: sources.recipeDue }).rows.length).toBe(1);
    expect(diagnosticOf({ observation: sources.recipeDue })).toBe(
      "1 definition(s) rejected; metrics-push is due but has no executor; broken-cadence is due but unschedulable",
    );
  });
});

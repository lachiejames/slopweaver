/**
 * `runInvestigateRow` — the investigate runner `automation run-due` dispatches to, called directly: it asks the
 * question, briefs the posted message, and reports the row as ran.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runInvestigateRow } from "../../../../../../cli/commands/automation/investigateRowRunner.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../../../../live/automation/definition.js";
import { PROMPT_CHANNEL } from "./fixtures.js";
import { deps } from "./harness.js";

describe("runInvestigateRow — the investigate runner, called directly", () => {
  it("asks the question, briefs the posted message, and reports it as ran", async () => {
    const edges = deps();
    const outcome = await runInvestigateRow({
      base: { detail: [], exitCode: null, failed: false, ran: false, recipeId: "overnight-staging" },
      definition: {
        cadence: "0 * * * *",
        destination: { kind: "slack" },
        effect: "read",
        enabled: true,
        kind: "investigate",
        onMissed: "skip",
        params: { askedBy: "U0OWNER", channel: PROMPT_CHANNEL, question: "what regressed in staging overnight?" },
        recipeId: "overnight-staging",
        schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
      },
      deps: edges,
      dryRun: false,
      home: "/tmp/home",
      slotIso: "2026-09-08T12:00:00.000Z",
    });
    expect(outcome).toEqual({
      detail: [],
      exitCode: 0,
      failed: false,
      line:
        "recipe overnight-staging · asked · D0PROMPT/1789.0001 · in the ask lane · judge it and dispatch: " +
        join("/tmp/home", "briefs", "D0PROMPT-1789.0001.json"),
      ran: true,
      recipeId: "overnight-staging",
    });
    expect(edges.posts.length).toBe(1);
    expect(edges.dispatched.length).toBe(1);
  });
});

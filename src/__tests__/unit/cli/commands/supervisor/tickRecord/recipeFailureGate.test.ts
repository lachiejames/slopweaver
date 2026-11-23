/** The unseated-recipe-failure gate through the recorder: a broken automation's finding is owed a seat. */
import { describe, expect, it } from "vitest";

import {
  runSupervisorTickRecord,
  type SupervisorTickRecordDeps,
} from "../../../../../../cli/commands/supervisor/tickRecordRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { type Capture, capture, DRAFT, NOT_READ, RECONCILE } from "./harness.js";

describe("the unseated-recipe-failure gate, as the recorder renders it", () => {
  /** A Notion finding, exactly as the board held it. */
  const NOTION = "recipe-failing-resync-corpus-notion-2026-10-12t13-00-00.000z-a1";

  /** The owner-turn reconciliation over an observed fleet, the Notion finding repoless and held with nobody on it. */
  const UNSEATED = JSON.stringify({
    ...(JSON.parse(RECONCILE) as Record<string, unknown>),
    aligned: [],
    duplicateRecipeFailures: [],
    fleet: "observed",
    held: [{ groomed: true, id: NOTION, kind: "ask", priority: "p1", ready: false, standing: "blocked" }],
    misaligned: [],
    ready: [],
    repolessRows: [NOTION],
    unprioritised: [],
  });

  /** A completed spawn onto the finding, recorded the way the gate reads it. */
  const SPAWN_NOTION = {
    actionId: "tick-226-2-a1",
    kind: "spawned",
    outcome: "completed",
    recordedIso: "2026-09-10T12:15:00.000Z",
    subject: { id: NOTION, kind: "handover", label: `${NOTION} on workspace:9` },
    witness: { kind: "command", ref: `slopweaver cmux spawn ${NOTION} --model opus` },
  };

  /** The same seams as {@link capture}, with ONLY this gate's hatch shut. */
  async function gated({ draft }: { draft: string }): Promise<Capture & { code: number }> {
    const run = capture({ files: { "d.json": draft, "r.json": UNSEATED } });
    const deps: SupervisorTickRecordDeps = { ...run.deps, recipeFailureHatchOpen: () => false };
    return {
      ...run,
      code: await runSupervisorTickRecord({
        evidence: NOT_READ,
        deps,
        rest: ["--draft", "d.json", "--reconcile", "r.json"],
      }),
    };
  }

  it("refuses the incident, appending nothing, and prints set-repo before the spawn", async () => {
    const run = await gated({ draft: DRAFT });

    expect(run.code).toBe(EXIT_ERROR);
    expect(run.appended.length).toBe(0);
    expect(run.diagnostics.slice(-4)).toStrictEqual([
      `  ${NOTION} (blocked, names no repo: — cmux spawn refuses it until it does)`,
      `    slopweaver handover set-repo ${NOTION} --repo <main checkout>`,
      `    slopweaver cmux spawn ${NOTION} --model opus`,
      'Record each spawn as a `spawned` action whose subject is {"kind":"handover","id":"<slug>"}, or record a ' +
        "hold-rationale judgement with that subject saying why this tick leaves the broken automation unrepaired. " +
        "Capacity is not a reason on its own here: a failing integration is owed a seat whatever the machine says.",
    ]);
    expect(run.diagnostics.join("\n")).toContain("SLOPWEAVER_ALLOW_UNSEATED_RECIPE_FAILURE=1");
  });

  it("records the tick once a completed spawn names the finding", async () => {
    const run = await gated({
      draft: JSON.stringify({ ...(JSON.parse(DRAFT) as Record<string, unknown>), actions: [SPAWN_NOTION] }),
    });

    expect(run.code).toBe(EXIT_OK);
    expect(run.appended.length).toBe(1);
  });
});

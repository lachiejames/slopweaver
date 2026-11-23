/**
 * `automation due --json`'s declaration lists turned into the tick's recipe-due observation: a schedule that looks
 * quiet is in fact unknown when a declared automation is absent from the store or on a superseded cadence. The
 * row mapping itself is `src/__tests__/unit/supervisor/tickDraftSources/recipeDue.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { recipeDueObservation } from "../../../supervisor/tickRecipeDueDraft.js";
import {
  CAPTURED,
  diagnosticOf,
  dueDocument,
  dueRow,
  factsOf,
  redirected,
  refusalFor,
  STARTED,
  sourcesWith,
} from "./tickDraftSourcesFixture.js";

describe("draftTickSources — recipe due, the declared roster", () => {
  it("is unavailable, never a quiet schedule, when declared automations are absent or superseded", () => {
    const sources = sourcesWith({
      capture: dueDocument({
        missing: [
          { recipeId: "inbox-triage-daily", why: "w" },
          { recipeId: "slack-owed-daily", why: "w" },
        ],
        rows: [],
        superseded: [{ recipeId: "worktree-prune" }],
      }),
      kind: "recipeDue",
    });

    expect(sources.recipeDue.status).toBe("unavailable");
    expect(diagnosticOf({ observation: sources.recipeDue })).toBe(
      "no due ask could be recorded from recipe-due.json, so this tick knows of none: " +
        "2 declared automation(s) absent from the store: inbox-triage-daily, slack-owed-daily; " +
        "1 declared automation(s) on a superseded cadence: worktree-prune",
    );
  });

  it("keeps the due rows it can hold beside an absent roster, naming the roster", () => {
    const sources = sourcesWith({
      capture: dueDocument({ missing: [{ recipeId: "gone" }], rows: [dueRow({ recipeId: "resync-atlas-airtable" })] }),
      kind: "recipeDue",
    });

    expect(factsOf({ observation: sources.recipeDue }).rows.length).toBe(1);
    expect(diagnosticOf({ observation: sources.recipeDue })).toBe(
      "1 declared automation(s) absent from the store: gone",
    );
  });

  it("reads an absent roster captured before the tick as another tick's, never as this one's", () => {
    const observation = unwrap(
      recipeDueObservation({
        capture: redirected({
          path: "recipe-due.json",
          value: {
            missing: [{ recipeId: "gone" }],
            nowIso: "2026-09-12T21:00:00.000Z",
            rejected: [],
            rows: [],
            superseded: [],
          },
        }),
        frame: { capturedIso: CAPTURED, startedIso: STARTED },
      }),
    );

    expect(observation.status).toBe("unavailable");
    expect(diagnosticOf({ observation })).toBe(
      "--recipe-due recipe-due.json was captured at 2026-09-12T21:00:00.000Z, before this tick started at " +
        "2026-09-12T21:18:42.000Z: a reading from another tick is not recorded as this one's",
    );
  });

  it("refuses a due document carrying no declaration lists, which cannot say what is absent", () => {
    const refusal = refusalFor({
      capture: redirected({
        path: "recipe-due.json",
        value: { nowIso: "2026-09-12T21:24:00.000Z", rejected: [], rows: [] },
      }),
      kind: "recipeDue",
    });

    expect(refusal[0]).toBe("--recipe-due recipe-due.json is not a `slopweaver automation due --json` document:");
    expect(refusal[1]).toContain("missing");
  });
});

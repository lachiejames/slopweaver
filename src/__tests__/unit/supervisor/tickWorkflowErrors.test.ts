/** Every `supervisor tick` failure prints its message, then one indented line per thing it names. */
import { describe, expect, it } from "vitest";

import { TickWorkflowErrors, tickWorkflowErrorLines } from "../../../supervisor/tickWorkflowErrors.js";

describe("tickWorkflowErrorLines", () => {
  it("lists every refused field under the tick file's refusal", () => {
    const error = TickWorkflowErrors.inputInvalid({ issues: ["folds: too small", "shift: required"] });

    expect(tickWorkflowErrorLines({ error })).toEqual([
      "the tick file was refused, 2 issue(s):",
      "  folds: too small",
      "  shift: required",
    ]);
  });

  it("says a failed stage resumes, and why it failed", () => {
    const error = TickWorkflowErrors.stageFailed({ reasons: ["read-only"], stage: "page-published" });

    expect(tickWorkflowErrorLines({ error })).toEqual([
      "stage page-published failed; re-run the same close to resume from it:",
      "  read-only",
    ]);
  });

  it("names both digests of a conflicting close, shortened", () => {
    const error = TickWorkflowErrors.closeStateConflict({ actualHash: "b".repeat(64), expectedHash: "a".repeat(64) });

    expect(tickWorkflowErrorLines({ error })).toEqual([
      "this tick already committed a close from a different input (sha256 aaaaaaaaaaaa, this one bbbbbbbbbbbb) — " +
        "restore that input to resume it, or open a new tick",
    ]);
  });
});

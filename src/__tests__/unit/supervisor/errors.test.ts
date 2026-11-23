/** Unit: the supervisor's typed failures, and the one-line-per-problem view a printer reads. */
import { describe, expect, it } from "vitest";

import { unwrapErr } from "../../../lib/result.js";
import { SupervisorCoreErrors, supervisorCoreErrorLines } from "../../../supervisor/errors.js";
import { renderSweepPrompt } from "../../../supervisor/sweepPrompt.js";

describe("supervisorCoreErrorLines", () => {
  it("prints a refused document as its heading plus one indented line per issue", () => {
    const error = SupervisorCoreErrors.documentNotProduced({
      flag: "watch",
      issues: [
        { message: "Required", path: ["rows", 0, "sessionId"] },
        { message: "Expected object", path: [] },
      ],
      path: "/tmp/watch.json",
      producer: "slopweaver session watch --json-report",
    });
    expect(error.code).toBe("DOCUMENT_REFUSED");
    expect(supervisorCoreErrorLines({ error })).toEqual([
      "--watch /tmp/watch.json is not a `slopweaver session watch --json-report` document:",
      "  rows.0.sessionId: Required",
      "  document: Expected object",
    ]);
    expect(error.message).toBe(
      "--watch /tmp/watch.json is not a `slopweaver session watch --json-report` document: " +
        "rows.0.sessionId: Required; document: Expected object",
    );
  });

  it("prints every sweep-prompt refusal on its own line, off the real renderer", () => {
    const error = unwrapErr(renderSweepPrompt({ contractPath: "c.md", shiftState: "session watch --json" }));
    expect(error.code).toBe("SWEEP_PROMPT_REFUSED");
    expect(supervisorCoreErrorLines({ error }).length).toBe(2);
    expect(error.message).toBe(supervisorCoreErrorLines({ error }).join("; "));
  });

  it("prints a ledger's defects one per line", () => {
    const error = SupervisorCoreErrors.ledgerDefective({ reasons: ["t.jsonl:2: bad", "t.jsonl:3: worse"] });
    expect(supervisorCoreErrorLines({ error })).toEqual(["t.jsonl:2: bad", "t.jsonl:3: worse"]);
  });

  it("prints a single-line failure as its message alone", () => {
    const error = SupervisorCoreErrors.pinNotLive({ sessionId: "a0000013-0000-4000-8000-000000000127" });
    expect(supervisorCoreErrorLines({ error })).toEqual([
      "the supervisor pin names session a0000013, which is not live — " +
        "run `slopweaver cmux takeover` in the current supervisor",
    ]);
  });
});

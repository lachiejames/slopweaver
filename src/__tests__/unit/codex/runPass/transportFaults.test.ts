/*
 * `runBoundedPass` on a transport fault: a non-abort failure of the first turn, or of the resumed conclusion
 * turn, is fatal and never resumed.
 */
import { describe, expect, it } from "vitest";
import { runBoundedPass } from "../../../../codex/runPass.js";
import { acceptAll, BOUND, clientOf, FakeRuntime, FakeThread } from "./harness.js";

describe("runBoundedPass — transport faults", () => {
  it("treats a non-abort failure as FATAL and never resumes", async () => {
    const runtime = new FakeRuntime();
    const start = new FakeThread({ behaviour: { kind: "fail" }, id: "t1" });
    const result = await runBoundedPass({
      bound: BOUND,
      client: clientOf({ start }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime,
      validate: acceptAll,
      workingDirectory: "/repo",
    });
    expect(result.outcome.kind).toBe("fatal");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.status).toBe("failed");
    expect(result.attempts[0]!.usage).toEqual({ kind: "not-measured", reason: "transport-failed" });
  });

  it("is FATAL when the resumed conclusion turn itself fails on the transport", async () => {
    const runtime = new FakeRuntime();
    const start = new FakeThread({ behaviour: { fireAtMs: 204_000, kind: "abort-on-signal", runtime }, id: "t1" });
    const resume = new FakeThread({ behaviour: { kind: "fail" }, id: "t1" });
    const result = await runBoundedPass({
      bound: BOUND,
      client: clientOf({ resume, start }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime,
      validate: acceptAll,
      workingDirectory: "/repo",
    });
    expect(result.outcome.kind).toBe("fatal");
    expect(result.attempts).toHaveLength(2);
  });
});

/**
 * `formatChecksLine` — the one-line summary of a checks snapshot: the pass count beside its rollup, the failing,
 * running and queued checks, and the explanation a FAILURE rollup gets when the count disagrees with it.
 */
import { describe, expect, it } from "vitest";

import { formatChecksLine } from "../../../../../live/github/checks.js";
import { checksSnapshot } from "./harness.js";

describe("formatChecksLine", () => {
  it("reports an explicit no-checks line rather than 0/0", () => {
    expect(
      formatChecksLine({
        snapshot: checksSnapshot(),
        summary: { failed: 0, passed: 0, queued: 0, running: 0, total: 0 },
      }),
    ).toBe("no checks reported for this commit");
  });

  it("names failing checks alongside the running/queued counts, with the rollup beside the pass count", () => {
    const line = formatChecksLine({
      snapshot: checksSnapshot({
        checks: [
          { kind: "check-run", name: "lint", state: "passed", url: undefined },
          { kind: "check-run", name: "test", state: "failed", url: undefined },
          { kind: "check-run", name: "build", state: "running", url: undefined },
          { kind: "check-run", name: "deploy", state: "queued", url: undefined },
        ],
        rollupState: "FAILURE",
      }),
      summary: { failed: 1, passed: 1, queued: 1, running: 1, total: 4 },
    });

    expect(line).toBe("1/4 checks passed (rollup FAILURE), 1 failed (test), 1 running, 1 queued");
  });

  it("reports a clean pass with the rollup beside the count and no mismatch clause", () => {
    const line = formatChecksLine({
      snapshot: checksSnapshot({
        checks: [{ kind: "check-run", name: "lint", state: "passed", url: undefined }],
        rollupState: "SUCCESS",
      }),
      summary: { failed: 0, passed: 1, queued: 0, running: 0, total: 1 },
    });

    expect(line).toBe("1/1 checks passed (rollup SUCCESS)");
  });

  it("explains a rollup FAILURE that disagrees with an all-passed count — the superseded-run shape", () => {
    const line = formatChecksLine({
      snapshot: checksSnapshot({
        checks: [{ kind: "check-run", name: "dev-gate", state: "passed", url: undefined }],
        rollupState: "FAILURE",
        supersededChecks: [
          {
            completedAt: "2026-09-03T05:11:44Z",
            kind: "check-run",
            name: "dev-gate",
            replacedBy: undefined,
            runId: "33717795965",
            state: "failed",
          },
        ],
      }),
      summary: { failed: 0, passed: 1, queued: 0, running: 0, total: 1 },
    });

    expect(line).toBe(
      "1/1 checks passed (rollup FAILURE), rollup FAILURE: 1 superseded run, dev-gate 33717795965 completed 05:11:44Z",
    );
  });

  it("names every superseded failure when more than one disagrees with the rollup", () => {
    const line = formatChecksLine({
      snapshot: checksSnapshot({
        checks: [{ kind: "check-run", name: "dev-gate", state: "passed", url: undefined }],
        rollupState: "FAILURE",
        supersededChecks: [
          {
            completedAt: undefined,
            kind: "check-run",
            name: "dev-gate",
            replacedBy: undefined,
            runId: undefined,
            state: "failed",
          },
          {
            completedAt: undefined,
            kind: "check-run",
            name: "lint",
            replacedBy: undefined,
            runId: undefined,
            state: "failed",
          },
        ],
      }),
      summary: { failed: 0, passed: 1, queued: 0, running: 0, total: 1 },
    });

    expect(line).toBe("1/1 checks passed (rollup FAILURE), rollup FAILURE: 2 superseded runs, dev-gate, lint");
  });

  it("falls back to a plain disagreement note when no superseded check explains it", () => {
    const line = formatChecksLine({
      snapshot: checksSnapshot({
        checks: [{ kind: "check-run", name: "dev-gate", state: "passed", url: undefined }],
        rollupState: "FAILURE",
      }),
      summary: { failed: 0, passed: 1, queued: 0, running: 0, total: 1 },
    });

    expect(line).toBe(
      "1/1 checks passed (rollup FAILURE), rollup FAILURE: no failed check in the latest-per-name view",
    );
  });

  it("never explains the reverse mismatch — rollup SUCCESS beside a count that already names its own failure", () => {
    const line = formatChecksLine({
      snapshot: checksSnapshot({
        checks: [{ kind: "check-run", name: "test", state: "failed", url: undefined }],
        rollupState: "SUCCESS",
      }),
      summary: { failed: 1, passed: 0, queued: 0, running: 0, total: 1 },
    });

    expect(line).toBe("0/1 checks passed (rollup SUCCESS), 1 failed (test)");
  });
});

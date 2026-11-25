/**
 * The exit code a batch of `codex plan`/`codex review` invocations adds up to, on the paths that print nothing:
 * an empty batch, a pass no destination could take, and the pure sum over completed passes — where what became
 * of a pass's scratch must never move the code.
 */
import { describe, expect, it } from "vitest";

import { completedPassesExitCode, reportInvocations } from "../../../../../cli/commands/codex/passReport.js";
import { scratchReclaimFailureLines } from "../../../../../cli/commands/codex/scratchReclaimReport.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { CompletedPass } from "../../../../../codex/orchestrate.js";
import type { ScratchReclaimOutcome } from "../../../../../codex/passPersist.js";
import type { CodexArtifactRecord, CodexPassOutcome } from "../../../../../codex/types.js";
import { HomeReclaimErrors } from "../../../../../home/reclaim/errors.js";

const CLEAN: CodexPassOutcome = {
  answer: { counterexample: "", evidence: "e", propertyId: "r1-01", summary: "s", verdict: "CLEAN" },
  kind: "answered",
  rawFinalResponse: "{}",
};

const FAILED_RECLAIM: ScratchReclaimOutcome = {
  error: HomeReclaimErrors.passScratchNotReclaimable({ artifactId: "pass-1", reason: "record-shaped-scratch" }),
  kind: "failed",
};

/** A completed CLEAN review pass whose artifact was written, with the scratch outcome the case names. */
function cleanPass({ scratchReclaim }: { scratchReclaim: ScratchReclaimOutcome }): CompletedPass {
  const record = {
    artifactId: "pass-1",
    outcome: CLEAN,
    scope: { mode: "review", pass: "r1", property: { id: "r1-01", statement: "s" } },
  } as unknown as CodexArtifactRecord;
  return {
    location: { artifactPath: "/x/artifact.md", runDir: "/x" },
    persistError: undefined,
    record,
    scratchReclaim,
  };
}

describe("reportInvocations", () => {
  it("exits usage on a batch with no completed pass", () => {
    expect(reportInvocations({ invocations: [] })).toBe(EXIT_USAGE);
  });

  it("exits with the routing refusal's own code when a pass could not be routed", () => {
    expect(reportInvocations({ invocations: [{ exitCode: 7, kind: "unrouted" }] })).toBe(7);
  });
});

describe("completedPassesExitCode", () => {
  it("exits OK for a clean pass whose scratch was reclaimed", () => {
    expect(
      completedPassesExitCode({ passes: [cleanPass({ scratchReclaim: { freedBytes: 4096, kind: "reclaimed" } })] }),
    ).toBe(EXIT_OK);
  });

  it("exits OK for the same clean pass when its scratch reclaim FAILED — disk is not a wrong answer", () => {
    expect(completedPassesExitCode({ passes: [cleanPass({ scratchReclaim: FAILED_RECLAIM })] })).toBe(EXIT_OK);
  });

  it("still exits ERROR on an unpersisted artifact, whatever the scratch outcome", () => {
    const unpersisted: CompletedPass = {
      ...cleanPass({ scratchReclaim: { kind: "not-attempted", reason: "artifact-not-persisted" } }),
      location: undefined,
      persistError: "disk full",
    };
    expect(completedPassesExitCode({ passes: [unpersisted] })).toBe(EXIT_ERROR);
  });
});

describe("scratchReclaimFailureLines", () => {
  it("names the pass, the failure and the report verb for a failed reclaim", () => {
    expect(scratchReclaimFailureLines({ passes: [cleanPass({ scratchReclaim: FAILED_RECLAIM })] })).toEqual([
      "r1 scratch not reclaimed for pass pass-1 (PASS_SCRATCH_NOT_RECLAIMABLE: pass pass-1's scratch was left in " +
        "place: the scratch holds a record.json or artifact.md at its top, so it may be a record) — the verdict " +
        "stands; `slopweaver home reclaim --root codex-scratch` reports what is left",
    ]);
  });

  it("prints nothing for a reclaimed or not-attempted scratch", () => {
    const passes = [
      cleanPass({ scratchReclaim: { freedBytes: 1, kind: "reclaimed" } }),
      cleanPass({ scratchReclaim: { kind: "not-attempted", reason: "workspace-unavailable" } }),
    ];
    expect(passes).toHaveLength(2);
    expect(scratchReclaimFailureLines({ passes })).toEqual([]);
  });
});

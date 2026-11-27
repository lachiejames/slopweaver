/**
 * Which pool a description review removes once its passes finish, and how that outcome is reported: only a
 * packet repository is eligible, only the root the passes' own acquires returned is removed, two roots remove
 * nothing, and no outcome ever moves the exit code.
 */
import { describe, expect, it } from "vitest";

import { codexResultJson } from "../../../../../cli/commands/codex/core.js";
import {
  type PoolReclaimOutcome,
  poolReclaimFailureLines,
  poolReclaimJson,
  poolRootToReclaim,
  reclaimDescriptionReviewPool,
} from "../../../../../cli/commands/codex/descriptionReviewPoolReclaim.js";
import { reportInvocations } from "../../../../../cli/commands/codex/passReport.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { CompletedPass } from "../../../../../codex/orchestrate.js";
import { SnapshotPoolReclaimErrors } from "../../../../../codex/snapshotPoolReclaim.js";
import type { CodexArtifactRecord, CodexPassOutcome } from "../../../../../codex/types.js";
import { err, ok } from "../../../../../lib/result.js";
import { DescriptionReviewErrors } from "../../../../../outbound/github/descriptionReviewErrors.js";
import type { DescriptionReviewPreparation } from "../../../../../outbound/github/descriptionReviewTypes.js";

const CLEAN: CodexPassOutcome = {
  answer: { counterexample: "", evidence: "e", propertyId: "r1-01", summary: "s", verdict: "CLEAN" },
  kind: "answered",
  rawFinalResponse: "{}",
};

const POOL = "/tmp/slopweaver-snap-pool/0123456789abcdef";
const OTHER_POOL = "/tmp/slopweaver-snap-pool/fedcba9876543210";
const PACKET = "/home/pr-description-reviews/preparations/prep-1/repo";

/** A completed CLEAN review pass that leased from `snapshotPoolRoot`, or from no pool at all. */
function pass({ snapshotPoolRoot }: { snapshotPoolRoot: string | undefined }): CompletedPass {
  const record = {
    artifactId: "pass-1",
    attempts: [],
    outcome: CLEAN,
    scope: { mode: "review", pass: "r1", property: { id: "r1-01", statement: "s" } },
  } as unknown as CodexArtifactRecord;
  return {
    location: { artifactPath: "/x/artifact.md", runDir: "/x" },
    persistError: undefined,
    record,
    scratchReclaim: { freedBytes: 0, kind: "reclaimed" },
    snapshotPoolRoot,
  };
}

const PACKET_HEAD = "1111111111111111111111111111111111111111";
const PREPARATION = { headSha: PACKET_HEAD, preparationId: "prep-1" } as unknown as DescriptionReviewPreparation;

/** Every reclaim call the policy made, so a case can assert it made none, or exactly which. */
function recordingReclaim(): {
  calls: { poolRoot: string; repoRoot: string; session: string }[];
  reclaim: NonNullable<Parameters<typeof reclaimDescriptionReviewPool>[0]["reclaim"]>;
} {
  const calls: { poolRoot: string; repoRoot: string; session: string }[] = [];
  return {
    calls,
    reclaim: ({ poolRoot, repoRoot, session }) => {
      calls.push({ poolRoot, repoRoot, session });
      return ok({ freedBytes: 8192, removedSlots: 2 });
    },
  };
}

/** The policy over a packet (or an ordinary repository), with every other input fixed. */
function decide({
  head = PACKET_HEAD,
  passes,
  preparation,
  reclaim,
}: {
  head?: string;
  passes: readonly CompletedPass[];
  preparation: DescriptionReviewPreparation | undefined;
  reclaim: NonNullable<Parameters<typeof reclaimDescriptionReviewPool>[0]["reclaim"]>;
}): PoolReclaimOutcome {
  return reclaimDescriptionReviewPool({
    headOf: () => head,
    home: "/home",
    ledgerPath: "/home/home-reclaim.jsonl",
    nowIso: () => "2026-11-28T00:00:00.000Z",
    passes,
    readPreparation: () => ok(preparation),
    reclaim,
    repoRoot: PACKET,
  });
}

describe("poolRootToReclaim", () => {
  it("names none when no pass leased a pooled snapshot", () => {
    expect(poolRootToReclaim({ passes: [pass({ snapshotPoolRoot: undefined })] })).toEqual({ kind: "none" });
  });

  it("names the one root every pooled pass shares, ignoring a pass that leased none", () => {
    const passes = [
      pass({ snapshotPoolRoot: POOL }),
      pass({ snapshotPoolRoot: undefined }),
      pass({ snapshotPoolRoot: POOL }),
    ];
    expect(poolRootToReclaim({ passes })).toEqual({ kind: "one", poolRoot: POOL });
  });

  it("names every distinct root when the passes disagree", () => {
    const passes = [pass({ snapshotPoolRoot: POOL }), pass({ snapshotPoolRoot: OTHER_POOL })];
    expect(poolRootToReclaim({ passes })).toEqual({ kind: "inconsistent", roots: [POOL, OTHER_POOL] });
  });

  it("treats two spellings of what may be one directory as two roots, never canonicalising", () => {
    const passes = [pass({ snapshotPoolRoot: POOL }), pass({ snapshotPoolRoot: `/private${POOL}` })];
    expect(poolRootToReclaim({ passes }).kind).toBe("inconsistent");
  });
});

describe("reclaimDescriptionReviewPool", () => {
  it("removes nothing in an ordinary repository, whose pool its next pass reuses", () => {
    const { calls, reclaim } = recordingReclaim();
    const outcome = decide({ passes: [pass({ snapshotPoolRoot: POOL })], preparation: undefined, reclaim });
    expect(outcome).toEqual({ kind: "not-attempted", reason: "ordinary-repository" });
    expect(calls).toEqual([]);
  });

  it("removes nothing when no pass of the packet's review leased a pool", () => {
    const { calls, reclaim } = recordingReclaim();
    const outcome = decide({ passes: [pass({ snapshotPoolRoot: undefined })], preparation: PREPARATION, reclaim });
    expect(outcome).toEqual({ kind: "not-attempted", reason: "no-acquired-pool" });
    expect(calls).toEqual([]);
  });

  it("removes exactly the root the passes' own acquires returned, against the packet repository", () => {
    const { calls, reclaim } = recordingReclaim();
    const outcome = decide({ passes: [pass({ snapshotPoolRoot: POOL })], preparation: PREPARATION, reclaim });
    expect(outcome).toEqual({ freedBytes: 8192, kind: "reclaimed", removedSlots: 2 });
    expect(calls).toEqual([{ poolRoot: POOL, repoRoot: PACKET, session: "description-review:prep-1" }]);
  });

  it("fails closed and removes nothing when the passes name two different pools", () => {
    const { calls, reclaim } = recordingReclaim();
    const passes = [pass({ snapshotPoolRoot: POOL }), pass({ snapshotPoolRoot: OTHER_POOL })];
    const outcome = decide({ passes, preparation: PREPARATION, reclaim });
    expect(outcome).toEqual({
      error: { code: "POOL_ROOTS_DISAGREE", message: "the passes leased from 2 different pools, so none was removed" },
      kind: "failed",
    });
    expect(calls).toEqual([]);
  });

  it("reports an unreadable preparation as a failure and removes nothing", () => {
    const { calls, reclaim } = recordingReclaim();
    const outcome = reclaimDescriptionReviewPool({
      headOf: () => PACKET_HEAD,
      home: "/home",
      ledgerPath: "/home/home-reclaim.jsonl",
      nowIso: () => "2026-11-28T00:00:00.000Z",
      passes: [pass({ snapshotPoolRoot: POOL })],
      readPreparation: () => err(DescriptionReviewErrors.preparationFailed({ detail: "unreadable" })),
      reclaim,
      repoRoot: PACKET,
    });
    expect(outcome).toEqual({
      error: { code: "PREPARATION_FAILED", message: "description review packet: unreadable" },
      kind: "failed",
    });
    expect(calls).toEqual([]);
  });

  it("removes nothing when the repository at the packet path is not at the commit its preparation wrote", () => {
    const { calls, reclaim } = recordingReclaim();
    const outcome = decide({
      head: "2222222222222222222222222222222222222222",
      passes: [pass({ snapshotPoolRoot: POOL })],
      preparation: PREPARATION,
      reclaim,
    });
    expect(outcome).toEqual({ kind: "not-attempted", reason: "not-the-prepared-packet" });
    expect(calls).toEqual([]);
  });

  it("folds a throw from any read into a failure rather than letting it reach the exit code", () => {
    const { calls, reclaim } = recordingReclaim();
    const outcome = reclaimDescriptionReviewPool({
      headOf: () => PACKET_HEAD,
      home: "/home",
      ledgerPath: "/home/home-reclaim.jsonl",
      nowIso: () => "2026-11-28T00:00:00.000Z",
      passes: [pass({ snapshotPoolRoot: POOL })],
      readPreparation: () => {
        throw new Error("ENOENT: the packet repository went away");
      },
      reclaim,
      repoRoot: PACKET,
    });
    expect(outcome).toEqual({
      error: { code: "POOL_RECLAIM_THREW", message: "ENOENT: the packet repository went away" },
      kind: "failed",
    });
    expect(calls).toEqual([]);
  });

  it("carries a held slot's refusal through as the failure, code and message intact", () => {
    const outcome = decide({
      passes: [pass({ snapshotPoolRoot: POOL })],
      preparation: PREPARATION,
      reclaim: () => err(SnapshotPoolReclaimErrors.slotHeld({ blocked: [{ index: 3, reason: "live-holder" }] })),
    });
    expect(outcome).toEqual({
      error: { code: "POOL_SLOT_HELD", message: "left the pool in place: slot-3 live-holder" },
      kind: "failed",
    });
  });
});

const FAILED: PoolReclaimOutcome = { error: { code: "POOL_SLOT_HELD", message: "held" }, kind: "failed" };

describe("poolReclaimJson", () => {
  it("carries a removal's bytes and slot count", () => {
    expect(poolReclaimJson({ outcome: { freedBytes: 10, kind: "reclaimed", removedSlots: 1 } })).toEqual({
      freedBytes: 10,
      removedSlots: 1,
      status: "reclaimed",
    });
  });

  it("carries why nothing was attempted", () => {
    expect(poolReclaimJson({ outcome: { kind: "not-attempted", reason: "ordinary-repository" } })).toEqual({
      reason: "ordinary-repository",
      status: "not-attempted",
    });
  });

  it("carries a failure as a bounded code and message", () => {
    expect(poolReclaimJson({ outcome: FAILED })).toEqual({
      error: { code: "POOL_SLOT_HELD", message: "held" },
      status: "failed",
    });
  });
});

describe("poolReclaimFailureLines", () => {
  it("says the verdict stands on a failed removal", () => {
    expect(poolReclaimFailureLines({ outcome: FAILED })).toEqual([
      "description review's snapshot pool not removed (POOL_SLOT_HELD: held) — the verdict stands",
    ]);
  });

  it("prints nothing when the pool went", () => {
    expect(poolReclaimFailureLines({ outcome: { freedBytes: 1, kind: "reclaimed", removedSlots: 1 } })).toEqual([]);
  });
});

describe("codexResultJson's snapshotPoolReclaim field", () => {
  it("puts the review's pool outcome at the top level, beside every verdict", () => {
    const document = JSON.parse(
      codexResultJson({ passes: [pass({ snapshotPoolRoot: POOL })], poolReclaim: FAILED }),
    ) as {
      passes: { verdict: string }[];
      snapshotPoolReclaim: unknown;
    };
    expect(document.snapshotPoolReclaim).toEqual({
      error: { code: "POOL_SLOT_HELD", message: "held" },
      status: "failed",
    });
    expect(document.passes[0]!.verdict).toBe("CLEAN");
  });

  it("leaves the field out when no pool outcome was given, as a plan's document does", () => {
    const document = JSON.parse(codexResultJson({ passes: [pass({ snapshotPoolRoot: POOL })] })) as Record<
      string,
      unknown
    >;
    expect(Object.keys(document).toSorted()).toEqual(["passes", "schemaVersion"]);
  });

  it("never writes the pool root itself into a pass's entry", () => {
    expect(codexResultJson({ passes: [pass({ snapshotPoolRoot: POOL })], poolReclaim: FAILED })).not.toContain(POOL);
  });
});

describe("the exit code beside a pool outcome", () => {
  it("stays OK for a clean pass whose review's pool removal failed — disk is not a wrong answer", () => {
    const invocations = [{ kind: "completed" as const, pass: pass({ snapshotPoolRoot: POOL }) }];
    expect(reportInvocations({ invocations, poolReclaim: FAILED })).toBe(EXIT_OK);
  });
});

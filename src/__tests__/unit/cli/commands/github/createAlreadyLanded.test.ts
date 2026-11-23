/**
 * `github pr create`'s already-landed gate at the seam it actually sits on — what it prints, and the one
 * answer that stops the write.
 *
 * The measurement itself is faked here rather than shelled, which is the point of the injected edge:
 * `alreadyLandedRun.test.ts` owns whether the measurement is right, this owns what the verb does with it.
 */
import { describe, expect, it } from "vitest";

import type { AlreadyLanded, BaseFreshness, QueueGate } from "../../../../../cli/commands/github/baseFreshnessCore.js";
import { createBaseGatesRefused } from "../../../../../cli/commands/github/createBaseFreshness.js";
import type { GithubVerbResult } from "../../../../../cli/commands/github/errors.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import type { PrTarget } from "../../../../../outbound/github/types.js";

// register-class: re-derives-or-rebuilds-what-already-exists (docs/recurring-failure-register/bindings.md)

const TARGET: PrTarget = { base: "main", head: "a-branch", owner: "acme", repo: "widget" };
const LANDED: AlreadyLanded = { baseBranch: "origin/main", headBranch: "a-branch", kind: "landed" };

/** Run the gate over one scripted measurement, collecting every printed line. */
async function gate({
  measurement,
  acknowledge = [],
  reason,
  freshness = ok({ kind: "skipped", why: "not under test here" }),
}: {
  measurement: Result<AlreadyLanded>;
  acknowledge?: readonly string[];
  reason?: string;
  freshness?: GithubVerbResult<BaseFreshness>;
}): Promise<{ refused: boolean; lines: readonly string[] }> {
  const lines: string[] = [];
  const refused = await createBaseGatesRefused({
    args: { baseFreshnessAcknowledgement: { acknowledge, acknowledgeAll: false, reason }, cwd: "/repo" },
    deps: {
      cwd: () => "/repo",
      measureAlreadyLanded: () => measurement,
      measureBaseFreshness: () => freshness,
      out: ({ line }) => lines.push(line),
    },
    home: "/home",
    target: TARGET,
  });
  // The freshness gate is skipped in every case here, so it contributes exactly one line, which the
  // assertions below drop. Its own behaviour is `baseFreshnessCore.test.ts`'s business.
  return { lines: lines.slice(1), refused };
}

describe("createBaseGatesRefused, already-landed half", () => {
  it("REFUSES a head already patch-identical to the base", async () => {
    const result = await gate({ measurement: ok(LANDED) });
    expect(result.refused).toBe(true);
    expect(result.lines[0]).toContain("refused: already-landed");
  });

  it("says nothing and permits the write when the branch carries new work", async () => {
    const result = await gate({ measurement: ok({ kind: "not-landed" }) });
    expect(result.refused).toBe(false);
    expect(result.lines).toStrictEqual([]);
  });

  it("permits, and says so, when the measurement was skipped", async () => {
    const result = await gate({ measurement: ok({ kind: "skipped", why: "no readable origin remote" }) });
    expect(result.refused).toBe(false);
    expect(result.lines).toStrictEqual(["already-landed check SKIPPED: no readable origin remote"]);
  });

  it("fails OPEN on an errored measurement rather than inventing a finding out of its own failure", async () => {
    const result = await gate({ measurement: err(["git exploded"]) });
    expect(result.refused).toBe(false);
    expect(result.lines).toStrictEqual(["already-landed check SKIPPED: git exploded"]);
  });

  it("permits a deliberate re-land acknowledged with a reason", async () => {
    const result = await gate({
      acknowledge: ["already-landed"],
      measurement: ok(LANDED),
      reason: "re-land after the revert in #12",
    });
    expect(result.refused).toBe(false);
    expect(result.lines[1]).toBe("reason: re-land after the revert in #12");
  });

  it("still refuses a re-land acknowledged without a reason", async () => {
    const result = await gate({ acknowledge: ["already-landed"], measurement: ok(LANDED) });
    expect(result.refused).toBe(true);
  });

  it("refuses on a MOVED base before ever reporting already-landed, because a stale base is the actionable one", async () => {
    const run = await movedBaseGate({});
    expect(run.refused).toBe(true);
    // The staleness advisory leads, above the refusal it does not change.
    expect(run.lines[0]).toBe("⚠ this branch is 3 commits behind origin/main");
    expect(run.lines[1]).toContain("refused: base-moved");
    expect(run.lines.some((line) => line.includes("already-landed"))).toBe(false);
  });

  // The creation door is the SECOND instance of the class the push door's relaxation closed: measured live,
  // the base moved between this branch's own push and the stack push that opened its PR.
  it("permits a MOVED base when the base branch's queue gates on real contexts, and reads it only then", async () => {
    const run = await movedBaseGate({
      landed: ok({ kind: "not-landed" }),
      queueGate: { branch: "main", contexts: ["build", "integration"], url: "https://q.example/main" },
    });
    expect(run.refused).toBe(false);
    expect(run.queueReads).toStrictEqual(["acme/widget@main"]);
    expect(run.lines[0]).toBe("⚠ this branch is 3 commits behind origin/main");
    expect(run.lines[1]).toContain("base-moved ACCEPTED");
  });

  it("never reads the queue when the base is fresh", async () => {
    const lines: string[] = [];
    const queueReads: string[] = [];
    const refused = await createBaseGatesRefused({
      args: { baseFreshnessAcknowledgement: { acknowledge: [], acknowledgeAll: false, reason: undefined } },
      deps: {
        cwd: () => "/repo",
        measureAlreadyLanded: () => ok({ kind: "not-landed" }),
        measureBaseFreshness: () =>
          ok({
            baseBranch: "main",
            baseSha: "2222222",
            headSha: "1111111",
            kind: "fresh",
            remote: "origin",
            reverted: [],
          }),
        out: ({ line }) => lines.push(line),
        readQueueGate: ({ repo, branch }) => {
          queueReads.push(`${repo}@${branch}`);
          return Promise.resolve({ branch, contexts: ["build"], url: "https://q.example/main" });
        },
      },
      home: "/home",
      target: TARGET,
    });
    expect(refused).toBe(false);
    expect(queueReads).toStrictEqual([]);
  });
});

/** Run both base gates over a MOVED base, optionally with a queue read, capturing what it asked GitHub. */
async function movedBaseGate({
  queueGate,
  landed = ok(LANDED),
}: {
  queueGate?: QueueGate | undefined;
  landed?: Result<AlreadyLanded>;
}): Promise<{
  refused: boolean;
  lines: readonly string[];
  queueReads: readonly string[];
}> {
  const lines: string[] = [];
  const queueReads: string[] = [];
  const refused = await createBaseGatesRefused({
    args: { baseFreshnessAcknowledgement: { acknowledge: [], acknowledgeAll: false, reason: undefined } },
    deps: {
      cwd: () => "/repo",
      measureAlreadyLanded: () => landed,
      measureBaseFreshness: () =>
        ok({
          baseBranch: "main",
          baseSha: "2222222",
          behindBy: 3,
          headSha: "1111111",
          kind: "base-moved",
          remote: "origin",
          reverted: [],
        }),
      out: ({ line }) => lines.push(line),
      ...(queueGate === undefined
        ? {}
        : {
            readQueueGate: ({ repo, branch }: { repo: string; branch: string; home: string }) => {
              queueReads.push(`${repo}@${branch}`);
              return Promise.resolve(queueGate);
            },
          }),
    },
    home: "/home",
    target: TARGET,
  });
  return { lines, queueReads, refused };
}

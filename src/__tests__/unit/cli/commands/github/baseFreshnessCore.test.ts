import { describe, expect, it } from "vitest";

import { alreadyLandedPermit } from "../../../../../cli/commands/github/alreadyLandedPermit.js";
import {
  ALREADY_LANDED_ACK,
  BASE_MOVED_ACK,
  BASE_UNMEASURABLE_ACK,
  baseFreshnessAcknowledgementFrom,
  baseFreshnessPermit,
  behindBaseAdvisory,
  behindBaseLines,
  printBaseFreshnessPermit,
  QUEUE_GATED_BASE_DRIFT,
  queueGatedBaseMoved,
} from "../../../../../cli/commands/github/baseFreshnessCore.js";
import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("baseFreshnessAcknowledgementFrom", () => {
  it("parses a comma-separated --acknowledge list", () => {
    const errors: string[] = [];
    const result = baseFreshnessAcknowledgementFrom({
      enabled: true,
      errors,
      values: { acknowledge: "base-moved, base-unmeasurable" },
    });
    expect(result.acknowledge).toEqual(["base-moved", "base-unmeasurable"]);
    expect(errors).toEqual([]);
  });

  it("defaults to an empty acknowledgement when nothing was passed", () => {
    const errors: string[] = [];
    const result = baseFreshnessAcknowledgementFrom({ enabled: true, errors, values: {} });
    expect(result).toEqual({ acknowledge: [], acknowledgeAll: false, reason: undefined });
    expect(errors).toEqual([]);
  });

  it("requires --reason alongside --acknowledge-all", () => {
    const errors: string[] = [];
    baseFreshnessAcknowledgementFrom({ enabled: true, errors, values: { "acknowledge-all": true } });
    expect(errors).toContain(
      '--acknowledge-all must be paired with --reason "…" explaining why every finding is accepted',
    );
  });

  it("accepts --acknowledge-all when a reason is given", () => {
    const errors: string[] = [];
    const result = baseFreshnessAcknowledgementFrom({
      enabled: true,
      errors,
      values: { "acknowledge-all": true, reason: "known flake" },
    });
    expect(result).toEqual({ acknowledge: [], acknowledgeAll: true, reason: "known flake" });
    expect(errors).toEqual([]);
  });

  it("refuses these flags entirely when the call site does not accept them", () => {
    const errors: string[] = [];
    baseFreshnessAcknowledgementFrom({ enabled: false, errors, values: { acknowledge: "base-moved" } });
    expect(errors).toContain(
      "--acknowledge/--acknowledge-all/--reason are not accepted here — freshness is only checked on create",
    );
  });
});

describe("baseFreshnessPermit", () => {
  const FRESH = {
    baseBranch: "main",
    baseSha: "aaa",
    headSha: "bbb",
    kind: "fresh" as const,
    remote: "origin",
    reverted: [],
  };
  const MOVED = {
    baseBranch: "main",
    baseSha: "ccc",
    behindBy: 2,
    headSha: "bbb",
    kind: "base-moved" as const,
    remote: "origin",
    reverted: [],
  };
  const GATED_QUEUE = { branch: "main", contexts: ["build", "integration"], url: "https://q.example/main" };
  const NO_ACK = { acknowledge: [], acknowledgeAll: false, reason: undefined };

  it("permits a fresh base", () => {
    const result = baseFreshnessPermit({ acknowledgement: NO_ACK, measurement: ok(FRESH) });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).lines[0]).toContain("current");
  });

  it("permits a skipped measurement, printing why", () => {
    const result = baseFreshnessPermit({
      acknowledgement: NO_ACK,
      measurement: ok({ kind: "skipped" as const, why: "no local checkout" }),
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).lines[0]).toContain("SKIPPED: no local checkout");
  });

  it("refuses an unacknowledged base-moved", () => {
    const result = baseFreshnessPermit({ acknowledgement: NO_ACK, measurement: ok(MOVED) });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).reasons.some((line) => line.includes("refused: base-moved"))).toBe(true);
    expect(unwrapErr(result).reasons).toEqual([
      "refused: base-moved: main has moved to ccc, which is not an ancestor of the checked head bbb — your diff and " +
        "any CI run were computed against a base that has since advanced (or this is a shallow clone's false negative)",
      "the merge queue does not excuse this: the base branch's merge queue could not be read",
      "remedy: rebase onto the current base ONCE, run the full gate, push, and land with " +
        "`slopweaver github enqueue --pr <n> --repo <owner/name>`",
      "do NOT take a merge hold and do NOT hand a baton on: GitHub orders the queue, tests your entry against " +
        "the tip plus everything ahead of it, and nothing waits on a session staying alive",
      'accept with --acknowledge base-moved, or every finding with --acknowledge-all --reason "…"',
    ]);
  });

  it("prescribes the lane's own remedy when the caller could read the hold", () => {
    const result = baseFreshnessPermit({
      acknowledgement: NO_ACK,
      lane: {
        hold: {
          atIso: "2026-08-28T01:00:00.000Z",
          holder: "me",
          pr: 32,
          repo: "owner/name",
          staleMinutes: 30,
          staleWarnedAtIso: undefined,
          why: "landing",
        },
        nowIso: "2026-08-28T01:05:00.000Z",
        repo: "owner/name",
        sessionId: "me",
      },
      measurement: ok(MOVED),
    });
    expect(unwrapErr(result).reasons[2]).toBe(
      "remedy: you own the merge hold on owner/name (owner/name#32, placed 5m ago) — this is the lap that lands: " +
        "rebase onto the current base, run the full gate ONCE, push, and `merge --admin --number 32` releases it",
    );
  });

  it("permits an acknowledged base-moved, marking it ACKNOWLEDGED", () => {
    const result = baseFreshnessPermit({
      acknowledgement: { acknowledge: [BASE_MOVED_ACK], acknowledgeAll: false, reason: undefined },
      measurement: ok(MOVED),
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).lines[0]).toContain("ACKNOWLEDGED (base-moved)");
  });

  it("refuses an unacknowledged unmeasurable result", () => {
    const result = baseFreshnessPermit({
      acknowledgement: NO_ACK,
      measurement: err(GithubVerbErrors.upstreamRefused({ operation: "fetch", reasons: ["network unreachable"] })),
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).reasons.some((line) => line.includes(BASE_UNMEASURABLE_ACK))).toBe(true);
    expect(unwrapErr(result).reasons.some((line) => line.includes("network unreachable"))).toBe(true);
  });

  it("permits an unmeasurable result acknowledged via --acknowledge-all", () => {
    const result = baseFreshnessPermit({
      acknowledgement: { acknowledge: [], acknowledgeAll: true, reason: "offline, known safe" },
      measurement: err(GithubVerbErrors.upstreamRefused({ operation: "fetch", reasons: ["network unreachable"] })),
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).lines.some((line) => line.includes("offline, known safe"))).toBe(true);
  });

  it("warns about reverted files on an otherwise FRESH base, unconditionally — this is the case ancestry alone cannot see", () => {
    const result = baseFreshnessPermit({
      acknowledgement: NO_ACK,
      measurement: ok({ ...FRESH, reverted: [{ path: "src/poster.ts", restoresBaseCommit: "aaaaaaa" }] }),
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).lines.some((line) => line.includes("WARNING"))).toBe(true);
    expect(unwrap(result).lines.some((line) => line.includes("src/poster.ts"))).toBe(true);
  });

  it("still warns about reverted files when base-moved is separately acknowledged", () => {
    const result = baseFreshnessPermit({
      acknowledgement: { acknowledge: [BASE_MOVED_ACK], acknowledgeAll: false, reason: undefined },
      measurement: ok({ ...MOVED, reverted: [{ path: "src/poster.ts", restoresBaseCommit: "aaaaaaa" }] }),
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).lines.some((line) => line.includes("WARNING"))).toBe(true);
  });

  it("still warns about reverted files even while base-moved is refused unacknowledged", () => {
    const result = baseFreshnessPermit({
      acknowledgement: NO_ACK,
      measurement: ok({ ...MOVED, reverted: [{ path: "src/poster.ts", restoresBaseCommit: "aaaaaaa" }] }),
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).reasons.some((line) => line.includes("WARNING"))).toBe(true);
  });

  it("prints nothing extra when nothing was reverted", () => {
    const result = baseFreshnessPermit({ acknowledgement: NO_ACK, measurement: ok(FRESH) });
    expect(unwrap(result).lines).toHaveLength(1);
  });

  it("permits an unacknowledged base-moved when the base's queue gates and the drift is inside the bound", () => {
    const result = baseFreshnessPermit({ acknowledgement: NO_ACK, measurement: ok(MOVED), queueGate: GATED_QUEUE });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).lines).toEqual([
      "base freshness: base-moved ACCEPTED — main is 2 commit(s) past bbb (bound 16), and its merge queue gates " +
        "on build, integration, so the merged result is tested against the tip before it lands",
      "do NOT rebase and rerun the gate for this: land it with `slopweaver github enqueue` — https://q.example/main",
    ]);
  });

  it("permits a base-moved at exactly the drift bound", () => {
    const result = baseFreshnessPermit({
      acknowledgement: NO_ACK,
      measurement: ok({ ...MOVED, behindBy: QUEUE_GATED_BASE_DRIFT }),
      queueGate: GATED_QUEUE,
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).lines[0]).toContain("ACCEPTED");
  });

  it("refuses a base-moved one commit past the drift bound, naming the bound", () => {
    const result = baseFreshnessPermit({
      acknowledgement: NO_ACK,
      measurement: ok({ ...MOVED, behindBy: QUEUE_GATED_BASE_DRIFT + 1 }),
      queueGate: GATED_QUEUE,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).reasons[1]).toBe(
      "the merge queue does not excuse this: main is 17 commits past this head, beyond the 16-commit bound a " +
        "queue-gated base is accepted within",
    );
  });

  it("refuses a base-moved when the base's queue requires no status-check context", () => {
    const result = baseFreshnessPermit({
      acknowledgement: NO_ACK,
      measurement: ok(MOVED),
      queueGate: { ...GATED_QUEUE, contexts: [] },
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).reasons[1]).toBe(
      "the merge queue does not excuse this: main's queue requires NO status-check contexts, so it would merge " +
        "an entry on arrival without testing the merged result",
    );
  });

  it("refuses a base-moved whose drift could not be counted, even under a gating queue", () => {
    const result = baseFreshnessPermit({
      acknowledgement: NO_ACK,
      measurement: ok({ ...MOVED, behindBy: undefined }),
      queueGate: GATED_QUEUE,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).reasons[1]).toBe(
      "the merge queue does not excuse this: how far the base has advanced past this head could not be counted",
    );
  });

  it("still warns about reverted files on an ACCEPTED queue-gated base-moved", () => {
    const result = baseFreshnessPermit({
      acknowledgement: NO_ACK,
      measurement: ok({ ...MOVED, reverted: [{ path: "src/poster.ts", restoresBaseCommit: "aaaaaaa" }] }),
      queueGate: GATED_QUEUE,
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).lines.some((line) => line.includes("src/poster.ts"))).toBe(true);
  });

  it("leaves a FRESH base untouched by a queue gate", () => {
    const result = baseFreshnessPermit({ acknowledgement: NO_ACK, measurement: ok(FRESH), queueGate: GATED_QUEUE });
    expect(unwrap(result).lines).toHaveLength(1);
    expect(unwrap(result).lines[0]).toContain("current");
  });
});

describe("queueGatedBaseMoved", () => {
  const MOVED_TWO = {
    baseBranch: "main",
    baseSha: "ccc",
    behindBy: 2,
    headSha: "bbb",
    kind: "base-moved" as const,
    remote: "origin",
    reverted: [],
  };

  it("does not apply when no queue could be read", () => {
    const relaxation = queueGatedBaseMoved({ freshness: MOVED_TWO, queueGate: undefined });
    expect(relaxation.kind).toBe("not-applicable");
  });

  it("accepts a gated queue inside the bound", () => {
    const relaxation = queueGatedBaseMoved({
      freshness: MOVED_TWO,
      queueGate: { branch: "main", contexts: ["build"], url: "https://q.example/main" },
    });
    expect(relaxation.kind).toBe("accepted");
  });

  // The bound must clear a whole cycle at the busiest cadence measured on this tree (3 h worst case: 15),
  // never just one gate lap — sized at 8 it came within one commit of refusing its own pull request.
  it("is bounded by a number measured from this repository's own landing rate", () => {
    expect(QUEUE_GATED_BASE_DRIFT).toBe(16);
  });
});

const LANDED = { baseBranch: "origin/main", headBranch: "a-branch", kind: "landed" } as const;

describe("alreadyLandedPermit", () => {
  it("refuses a head whose every commit is already on the base", () => {
    const result = alreadyLandedPermit({
      acknowledgement: { acknowledge: [], acknowledgeAll: false, reason: undefined },
      measurement: LANDED,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).reasons[0]).toContain("refused: already-landed");
    expect(unwrapErr(result).reasons[0]).toContain("a-branch");
    expect(unwrapErr(result).reasons[1]).toContain("already merged");
  });

  it("names the reason requirement in the refusal, so the escape hatch is not a guess", () => {
    const result = alreadyLandedPermit({
      acknowledgement: { acknowledge: [], acknowledgeAll: false, reason: undefined },
      measurement: LANDED,
    });
    expect(unwrapErr(result).reasons[2]).toBe(
      'accept with --acknowledge already-landed --reason "…", or every finding with --acknowledge-all --reason "…"',
    );
  });

  it("REFUSES a bare acknowledgement, because which deliberate re-land this is decides everything", () => {
    const result = alreadyLandedPermit({
      acknowledgement: { acknowledge: [ALREADY_LANDED_ACK], acknowledgeAll: false, reason: undefined },
      measurement: LANDED,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).reasons[1]).toContain("--acknowledge already-landed must be paired with --reason");
  });

  it("REFUSES an acknowledgement whose reason is only whitespace", () => {
    const result = alreadyLandedPermit({
      acknowledgement: { acknowledge: [ALREADY_LANDED_ACK], acknowledgeAll: false, reason: "   " },
      measurement: LANDED,
    });
    expect(unwrapErr(result).reasons[1]).toBe(
      '--acknowledge already-landed must be paired with --reason "…" naming which deliberate re-land this is',
    );
  });

  it("accepts a named acknowledgement carrying a reason, and prints the reason back", () => {
    const result = alreadyLandedPermit({
      acknowledgement: {
        acknowledge: [ALREADY_LANDED_ACK],
        acknowledgeAll: false,
        reason: "re-land after #12 was reverted",
      },
      measurement: LANDED,
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).lines[0]).toContain("ACKNOWLEDGED (already-landed)");
    expect(unwrap(result).lines[1]).toBe("reason: re-land after #12 was reverted");
  });

  it("accepts --acknowledge-all, which already carries its own required reason", () => {
    const result = alreadyLandedPermit({
      acknowledgement: { acknowledge: [], acknowledgeAll: true, reason: "forward cherry-pick onto release-3" },
      measurement: LANDED,
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).lines[1]).toBe("acknowledged ALL findings — reason: forward cherry-pick onto release-3");
  });

  it("says nothing at all when the branch is not landed, so a clean create stays quiet", () => {
    const result = alreadyLandedPermit({
      acknowledgement: { acknowledge: [], acknowledgeAll: false, reason: undefined },
      measurement: { kind: "not-landed" },
    });
    expect(unwrap(result).lines).toStrictEqual([]);
  });

  it("reports a skip rather than refusing, because this check fails OPEN", () => {
    const result = alreadyLandedPermit({
      acknowledgement: { acknowledge: [], acknowledgeAll: false, reason: undefined },
      measurement: { kind: "skipped", why: "no readable origin remote" },
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).lines).toStrictEqual(["already-landed check SKIPPED: no readable origin remote"]);
  });
});

describe("behindBaseAdvisory", () => {
  it("names the count, the remote and the branch", () => {
    expect(behindBaseAdvisory({ baseBranch: "main", behindBy: 5, remote: "origin" })).toStrictEqual([
      "⚠ this branch is 5 commits behind origin/main",
    ]);
  });

  it("says one commit in the singular, and still reads as behind origin", () => {
    expect(behindBaseAdvisory({ baseBranch: "main", behindBy: 1, remote: "origin" })).toStrictEqual([
      "⚠ this branch is 1 commit behind origin/main",
    ]);
  });

  it("names the remote it was actually measured against, never origin by assumption", () => {
    expect(behindBaseAdvisory({ baseBranch: "staging", behindBy: 12, remote: "upstream" })).toStrictEqual([
      "⚠ this branch is 12 commits behind upstream/staging",
    ]);
  });

  it("says nothing at zero, so a current worktree adds no noise", () => {
    expect(behindBaseAdvisory({ baseBranch: "main", behindBy: 0, remote: "origin" })).toStrictEqual([]);
  });

  it("says nothing when the count could not be taken, rather than guessing one", () => {
    expect(behindBaseAdvisory({ baseBranch: "main", behindBy: undefined, remote: "origin" })).toStrictEqual([]);
  });
});

describe("behindBaseLines", () => {
  const MOVED_BY = ({ behindBy }: { behindBy: number | undefined }) =>
    ok({
      baseBranch: "main",
      baseSha: "ccc",
      behindBy,
      headSha: "bbb",
      kind: "base-moved" as const,
      remote: "origin",
      reverted: [],
    });

  it("carries the measured drift through to the line", () => {
    expect(behindBaseLines({ measurement: MOVED_BY({ behindBy: 7 }) })).toStrictEqual([
      "⚠ this branch is 7 commits behind origin/main",
    ]);
  });

  it("says nothing on a fresh base, because an ancestor tip leaves head..base empty by definition", () => {
    const fresh = ok({
      baseBranch: "main",
      baseSha: "aaa",
      headSha: "bbb",
      kind: "fresh" as const,
      remote: "origin",
      reverted: [],
    });
    expect(behindBaseLines({ measurement: fresh })).toStrictEqual([]);
  });

  it("says nothing when the drift itself could not be counted", () => {
    expect(behindBaseLines({ measurement: MOVED_BY({ behindBy: undefined }) })).toStrictEqual([]);
  });

  it("says nothing on a skipped measurement, which measured no base at all", () => {
    const skipped = ok({ kind: "skipped" as const, why: "no readable origin remote" });
    expect(behindBaseLines({ measurement: skipped })).toStrictEqual([]);
  });

  it("says nothing on an unmeasurable result", () => {
    expect(
      behindBaseLines({
        measurement: err(GithubVerbErrors.upstreamRefused({ operation: "fetch", reasons: ["git fetch failed"] })),
      }),
    ).toStrictEqual([]);
  });
});

describe("printBaseFreshnessPermit prints the advisory without touching the verdict", () => {
  const NO_ACK = { acknowledge: [], acknowledgeAll: false, reason: undefined };
  const BEHIND = ok({
    baseBranch: "main",
    baseSha: "ccc",
    behindBy: 4,
    headSha: "bbb",
    kind: "base-moved" as const,
    remote: "origin",
    reverted: [],
  });
  const CURRENT = ok({
    baseBranch: "main",
    baseSha: "aaa",
    headSha: "bbb",
    kind: "fresh" as const,
    remote: "origin",
    reverted: [],
  });

  it("leads a behind worktree's output with the advisory, above the refusal it does not change", () => {
    const lines: string[] = [];
    const refused = printBaseFreshnessPermit({
      acknowledgement: NO_ACK,
      measurement: BEHIND,
      out: ({ line }) => lines.push(line),
    });
    expect(lines[0]).toBe("⚠ this branch is 4 commits behind origin/main");
    expect(refused).toBe(true);
    expect(lines[1]).toContain("refused: base-moved");
  });

  it("prints a current worktree's verdict and nothing else — the exact lines, so a leaked advisory fails", () => {
    const lines: string[] = [];
    const refused = printBaseFreshnessPermit({
      acknowledgement: NO_ACK,
      measurement: CURRENT,
      out: ({ line }) => lines.push(line),
    });
    expect(lines).toStrictEqual(["base freshness: current — main@aaa is an ancestor of bbb"]);
    expect(refused).toBe(false);
  });

  it("returns exactly what the pure permit decided, on both a behind and a current tree", () => {
    const behindVerdict = printBaseFreshnessPermit({
      acknowledgement: NO_ACK,
      measurement: BEHIND,
      out: () => undefined,
    });
    const currentVerdict = printBaseFreshnessPermit({
      acknowledgement: NO_ACK,
      measurement: CURRENT,
      out: () => undefined,
    });
    expect(behindVerdict).toBe(baseFreshnessPermit({ acknowledgement: NO_ACK, measurement: BEHIND }).isErr());
    expect(currentVerdict).toBe(baseFreshnessPermit({ acknowledgement: NO_ACK, measurement: CURRENT }).isErr());
  });
});

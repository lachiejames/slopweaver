/**
 * The half of the `handover list` fix that is about SILENCE rather than speed.
 *
 * MEASURED: the verb took 474 s over 1,387 docs and printed zero bytes to stdout AND stderr until
 * the very end, so a caller bounded at 100 s got an empty result indistinguishable from an empty board — and
 * `AGENTS.md` makes that board the only register of what is in flight. The per-repository ahead index took the
 * sweep to 20 s; these are the guards for the day a board outgrows even that. A truncated board must still
 * PRINT, and it must say so.
 */
import { describe, expect, it } from "vitest";

import { deadlineIn, probeCandidatesByRepo, probeStates } from "../../../../../cli/commands/handover/probeSweep.js";
import { deadlineSeconds } from "../../../../../cli/commands/handover/run.js";
import type { HandoverDoc } from "../../../../../handover/doc.js";

/**
 * A doc that declares one probe and names a repo — the only shape a sweep does any work for.
 *
 * The repo deliberately does not exist, so the sweep's git seam answers "nothing measurable" without a
 * fixture repository: what is under test here is the CUT and the COUNT, not what a probe decided.
 */
function docWithProbe({ slug }: { slug: string }): HandoverDoc {
  return {
    anchor: undefined,
    artifact: undefined,
    askedIso: undefined,
    baseBranch: undefined,
    blockedBy: [],
    branch: undefined,
    doneWhen: [{ kind: "path", path: "docs/never-there.md" }],
    evidence: [],
    kind: "doc",
    notDoneReason: undefined,
    observedBy: undefined,
    registeredBy: undefined,
    registeredRun: undefined,
    origin: undefined,
    outputs: [],
    path: `/handovers/${slug}.md`,
    pausedOn: undefined,
    pausedSince: undefined,
    risk: undefined,
    blastRadius: undefined,
    stillReal: undefined,
    stillRealIso: undefined,
    priority: undefined,
    probeWaiver: undefined,
    lean: undefined,
    examples: [],
    exampleGap: undefined,
    options: [],
    problem: undefined,
    problems: [],
    repo: "/definitely/not/a/repo/here",
    role: undefined,
    ruling: undefined,
    rulingAnchor: undefined,
    hisWords: { kind: "absent" },
    hisWordsSteers: [],
    settlement: undefined,
    settlementReason: undefined,
    settlementWitness: undefined,
    slug,
    status: "ready",
    statusSummary: undefined,
    summary: undefined,
    supervisorState: undefined,
  };
}

describe("deadlineSeconds", () => {
  it("defaults to 60 when the flag is absent", () => {
    expect(deadlineSeconds({ raw: undefined })).toBe(60);
  });

  it("takes a whole number of seconds", () => {
    expect(deadlineSeconds({ raw: "30" })).toBe(30);
  });

  it("takes 0, which the caller reads as no deadline at all", () => {
    expect(deadlineSeconds({ raw: "0" })).toBe(0);
  });

  /** `parseInt` reads `30s` as 30. A budget silently taken from a typo is the quiet wrong answer this change is about. */
  it("refuses a value with a trailing unit", () => {
    expect(deadlineSeconds({ raw: "30s" })).toBeUndefined();
  });

  it("refuses a negative value", () => {
    expect(deadlineSeconds({ raw: "-1" })).toBeUndefined();
  });

  it("refuses a value that is not a number", () => {
    expect(deadlineSeconds({ raw: "later" })).toBeUndefined();
  });
});

describe("deadlineIn", () => {
  it("never expires when the budget is 0", () => {
    expect(deadlineIn({ seconds: 0 }).expired()).toBe(false);
  });

  it("has not expired the instant it is created", () => {
    expect(deadlineIn({ seconds: 60 }).expired()).toBe(false);
  });
});

describe("probeStates under an expired deadline", () => {
  /**
   * The deadline is an injected seam rather than a real clock, so this asserts the CUT rather than waiting for
   * one. An always-expired deadline is the boundary case: nothing resolves, and every doc that would have been
   * swept is COUNTED, because a board short some rows without saying so is the failure being closed.
   */
  const alwaysExpired = { expired: (): boolean => true };

  it("resolves nothing and counts every probe-carrying doc as unresolved", () => {
    const sweep = probeStates({
      base: "main",
      deadline: alwaysExpired,
      docs: [docWithProbe({ slug: "one" }), docWithProbe({ slug: "two" })],
      runCommands: false,
    });

    expect(sweep.states.size).toBe(0);
    expect(sweep.total).toBe(2);
    expect(sweep.unresolved).toBe(2);
  });

  it("reports zero unresolved for a board with nothing to sweep, so no banner can fire on an empty board", () => {
    const sweep = probeStates({ base: "main", deadline: alwaysExpired, docs: [], runCommands: false });

    expect(sweep.total).toBe(0);
    expect(sweep.unresolved).toBe(0);
  });
});

describe("probeStates reports progress as it goes", () => {
  /**
   * The witness for "not silence". A plain function collecting calls is a seam, not a mock — and it can fire,
   * which is the property to check: the same sweep with an expired deadline below reports NOTHING.
   */
  it("calls back once per resolved doc, carrying the running count and the total", () => {
    const seen: Array<{ resolved: number; total: number }> = [];
    const sweep = probeStates({
      base: "main",
      docs: [docWithProbe({ slug: "one" }), docWithProbe({ slug: "two" })],
      onProgress: (progress) => {
        seen.push(progress);
      },
      runCommands: false,
    });

    expect(seen).toEqual([
      { resolved: 1, total: 2 },
      { resolved: 2, total: 2 },
    ]);
    expect(sweep.unresolved).toBe(0);
  });

  it("reports nothing when the deadline cut the sweep before its first doc", () => {
    const seen: Array<{ resolved: number; total: number }> = [];
    probeStates({
      base: "main",
      deadline: { expired: (): boolean => true },
      docs: [docWithProbe({ slug: "one" })],
      onProgress: (progress) => {
        seen.push(progress);
      },
      runCommands: false,
    });

    expect(seen).toEqual([]);
  });
});

describe("probeCandidatesByRepo", () => {
  it("unions every doc's candidates per repository, each once, before any index is built", () => {
    const first = { ...docWithProbe({ slug: "atlas" }), repo: "/repo/a" };
    const second = { ...docWithProbe({ slug: "board" }), branch: "atlas", repo: "/repo/a" };
    const other = { ...docWithProbe({ slug: "atlas" }), repo: "/repo/b" };

    const byRepo = probeCandidatesByRepo({ docs: [first, second, other] });

    expect([...byRepo.keys()]).toEqual(["/repo/a", "/repo/b"]);
    expect(byRepo.get("/repo/a")).toEqual(["atlas", "worktree-atlas", "board", "worktree-board"]);
    expect(byRepo.get("/repo/b")).toEqual(["atlas", "worktree-atlas"]);
  });

  it("leaves a doc naming no repository out", () => {
    const loose = { ...docWithProbe({ slug: "atlas" }), repo: undefined };

    expect(probeCandidatesByRepo({ docs: [loose] }).size).toBe(0);
  });
});

/**
 * The in-flight claim: what a live run is building, derived rather than declared. Pure input → exact verdicts,
 * so every claim below is falsifiable.
 *
 * Two properties carry the most weight, and each maps to a measured collision this module's rendering exists to
 * make visible on `fleet status`:
 *
 *  - a claim EXPIRES when its process is gone or its journal has stopped moving. A claim that outlives its run
 *    is a new failure mode rather than a fix, so the expiry half is asserted as hard as the liveness half.
 *  - a doc that claims nothing says so. `blind` is never allowed to be empty by omission, because "no claim"
 *    computed from an empty claim is ignorance reported as safety.
 */
import { describe, expect, it } from "vitest";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { ParsedLedger, RunEvent } from "../../../handover/ledger.js";
import {
  claimedPaths,
  claimLiveness,
  DEFAULT_CLAIM_STALE_MS,
  type RunClaim,
  renderClaim,
  runClaimFor,
} from "../../../measurement/overlap.js";
import { type Measured, measured } from "../../../measurement/status.js";

const NOW = Date.parse("2026-08-06T04:18:00.000Z");

/** A doc with the fields a claim is derived from, everything else at its empty default. */
function doc(over: Partial<HandoverDoc> = {}): HandoverDoc {
  return {
    anchor: undefined,
    askedIso: undefined,
    kind: "doc",
    priority: undefined,
    settlement: undefined,
    settlementReason: undefined,
    settlementWitness: undefined,
    origin: undefined,
    observedBy: undefined,
    registeredBy: undefined,
    registeredRun: undefined,
    evidence: [],
    ruling: undefined,
    rulingAnchor: undefined,
    hisWords: { kind: "absent" },
    hisWordsSteers: [],
    artifact: undefined,
    baseBranch: undefined,
    blockedBy: [],
    branch: undefined,
    doneWhen: [],
    notDoneReason: undefined,
    outputs: [],
    pausedOn: undefined,
    pausedSince: undefined,
    risk: undefined,
    blastRadius: undefined,
    stillReal: undefined,
    stillRealIso: undefined,
    path: "/handovers/a-doc.md",
    probeWaiver: undefined,
    lean: undefined,
    examples: [],
    exampleGap: undefined,
    options: [],
    problem: undefined,
    problems: [],
    repo: "/repo",
    role: undefined,
    slug: "a-doc",
    status: "ready",
    statusSummary: undefined,
    supervisorState: undefined,
    summary: undefined,
    ...over,
  };
}

/** A journal from a list of events, with no undecodable lines unless a test asks for some. */
function journal({
  events,
  unreadable = [],
  unknownKind = [],
}: {
  events: readonly RunEvent[];
  unreadable?: readonly number[];
  unknownKind?: ParsedLedger["unknownKind"];
}): ParsedLedger {
  return { events, unknownKind, unreadable };
}

/** The `started` every live run opens with. */
function started({ atIso = "2026-08-06T04:00:00.000Z", branch = "feat/a" }: { atIso?: string; branch?: string } = {}) {
  return { atIso, branch, docHash: "abc123", kind: "started" } as const;
}

/** The `launched` that names the writer, the process and the checkout. */
function launched({
  atIso = "2026-08-06T04:02:00.000Z",
  pid = 4242,
  sessionId = "session-one",
  worktree = "/trees/a-doc",
}: {
  atIso?: string;
  pid?: number | undefined;
  sessionId?: string;
  worktree?: string | undefined;
} = {}) {
  return { atIso, kind: "launched", pid, sessionId, worktree } as const;
}

/** The seams, defaulting to a live session and the shipped staleness bound. */
function seams({
  nowMs = NOW,
  staleAfterMs = DEFAULT_CLAIM_STALE_MS,
  sessionLive = () => measured({ value: true }),
}: {
  nowMs?: number;
  staleAfterMs?: number;
  sessionLive?: (args: { sessionId: string }) => Measured<boolean>;
} = {}) {
  return { nowMs, sessionLive, staleAfterMs };
}

/** A live claim, spread over so each collision test varies exactly one field. */
function claim(over: Partial<RunClaim> = {}): RunClaim {
  return {
    blind: [],
    branch: "feat/a",
    liveness: { live: true, why: "open, last moved 16m ago — process 4242 is alive" },
    paths: ["src/fleet/overlap.ts"],
    repo: "/repo",
    slug: "other-doc",
    writer: { atIso: "2026-08-06T04:02:00.000Z", pid: 4242, sessionId: "session-one", worktree: "/trees/other" },
    ...over,
  };
}

describe("claimedPaths — the claim is derived from the doc, never registered", () => {
  it("takes the file from a `present:` probe and the path from a `path:` probe", () => {
    const derived = claimedPaths({
      doc: doc({
        doneWhen: [
          { file: "src/fleet/overlap.ts", kind: "present", symbol: "export" },
          { kind: "path", path: "docs/collisions.md" },
        ],
      }),
    });
    expect(derived.paths).toEqual(["docs/collisions.md", "src/fleet/overlap.ts"]);
    expect(derived.blind).toEqual([]);
  });

  it("takes an `absent:` probe's file too — removing a symbol is still touching the file", () => {
    expect(
      claimedPaths({ doc: doc({ doneWhen: [{ file: "src/old.ts", kind: "absent", symbol: "legacy" }] }) }).paths,
    ).toEqual(["src/old.ts"]);
  });

  it("counts `outputs:`, which `probe.ts` deliberately refuses to turn into probes", () => {
    expect(claimedPaths({ doc: doc({ outputs: ["docs/architecture.md"] }) }).paths).toEqual(["docs/architecture.md"]);
  });

  it("drops a URL output, because nothing on this machine can collide with one", () => {
    const derived = claimedPaths({ doc: doc({ outputs: ["https://example.invalid/x", "docs/a.md"] }) });
    expect(derived.paths).toEqual(["docs/a.md"]);
    expect(derived.blind).toEqual([
      "outputs[0] names `https://example.invalid/x`, which is not a path this machine can compare",
    ]);
  });

  it("normalises `./` and duplicate separators, so two docs naming one file agree on its spelling", () => {
    expect(claimedPaths({ doc: doc({ outputs: ["./src//fleet/overlap.ts", "src/fleet/overlap.ts"] }) }).paths).toEqual([
      "src/fleet/overlap.ts",
    ]);
  });

  it("refuses a `..` path rather than resolving it against a base it does not have", () => {
    const derived = claimedPaths({ doc: doc({ outputs: ["../elsewhere/x.ts"] }) });
    expect(derived.paths).toEqual([]);
    expect(derived.blind[0]).toContain("which is not a path this machine can compare");
  });

  it("says a `command:` probe names no path, rather than silently claiming less", () => {
    const derived = claimedPaths({ doc: doc({ doneWhen: [{ command: "yarn test", kind: "command" }] }) });
    expect(derived.paths).toEqual([]);
    expect(derived.blind).toEqual([
      "doneWhen[0] is a `command:` probe, so it names no path to claim",
      "this doc claims no path at all, so an overlap with it cannot be computed",
    ]);
  });

  it("says so when a doc declares nothing at all — an empty claim is ignorance, not safety", () => {
    expect(claimedPaths({ doc: doc() }).blind).toEqual([
      "this doc claims no path at all, so an overlap with it cannot be computed",
    ]);
  });
});

describe("claimLiveness — a claim that outlives its session is the next silent failure", () => {
  it("stands for an open run whose recorded process is alive", () => {
    const live = claimLiveness({
      ambiguous: false,
      ended: false,
      lastEventIso: "2026-08-06T04:02:00.000Z",
      phase: "open",
      seams: seams(),
      sessionId: "sess-4242",
    });
    expect(live.live).toBe(true);
    expect(live.why).toBe("open, last moved 16m ago — session sess-4242 was not proven gone");
  });

  it("EXPIRES when the recorded session is gone, naming the session that went with it", () => {
    const dead = claimLiveness({
      ambiguous: false,
      ended: false,
      lastEventIso: "2026-08-06T04:02:00.000Z",
      phase: "open",
      seams: seams({ sessionLive: () => measured({ value: false }) }),
      sessionId: "sess-4242",
    });
    expect(dead.live).toBe(false);
    expect(dead.why).toBe("session sess-4242 is not running, so the claim expired with it");
  });

  it("EXPIRES when the journal has not moved past the bound a drive runs under", () => {
    const stale = claimLiveness({
      ambiguous: false,
      ended: false,
      lastEventIso: "2026-08-05T20:00:00.000Z",
      phase: "open",
      seams: seams(),
      sessionId: undefined,
    });
    expect(stale.live).toBe(false);
    expect(stale.why).toBe("the journal has not moved for 498m, past the 120m a drive runs for");
  });

  /**
   * The AND is deliberate and it has a cost, so it is pinned here rather than left to be rediscovered. Resting on
   * the process alone would let a rebooted machine hold a claim forever on a reused pid; keeping the bound means
   * `--minutes 300` can expire a claim while its agent still works. The second failure is escapable with one
   * environment variable and the first is not.
   */
  it("EXPIRES on journal age even while the process is alive, so a reused pid cannot haunt the gate", () => {
    const stale = claimLiveness({
      ambiguous: false,
      ended: false,
      lastEventIso: "2026-08-05T20:00:00.000Z",
      phase: "open",
      seams: seams({ sessionLive: () => measured({ value: true }) }),
      sessionId: "sess-4242",
    });
    expect(stale.live).toBe(false);
    expect(stale.why).toBe("the journal has not moved for 498m, past the 120m a drive runs for");
  });

  it("rests on journal freshness alone when no session was recorded, and says which evidence answered", () => {
    const live = claimLiveness({
      ambiguous: false,
      ended: false,
      lastEventIso: "2026-08-06T04:02:00.000Z",
      phase: "open",
      seams: seams(),
      sessionId: undefined,
    });
    expect(live.live).toBe(true);
    expect(live.why).toBe(
      "open, last moved 16m ago — no session was recorded, so this rests on journal freshness alone",
    );
  });

  it("holds a claim for a run waiting on the owner — the work is half-written, whoever is blocked", () => {
    const live = claimLiveness({
      ambiguous: false,
      ended: false,
      lastEventIso: "2026-08-06T04:02:00.000Z",
      phase: "waiting-on-owner",
      seams: seams(),
      sessionId: "sess-4242",
    });
    expect(live.live).toBe(true);
    expect(live.why).toBe("waiting on the owner, last moved 16m ago — session sess-4242 was not proven gone");
  });

  it("expires a closed run", () => {
    expect(
      claimLiveness({
        ambiguous: false,
        ended: false,
        lastEventIso: "2026-08-06T04:02:00.000Z",
        phase: "closed",
        seams: seams(),
        sessionId: "sess-4242",
      }),
    ).toEqual({ live: false, why: "the run is closed" });
  });

  it("expires a doc nobody has ever started", () => {
    expect(
      claimLiveness({
        ambiguous: false,
        ended: false,
        lastEventIso: undefined,
        phase: "no-run",
        seams: seams(),
        sessionId: undefined,
      }),
    ).toEqual({ live: false, why: "no run has ever started for this doc" });
  });

  it("expires a drive that has ended, even while its run stays open", () => {
    expect(
      claimLiveness({
        ambiguous: false,
        ended: true,
        lastEventIso: "2026-08-06T04:02:00.000Z",
        phase: "open",
        seams: seams(),
        sessionId: "sess-4242",
      }),
    ).toEqual({ live: false, why: "the drive has ended, so no agent is building this" });
  });

  it("states the doubt when the journal carries a kind this build cannot decode", () => {
    expect(
      claimLiveness({
        ambiguous: true,
        ended: false,
        lastEventIso: "2026-08-06T04:02:00.000Z",
        phase: "open",
        seams: seams(),
        sessionId: "sess-4242",
      }).why,
    ).toBe(
      "open, last moved 16m ago — session sess-4242 was not proven gone; its journal has lines this build cannot decode, " +
        "so it may have moved further",
    );
  });

  it("keeps the claim standing when the journal has no timestamp to age it against", () => {
    const live = claimLiveness({
      ambiguous: false,
      ended: false,
      lastEventIso: undefined,
      phase: "open",
      seams: seams(),
      sessionId: undefined,
    });
    expect(live.live).toBe(true);
    expect(live.why).toBe("the run is open, but its journal carries no readable timestamp to age it against");
  });
});

describe("runClaimFor — the journal decides liveness, the doc decides the paths", () => {
  it("carries the writer, the branch and the paths of a live run", () => {
    const derived = runClaimFor({
      doc: doc({ doneWhen: [{ file: "src/fleet/overlap.ts", kind: "present", symbol: "export" }] }),
      journal: journal({ events: [started(), launched()] }),
      seams: seams(),
    });
    expect(derived.liveness.live).toBe(true);
    expect(derived.paths).toEqual(["src/fleet/overlap.ts"]);
    expect(derived.branch).toBe("feat/a");
    expect(derived.writer?.sessionId).toBe("session-one");
  });

  it("prefers the branch the run actually opened on over the one the doc declared", () => {
    expect(
      runClaimFor({
        doc: doc({ branch: "feat/declared" }),
        journal: journal({ events: [started({ branch: "feat/actual" })] }),
        seams: seams(),
      }).branch,
    ).toBe("feat/actual");
  });

  it("reports an undecodable line as a gap, naming which line — an unknown kind hides what it recorded", () => {
    const derived = runClaimFor({
      doc: doc({ outputs: ["src/a.ts"] }),
      journal: journal({ events: [started(), launched()], unreadable: [7] }),
      seams: seams(),
    });
    expect(derived.blind).toEqual([
      "its journal has 1 line(s) this build cannot decode (line 7) — an unknown kind hides whatever it recorded",
    ]);
  });

  it("keeps a claim STANDING when the journal could not be read at all, and says that is why", () => {
    const derived = runClaimFor({ doc: doc({ outputs: ["src/a.ts"] }), journal: undefined, seams: seams() });
    expect(derived.liveness).toEqual({
      live: true,
      why: "its run journal could not be read, so nothing proved the claim expired",
    });
    expect(derived.writer).toBe(undefined);
  });
});

/**
 * The property a lock would have needed a corpse-stealing protocol to get: ownership is re-verified on every
 * check, because nothing is ever acquired. Asserted by feeding one unchanged doc and journal through two calls
 * whose only difference is the process probe, and getting two different verdicts.
 */
describe("nothing is acquired, so every check re-verifies", () => {
  it("re-derives liveness per call — the same doc and journal answer live, then expired", () => {
    const fixed = { doc: doc({ outputs: ["src/a.ts"] }), journal: journal({ events: [started(), launched()] }) };
    const before = runClaimFor({ ...fixed, seams: seams({ sessionLive: () => measured({ value: true }) }) });
    const after = runClaimFor({ ...fixed, seams: seams({ sessionLive: () => measured({ value: false }) }) });

    expect(before.liveness.live).toBe(true);
    expect(after.liveness.live).toBe(false);
    expect(after.liveness.why).toBe("session session-one is not running, so the claim expired with it");
  });

  it("re-reads the writer per call rather than carrying one forward", () => {
    const first = runClaimFor({
      doc: doc(),
      journal: journal({ events: [started(), launched()] }),
      seams: seams(),
    });
    const second = runClaimFor({
      doc: doc(),
      journal: journal({ events: [started(), launched({ sessionId: "session-two" })] }),
      seams: seams(),
    });

    expect(first.writer?.sessionId).toBe("session-one");
    expect(second.writer?.sessionId).toBe("session-two");
  });
});

describe("renderClaim", () => {
  it("prints what is claimed alongside why the claim stands", () => {
    expect(renderClaim({ claim: claim() })).toBe(
      "LIVE — open, last moved 16m ago — process 4242 is alive\n              claims src/fleet/overlap.ts",
    );
  });

  it("prints `nothing` rather than an empty list, so a claimless doc is visible", () => {
    expect(renderClaim({ claim: claim({ blind: ["it claims nothing"], paths: [] }) })).toBe(
      "LIVE — open, last moved 16m ago — process 4242 is alive\n              claims nothing · 1 gap(s): it claims nothing",
    );
  });

  it("prints an expired claim as expired, with the reason it went", () => {
    expect(renderClaim({ claim: claim({ liveness: { live: false, why: "the driving process 4242 is gone" } }) })).toBe(
      "expired — the driving process 4242 is gone\n              claims src/fleet/overlap.ts",
    );
  });
});

describe("the shipped defaults", () => {
  it("expires a claim at the bound a drive runs under, rather than at a number picked here", () => {
    expect(DEFAULT_CLAIM_STALE_MS).toBe(2 * 60 * 60 * 1000);
  });
});

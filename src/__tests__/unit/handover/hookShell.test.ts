import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { NoWorkClaimStopSeams } from "../../../cli/commands/handover/hookNoWorkClaim.js";
import { runHookWith } from "../../../cli/commands/handover/hookRun.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import type { OpenRun } from "../../../handover/hookGate.js";
import { slugsWithJournals } from "../../../handover/hookJournalScan.js";
import {
  blockOutput,
  contextOutput,
  type RunScanSeams,
  recordGateObservation,
  runsOnDisk,
} from "../../../handover/hookShell.js";
import { ledgerLine, parseLedger, type RunEvent } from "../../../handover/ledger.js";
import type { Probe, ProbeResult } from "../../../handover/probe.js";
import { measured } from "../../../measurement/status.js";

const AT = "2026-08-04T00:00:00.000Z";
const HEAD = "1111111111111111111111111111111111111111";
const MINE = "session-mine";
const THEIRS = "session-theirs";
const PROBE: Probe = { file: "src/a.ts", kind: "present", symbol: "export" };

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A real runs directory, written and read back — a fixture round-trip, not a shared service. */
function runsDirWith({ journals }: { journals: Readonly<Record<string, string>> }): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-runs-"));
  fixtureDirs.push(dir);
  for (const [slug, text] of Object.entries(journals)) {
    writeFileSync(join(dir, `${slug}.jsonl`), text, "utf8");
  }
  return dir;
}

const DOC = parseHandoverDoc({
  path: "/h/a-doc.md",
  text: "---\nslug: a-doc\nstatus: ready\nrepo: /some/repo\ndoneWhen:\n  - path: x\n  - path: y\n---\n",
});

/** Two failing probes, the shape a doc with unfinished work reports. */
const TWO_FAILING: readonly ProbeResult[] = [
  { note: "x does not exist", outcome: "fail", probe: PROBE },
  { note: "y does not exist", outcome: "fail", probe: PROBE },
];

/** The seams, defaulting to a resolvable branch and two failing probes so each test relaxes one thing. */
function seams({
  branchHead = () => HEAD,
  codexThread = () => ({ kind: "not-observed", why: "no Codex process holds this thread" }),
  commandSessionIds = [MINE],
  evaluate = () => TWO_FAILING,
  sessionId = MINE,
  nowMs = Date.parse("2026-08-06T03:00:00.000Z"),
  sessionLive = () => measured({ value: true }),
  processAlive = () => true,
}: Partial<RunScanSeams> = {}): RunScanSeams {
  return { branchHead, codexThread, commandSessionIds, evaluate, nowMs, processAlive, sessionId, sessionLive };
}

/** The runs a scan examined; every case here sits under the journal cap, so the skip summary is not its subject. */
function runsIn(args: Parameters<typeof runsOnDisk>[0]): readonly OpenRun[] {
  return runsOnDisk(args).runs;
}

describe("slugsWithJournals", () => {
  it("is empty for a directory that does not exist, so a hook is inert on a fresh machine", () => {
    expect(slugsWithJournals({ runsDir: "/nope/never/here" })).toEqual([]);
  });

  it("recovers each slug from its filename, sorted, ignoring anything else", () => {
    const dir = runsDirWith({ journals: { alpha: "", beta: "" } });
    writeFileSync(join(dir, "notes.txt"), "x", "utf8");

    expect(slugsWithJournals({ runsDir: dir })).toEqual(["alpha", "beta"]);
  });
});

describe("runsOnDisk", () => {
  const started = ledgerLine({ event: { atIso: AT, branch: "feat/a", docHash: "h", kind: "started" } });

  it("reports an open run as resolving when the branch exists, carrying its head", () => {
    const dir = runsDirWith({ journals: { "a-doc": started } });

    const run = runsIn({ boardPartial: false, docs: [DOC], runsDir: dir, seams: seams() })[0]!;

    expect(run.branchResolves).toBe(true);
    expect(run.head).toBe(HEAD);
    expect(run.branch).toBe("feat/a");
    expect(run.phase).toBe("open");
  });

  it("reports branchResolves false when the branch is gone, which is what disarms the gate", () => {
    const dir = runsDirWith({ journals: { "a-doc": started } });
    const runs = runsIn({
      boardPartial: false,
      docs: [DOC],
      runsDir: dir,
      seams: seams({ branchHead: () => undefined }),
    });

    expect(runs[0]!.branchResolves).toBe(false);
  });

  const SETTLED_DOC = parseHandoverDoc({
    path: "/h/a-doc.md",
    text: "---\nslug: a-doc\nkind: ask\nstatus: ready\nsettlement: answered\nsettlementWitness: https://example.invalid/p1\n---\n",
  });

  /** A foreign Claude Code writer, so the registry decides its liveness rather than a pid. */
  const launchedByTheirs = ledgerLine({
    event: { atIso: AT, host: "claude-code", kind: "launched", pid: 4242, sessionId: THEIRS, worktree: "/wt" },
  });

  it("carries the owning row's settlement, so the brief can refuse to offer a claim on landed work", () => {
    const dir = runsDirWith({ journals: { "a-doc": started } });

    const [settled] = runsIn({ boardPartial: false, docs: [SETTLED_DOC], runsDir: dir, seams: seams() });
    const [unsettled] = runsIn({ boardPartial: false, docs: [DOC], runsDir: dir, seams: seams() });

    expect(settled!.settled).toEqual({ settlement: "answered", witness: "https://example.invalid/p1" });
    expect(unsettled!.settled).toBe(undefined);
  });

  it("asks the REAPER whether the cycle is reapable, rather than deriving a second opinion here", () => {
    const dir = runsDirWith({ journals: { "a-doc": started + launchedByTheirs } });

    const [run] = runsIn({
      boardPartial: false,
      docs: [SETTLED_DOC],
      runsDir: dir,
      seams: seams({ sessionLive: () => measured({ value: false }) }),
    });

    expect(run!.reapable).toBe(true);
  });

  /**
   * The adversarial counterexample this field exists for. `runStateOf` reads the trailing `answered` and calls
   * the cycle OPEN, while the reaper's `runDisposition` keeps the earlier `finished` closure and skips it — so
   * a brief reading only the phase would name a `handover reap` that writes nothing.
   */
  it("is NOT reapable when the cycle already finished, even though the phase reads open", () => {
    const contradictory =
      started +
      launchedByTheirs +
      ledgerLine({ event: { atIso: AT, kind: "finished", residue: [] } }) +
      ledgerLine({ event: { answer: "yes", atIso: AT, kind: "answered" } });
    const dir = runsDirWith({ journals: { "a-doc": contradictory } });

    const [run] = runsIn({
      boardPartial: false,
      docs: [SETTLED_DOC],
      runsDir: dir,
      seams: seams({ sessionLive: () => measured({ value: false }) }),
    });

    expect(run!.phase).toBe("open");
    expect(run!.reapable).toBe(false);
  });

  /**
   * The hook prefers the harness payload's session id; `handover reap` reads the environment. When those
   * differ and the ENVIRONMENT names the journal's own writer, the reap treats that writer as itself and
   * writes nothing — so a brief judging by the payload alone would promise an ending nobody would write.
   */
  it("is NOT reapable when the identity the REAP verb would resolve is the journal's own writer", () => {
    const dir = runsDirWith({ journals: { "a-doc": started + launchedByTheirs } });

    const [run] = runsIn({
      boardPartial: false,
      docs: [SETTLED_DOC],
      runsDir: dir,
      seams: seams({ commandSessionIds: [THEIRS], sessionLive: () => measured({ value: false }) }),
    });

    expect(run!.reapable).toBe(false);
  });

  /** An AMBIGUOUS environment names two ids, and `handover reap` protects both — so the brief must too. */
  it("is NOT reapable when the writer is one of TWO ids the reap verb would call itself", () => {
    const dir = runsDirWith({ journals: { "a-doc": started + launchedByTheirs } });

    const [run] = runsIn({
      boardPartial: false,
      docs: [SETTLED_DOC],
      runsDir: dir,
      seams: seams({
        commandSessionIds: ["a-stale-codex-thread", THEIRS],
        sessionLive: () => measured({ value: false }),
      }),
    });

    expect(run!.reapable).toBe(false);
  });

  it("is NOT reapable while the registry still lists the holder, so a live session keeps its own run", () => {
    const dir = runsDirWith({ journals: { "a-doc": started + launchedByTheirs } });

    const [run] = runsIn({ boardPartial: false, docs: [SETTLED_DOC], runsDir: dir, seams: seams() });

    expect(run!.reapable).toBe(false);
  });

  it("is NOT reapable for an unsettled row, which pays for no registry decision at all", () => {
    const dir = runsDirWith({ journals: { "a-doc": started + launchedByTheirs } });

    const [run] = runsIn({
      boardPartial: false,
      docs: [DOC],
      runsDir: dir,
      seams: seams({ sessionLive: () => measured({ value: false }) }),
    });

    expect(run!.reapable).toBe(false);
  });

  /** A run nothing can verify must not be able to block. */
  it("reports branchResolves false when the doc is not on the board at all", () => {
    const dir = runsDirWith({ journals: { "a-doc": started } });

    const run = runsIn({ boardPartial: false, docs: [], runsDir: dir, seams: seams() })[0]!;

    expect(run.branchResolves).toBe(false);
    expect(run.tally).toEqual({ failed: 0, notEvaluated: 0, passed: 0 });
  });

  /**
   * The measured defect. The old code read the journal's last `probed` snapshot and printed it as the reason to
   * block a turn, labelled "unverified" — and it was wrong every single time it was hand-checked. The snapshot
   * below says 1 failing; the re-check says 2, and 2 is what the gate must carry.
   */
  it("RE-CHECKS probes rather than reading the journal's snapshot", () => {
    const dir = runsDirWith({
      journals: { "a-doc": started + ledgerLine({ event: { atIso: AT, failed: 1, kind: "probed", passed: 1 } }) },
    });

    const run = runsIn({ boardPartial: false, docs: [DOC], runsDir: dir, seams: seams() })[0]!;

    expect(run.tally).toEqual({ failed: 2, notEvaluated: 0, passed: 0 });
  });

  it("keeps an unexamined probe apart from a failing one", () => {
    const dir = runsDirWith({ journals: { "a-doc": started } });
    const mixed: readonly ProbeResult[] = [
      { note: "x exists", outcome: "pass", probe: PROBE },
      { note: "could not read y", outcome: "not-evaluated", probe: PROBE },
    ];

    const run = runsIn({
      boardPartial: false,
      docs: [DOC],
      runsDir: dir,
      seams: seams({ evaluate: () => mixed }),
    })[0]!;

    expect(run.tally).toEqual({ failed: 0, notEvaluated: 1, passed: 1 });
  });

  it("carries a closed run through as closed", () => {
    const dir = runsDirWith({
      journals: { "a-doc": started + ledgerLine({ event: { atIso: AT, kind: "finished", residue: [] } }) },
    });

    expect(runsIn({ boardPartial: false, docs: [DOC], runsDir: dir, seams: seams() })[0]!.phase).toBe("closed");
  });

  it("reads the run's owner off the journal, and calls it mine when it matches this session", () => {
    const launched = ledgerLine({
      event: { atIso: AT, kind: "launched", pid: 42, sessionId: MINE, worktree: "/wt/a" },
    });
    const dir = runsDirWith({ journals: { "a-doc": started + launched } });

    const run = runsIn({ boardPartial: false, docs: [DOC], runsDir: dir, seams: seams() })[0]!;

    expect(run.ownership).toEqual({
      kind: "mine",
      writer: { atIso: AT, pid: 42, sessionId: MINE, worktree: "/wt/a" },
    });
  });

  it("calls a run held by another session elsewhere", () => {
    const launched = ledgerLine({
      event: { atIso: AT, kind: "launched", pid: 42, sessionId: THEIRS, worktree: "/wt/b" },
    });
    const dir = runsDirWith({ journals: { "a-doc": started + launched } });

    expect(runsIn({ boardPartial: false, docs: [DOC], runsDir: dir, seams: seams() })[0]!.ownership.kind).toBe(
      "elsewhere",
    );
  });

  it("carries the classifier's exact liveness verdict for an open run held elsewhere", () => {
    const launched = ledgerLine({
      event: { atIso: AT, host: "claude-code", kind: "launched", pid: 42, sessionId: THEIRS, worktree: "/wt/b" },
    });
    const dir = runsDirWith({ journals: { "a-doc": started + launched } });

    const run = runsIn({
      boardPartial: false,
      docs: [DOC],
      runsDir: dir,
      seams: seams({ sessionLive: () => measured({ value: false }) }),
    })[0]!;

    expect(run.writerLiveness).toEqual({ kind: "dead" });
    expect(run.docClaim).toBe("one");
  });

  it("reports a duplicate slug as such, so the brief never mistakes it for an orphan", () => {
    const launched = ledgerLine({
      event: { atIso: AT, host: "claude-code", kind: "launched", pid: 42, sessionId: THEIRS, worktree: "/wt/b" },
    });
    const dir = runsDirWith({ journals: { "a-doc": started + launched } });
    const registry = (): never => {
      throw new Error("registry consulted for a duplicate-doc run whose guidance never reads liveness");
    };

    const run = runsIn({
      boardPartial: false,
      docs: [DOC, DOC],
      runsDir: dir,
      seams: seams({ sessionLive: registry }),
    })[0]!;

    expect(run.docClaim).toBe("duplicate");
    expect(run.writerLiveness).toBeUndefined();
  });

  it("degrades every doc-claim to unknown when the board scan was partial — a skipped doc could be the claimant", () => {
    const dir = runsDirWith({ journals: { "a-doc": started } });

    const run = runsIn({ boardPartial: true, docs: [], runsDir: dir, seams: seams() })[0]!;

    expect(run.docClaim).toBe("unknown");
  });

  it("marks an undecodable journal ambiguous and derives no liveness verdict from it", () => {
    const launched = ledgerLine({
      event: { atIso: AT, host: "claude-code", kind: "launched", pid: 42, sessionId: THEIRS, worktree: "/wt/b" },
    });
    const dir = runsDirWith({ journals: { "a-doc": started + launched + "{trunc\n" } });

    const run = runsIn({
      boardPartial: false,
      docs: [DOC],
      runsDir: dir,
      seams: seams({ sessionLive: () => measured({ value: false }) }),
    })[0]!;

    expect(run.journalAmbiguous).toBe(true);
    expect(run.writerLiveness).toBeUndefined();
  });

  it("derives no liveness for this session's own run, and none for a closed one — no idle pid probes", () => {
    let pidProbes = 0;
    const probeCounter = (): boolean => {
      pidProbes += 1;
      return true;
    };
    const mine = ledgerLine({ event: { atIso: AT, kind: "launched", pid: 42, sessionId: MINE, worktree: "/wt/a" } });
    const foreignHostless = ledgerLine({
      event: { atIso: AT, kind: "launched", pid: 42, sessionId: THEIRS, worktree: "/wt/b" },
    });
    const abandoned = ledgerLine({ event: { atIso: AT, kind: "abandoned", why: "closed" } });
    const dir = runsDirWith({
      journals: { "closed-foreign": started + foreignHostless + abandoned, "mine-open": started + mine },
    });

    const runs = runsIn({
      boardPartial: false,
      docs: [DOC],
      runsDir: dir,
      seams: seams({ processAlive: probeCounter }),
    });

    expect(runs.map((run) => run.writerLiveness)).toEqual([undefined, undefined]);
    expect(pidProbes).toBe(0);
  });

  it("compares against the last observation the gate recorded, and reports the movement", () => {
    const gated = ledgerLine({
      event: { atIso: AT, failed: 4, head: HEAD, kind: "gated", notEvaluated: 0, passed: 0, sessionId: MINE },
    });
    const dir = runsDirWith({ journals: { "a-doc": started + gated } });

    const run = runsIn({ boardPartial: false, docs: [DOC], runsDir: dir, seams: seams() })[0]!;

    expect(run.previous!.tally).toEqual({ failed: 4, notEvaluated: 0, passed: 0 });
    expect(run.progress).toEqual({ because: "probes improved, 4 unmet → 2", kind: "moved" });
  });
});

describe("the hook's output shapes", () => {
  it("emits nothing to inject when there is nothing to say", () => {
    expect(contextOutput({ event: "SessionStart", lines: [] })).toBeNull();
  });

  it("wraps injected context in the harness's documented envelope", () => {
    const json = contextOutput({ event: "PostCompact", lines: ["one", "two"] })!;

    expect(JSON.parse(json)).toEqual({
      hookSpecificOutput: { additionalContext: "one\ntwo", hookEventName: "PostCompact" },
    });
  });

  it("expresses a refusal as decision/reason rather than an exit code", () => {
    expect(JSON.parse(blockOutput({ lines: ["nope"] }))).toEqual({ decision: "block", reason: "nope" });
  });
});

describe("recordGateObservation", () => {
  const run: OpenRun = {
    branch: "feat/a",
    branchResolves: true,
    claim: undefined,
    docClaim: "one",
    head: HEAD,
    journalAmbiguous: false,
    ownership: { kind: "unowned" },
    phase: "open",
    previous: undefined,
    progress: { kind: "first-look" },
    reapable: false,
    settled: undefined,
    slug: "a-doc",
    tally: { failed: 2, notEvaluated: 1, passed: 3 },
    writerLiveness: undefined,
  };

  it("appends exactly what it saw, so the next firing can lead with the difference", () => {
    const dir = runsDirWith({ journals: {} });

    recordGateObservation({ nowIso: AT, run, runsDir: dir, sessionId: MINE });

    const parsed = parseLedger({ text: readFileSync(join(dir, "a-doc.jsonl"), "utf8") });
    expect(parsed.unreadable).toEqual([]);
    expect(parsed.events).toEqual([
      { atIso: AT, failed: 2, head: HEAD, kind: "gated", notEvaluated: 1, passed: 3, sessionId: MINE },
    ]);
  });

  /** A journal that cannot be appended to must not become a gate that cannot be passed. */
  it("swallows a write failure rather than letting it reach the gate", () => {
    expect(() => {
      recordGateObservation({ nowIso: AT, run, runsDir: "/nope/never/here", sessionId: MINE });
    }).not.toThrow();
  });
});

/** No-work seams for a session that is not the pinned chair, so the run gate is all these cases exercise. */
const NOT_THE_CHAIR = (): NoWorkClaimStopSeams => ({
  hatchIsOpen: () => false,
  isPinnedChair: () => false,
  lastReconciliation: () => undefined,
});

describe("the hook fails OPEN", () => {
  const ARGV = ["node", "cli", "handover", "hook", "--dir", "/nope/never"];
  const quiet = { noWorkClaimSeams: NOT_THE_CHAIR, writeLine: () => undefined };

  /** The property that matters most: it can never become the thing that blocks by crashing. */
  it("exits 0 when reading its own input THROWS", async () => {
    const reader = (): Promise<string> => Promise.reject(new Error("stdin exploded"));

    expect(await runHookWith({ ...quiet, argv: ARGV, readInput: reader })).toBe(0);
  });

  it("exits 0 on a payload that is not JSON at all", async () => {
    expect(await runHookWith({ ...quiet, argv: ARGV, readInput: () => Promise.resolve("<<not json>>") })).toBe(0);
  });

  it("exits 0 on an empty payload", async () => {
    expect(await runHookWith({ ...quiet, argv: ARGV, readInput: () => Promise.resolve("") })).toBe(0);
  });

  it("exits 0 on a Stop payload when no runs directory exists", async () => {
    const payload = JSON.stringify({ hook_event_name: "Stop", stop_hook_active: false });

    expect(await runHookWith({ ...quiet, argv: ARGV, readInput: () => Promise.resolve(payload) })).toBe(0);
  });
});

describe("a run the gate cannot unambiguously resolve must not block", () => {
  const started = ledgerLine({ event: { atIso: AT, branch: "feat/a", docHash: "h", kind: "started" } });

  /**
   * The counterexample an adversarial review pass found, reproduced before it was fixed: with two docs
   * claiming one slug the gate blocked on an arbitrarily chosen one, while `ask`, `finish`, `abandon` and
   * `resume` ALL refuse a duplicate slug — so every advertised escape failed and the run blocked again next
   * turn. That is the unescapable refusal this whole gate was designed to be incapable of.
   */
  it("refuses to mark a duplicate-slug run resolvable, so the Stop gate lets it through", () => {
    const dir = runsDirWith({ journals: { "a-doc": started } });
    const twin = parseHandoverDoc({
      path: "/h/twin.md",
      text: "---\nslug: a-doc\nstatus: ready\nrepo: /some/repo\n---\n",
    });

    const runs = runsIn({ boardPartial: false, docs: [DOC, twin], runsDir: dir, seams: seams() });

    expect(runs).toHaveLength(1);
    expect(runs[0]!.branchResolves).toBe(false);
  });

  it("still resolves normally when exactly one doc owns the slug", () => {
    const dir = runsDirWith({ journals: { "a-doc": started } });

    expect(runsIn({ boardPartial: false, docs: [DOC], runsDir: dir, seams: seams() })[0]!.branchResolves).toBe(true);
  });
});

describe("the hook's work is bounded, because a slow hook is not fail-open", () => {
  const startedOn = ({ branch }: { branch: string }): string =>
    ledgerLine({ event: { atIso: AT, branch, docHash: "h", kind: "started" } });

  /** Only an open run can block, so only an open run is worth a git call or a probe read against the deadline. */
  it("performs no branch lookup and no probe read for a run that could never block", () => {
    const dir = runsDirWith({
      journals: {
        "a-doc": startedOn({ branch: "feat/a" }) + ledgerLine({ event: { atIso: AT, kind: "finished", residue: [] } }),
      },
    });
    let lookups = 0;
    let evaluations = 0;

    const runs = runsIn({
      boardPartial: false,
      docs: [DOC],
      runsDir: dir,
      seams: seams({
        branchHead: () => {
          lookups += 1;
          return HEAD;
        },
        evaluate: () => {
          evaluations += 1;
          return TWO_FAILING;
        },
      }),
    });

    expect(lookups).toBe(0);
    expect(evaluations).toBe(0);
    expect(runs[0]!.branchResolves).toBe(false);
  });

  /**
   * The hook's outer deadline is enforced ABOVE the wrapper script, so an outer cancellation bypasses the
   * wrapper's guaranteed-zero exit — a slow hook can therefore fail CLOSED. Found by an adversarial pass. The
   * probe re-check is bounded by the same counter, so re-checking cannot reintroduce the unbounded work.
   */
  it("caps branch lookups AND probe re-checks no matter how many open runs exist, disarming the excess", () => {
    const journals: Record<string, string> = {};
    for (let i = 0; i < 9; i += 1) {
      journals[`doc-${String(i)}`] = startedOn({ branch: "feat/a" });
    }
    const docs = Object.keys(journals).map((slug) =>
      parseHandoverDoc({ path: `/h/${slug}.md`, text: `---\nslug: ${slug}\nstatus: ready\nrepo: /some/repo\n---\n` }),
    );
    let lookups = 0;
    let evaluations = 0;

    const runs = runsIn({
      boardPartial: false,
      docs,
      runsDir: runsDirWith({ journals }),
      seams: seams({
        branchHead: () => {
          lookups += 1;
          return HEAD;
        },
        evaluate: () => {
          evaluations += 1;
          return TWO_FAILING;
        },
      }),
    });

    expect(runs).toHaveLength(9);
    expect(lookups).toBe(4);
    expect(evaluations).toBe(4);
    expect(runs.filter((run) => run.branchResolves)).toHaveLength(4);
  });
});

describe("an ambiguous journal disarms the gate rather than feeding it", () => {
  /**
   * Found by an adversarial pass. `parseLedger` reports an undecodable line but keeps the ones around it, so
   * deriving "open" from only the lines that parsed is a guess — the undecodable line could be the very
   * `finished` or `question` that closed the run. The standing rule is that the gate may only block on state it
   * actually verified.
   */
  it("does not resolve a run whose journal has an undecodable line", () => {
    const dir = runsDirWith({
      journals: {
        "a-doc": ledgerLine({ event: { atIso: AT, branch: "feat/a", docHash: "h", kind: "started" } }) + "{trunc",
      },
    });
    let lookups = 0;

    const runs = runsIn({
      boardPartial: false,
      docs: [DOC],
      runsDir: dir,
      seams: seams({
        branchHead: () => {
          lookups += 1;
          return HEAD;
        },
      }),
    });

    expect(runs[0]!.phase).toBe("open");
    expect(runs[0]!.branchResolves).toBe(false);
    expect(lookups).toBe(0);
  });

  /**
   * Measured on the live board: 14 of 18 journals carried a `launched` line, which this build could not
   * decode — so every one of those runs counted as ambiguous and the gate could not fire on it at all. The gate
   * was inert across almost the whole board for a reason nobody had noticed, on top of being switched off.
   */
  it("resolves a run whose journal carries the fleet driver's own entries", () => {
    const events: readonly RunEvent[] = [
      { atIso: AT, branch: "feat/a", docHash: "h", kind: "started" },
      { atIso: AT, kind: "launched", pid: 65036, sessionId: MINE, worktree: "/wt/a" },
      { atIso: AT, attempt: 2, kind: "resumed", pid: undefined, sessionId: MINE },
      { atIso: AT, kind: "said", message: "mid-flight instruction" },
    ];
    const dir = runsDirWith({ journals: { "a-doc": events.map((event) => ledgerLine({ event })).join("") } });

    const run = runsIn({ boardPartial: false, docs: [DOC], runsDir: dir, seams: seams() })[0]!;

    expect(run.branchResolves).toBe(true);
    expect(run.ownership.kind).toBe("mine");
  });
});

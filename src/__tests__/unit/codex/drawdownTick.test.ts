import { describe, expect, it } from "vitest";

import type { CodexDrawdownSample } from "../../../codex/drawdownAnomaly.js";
import { type CodexDrawdownError, CodexDrawdownErrors } from "../../../codex/drawdownErrors.js";
import type { CodexDrawdownJournalEvent } from "../../../codex/drawdownJournal.js";
import type { CodexEpisodeClaim } from "../../../codex/drawdownJournalStore.js";
import {
  type CodexDrawdownTickDeps,
  type CodexDrawdownTickMode,
  type CodexDrawdownTickOutcome,
  type CodexInvestigationReceipt,
  codexDrawdownBrief,
  processCodexDrawdownTick,
} from "../../../codex/drawdownTick.js";
import type { CodexGauge } from "../../../codex/gauge.js";
import { err, ok, type Result } from "../../../lib/result.js";

const SCOPE = "self_serve_business_prolite";
const LIMIT = "codex";
const RESET = "2026-09-19T08:25:25.000Z";
const WEEKLY = 10080;
const HOME = "/w/home";

/** One reading, as the journal holds it. */
function sample({ observedAtIso, usedPercent }: { observedAtIso: string; usedPercent: number }): CodexDrawdownSample {
  return {
    accountScope: SCOPE,
    kind: "sample",
    limitId: LIMIT,
    observedAtIso,
    resetAtIso: RESET,
    schemaVersion: 1,
    sourceEventId: [observedAtIso, LIMIT, "primary", String(usedPercent)].join("~"),
    usedPercent,
    windowMinutes: WEEKLY,
  };
}

/** A gauge carrying one weekly window. */
function gauge({ observedAtIso, usedPercent }: { observedAtIso: string; usedPercent: number }): CodexGauge {
  return {
    credits: undefined,
    limitId: LIMIT,
    observedAtIso,
    planType: SCOPE,
    reached: undefined,
    reachedType: undefined,
    windows: [{ label: "weekly", resetAtIso: RESET, slot: "primary", usedPercent, windowMinutes: WEEKLY }],
  };
}

/** Twenty-one hourly readings at 2 points/h — enough span and intervals for a usable baseline. */
function steadyHistory(): readonly CodexDrawdownSample[] {
  const out: CodexDrawdownSample[] = [];
  for (let index = 0; index <= 20; index++) {
    out.push({
      ...sample({ observedAtIso: new Date(Date.UTC(2026, 8, 12, index, 0, 0)).toISOString(), usedPercent: index * 2 }),
    });
  }
  return out;
}

/** A gauge whose reading is a 12.5x jump on that history — 40 points at hour 20, 65 at hour 21. */
function anomalousGauge(): CodexGauge {
  return gauge({ observedAtIso: "2026-09-12T21:00:00.000Z", usedPercent: 65 });
}

/** Everything the fakes recorded, in the order it happened. */
interface Trace {
  readonly calls: string[];
  readonly appended: CodexDrawdownJournalEvent[];
}

/**
 * Injected effects that record what they were asked to do, in order.
 *
 * Plain functions closing over an array, not `vi.fn` — `.claude/rules/testing.md` bans spies, and the point
 * here is the ORDER of the effects rather than a call count, which a recorder states better anyway.
 */
function fakeDeps({
  history = [],
  claim = { kind: "taken", path: "/w/home/codex-burn/claims/x.json" },
  spawn = ok({ episodeId: "unused", workspaceRef: "workspace:1" }),
  readFails = false,
  unreadable = 0,
  appendFails = false,
  claimFails = false,
}: {
  history?: readonly CodexDrawdownJournalEvent[];
  claim?: CodexEpisodeClaim;
  spawn?: Result<CodexInvestigationReceipt, CodexDrawdownError>;
  readFails?: boolean;
  unreadable?: number;
  appendFails?: boolean;
  claimFails?: boolean;
} = {}): { readonly deps: CodexDrawdownTickDeps; readonly trace: Trace } {
  const trace: Trace = { appended: [], calls: [] };
  const deps: CodexDrawdownTickDeps = {
    appendJournal: ({ events }) => {
      trace.calls.push(`append:${events.map((event) => event.kind).join(",")}`);
      if (appendFails) {
        return err(
          CodexDrawdownErrors.storeFailed({ cause: "disk", operation: "the journal could not be appended to" }),
        );
      }
      trace.appended.push(...events);
      return ok(undefined);
    },
    claimEpisode: ({ episodeId }) => {
      trace.calls.push(`claim:${episodeId}`);
      return claimFails
        ? err(CodexDrawdownErrors.storeFailed({ cause: "held", operation: "the claim could not be taken" }))
        : ok(claim);
    },
    openInvestigation: ({ episode }) => {
      trace.calls.push(`spawn:${episode.episodeId}`);
      return Promise.resolve(spawn);
    },
    readJournal: () => {
      trace.calls.push("read");
      return readFails
        ? err(CodexDrawdownErrors.storeFailed({ cause: "gone", operation: "the journal could not be read" }))
        : ok({ events: history, unreadable });
    },
  };
  return { deps, trace };
}

/**
 * The workspace ref on the journalled failure row, unwrapped by throwing rather than by a ternary.
 *
 * `.claude/rules/testing.md` bans `?:` inside an assertion because the fallback arm makes the case pass for
 * every shape it was not written for.
 */
function failedWorkspaceRef({ trace }: { trace: Trace }): string | undefined {
  const failed = trace.appended.find((event) => event.kind === "investigation-failed");
  if (failed?.kind !== "investigation-failed") {
    throw new Error("expected an investigation-failed row in the journal");
  }
  return failed.workspaceRef;
}

/** Run one tick with the fakes. */
async function tick({
  deps,
  gauges,
  mode,
}: {
  deps: CodexDrawdownTickDeps;
  gauges: readonly CodexGauge[];
  mode: CodexDrawdownTickMode;
}): Promise<CodexDrawdownTickOutcome> {
  return processCodexDrawdownTick({ deps, gauges, home: HOME, mode, nowIso: "2026-09-12T21:30:00.000Z" });
}

describe("processCodexDrawdownTick", () => {
  it("proves the CLAIM and the journal row both precede the spawn", async () => {
    const { deps, trace } = fakeDeps({ history: steadyHistory() });

    const outcome = await tick({ deps, gauges: [anomalousGauge()], mode: "watch" });

    expect(outcome.investigation).toBe("opened");
    // The order is the safety property: read, record the reading, CLAIM, journal the episode, then spawn.
    expect(trace.calls).toStrictEqual([
      "read",
      "append:sample",
      `claim:${SCOPE}~${LIMIT}~${String(WEEKLY)}~${RESET}`,
      "append:episode-opened",
      `spawn:${SCOPE}~${LIMIT}~${String(WEEKLY)}~${RESET}`,
      "append:investigation-opened",
    ]);
  });

  it("never spawns in dry-run, and writes nothing at all", async () => {
    const { deps, trace } = fakeDeps({ history: steadyHistory() });

    const outcome = await tick({ deps, gauges: [anomalousGauge()], mode: "dry-run" });

    expect(outcome.evaluation.verdict).toBe("anomaly");
    expect(outcome.investigation).toBe("none");
    expect(outcome.recorded).toBe(0);
    expect(trace.calls).toStrictEqual(["read"]);
  });

  it("records in sample-only mode and still never spawns", async () => {
    const { deps, trace } = fakeDeps({ history: steadyHistory() });

    const outcome = await tick({ deps, gauges: [anomalousGauge()], mode: "sample-only" });

    expect(outcome.evaluation.verdict).toBe("anomaly");
    expect(outcome.investigation).toBe("none");
    expect(outcome.recorded).toBe(1);
    expect(trace.calls).toStrictEqual(["read", "append:sample"]);
  });

  it("never spawns when the CLAIM fails — an unknown suppression state must not read as free", async () => {
    const { deps, trace } = fakeDeps({ claimFails: true, history: steadyHistory() });

    const outcome = await tick({ deps, gauges: [anomalousGauge()], mode: "watch" });

    expect(outcome.investigation).toBe("failed");
    expect(trace.calls.some((call) => call.startsWith("spawn:"))).toBe(false);
    expect(outcome.errors).toStrictEqual(["the claim could not be taken: held"]);
  });

  it("never spawns when another watch already HOLDS the claim", async () => {
    const { deps, trace } = fakeDeps({
      claim: { kind: "held", reason: "another watch already claimed this episode" },
      history: steadyHistory(),
    });

    const outcome = await tick({ deps, gauges: [anomalousGauge()], mode: "watch" });

    expect(outcome.investigation).toBe("suppressed");
    expect(trace.calls.some((call) => call.startsWith("spawn:"))).toBe(false);
  });

  it("suppresses a continuing episode on the journal row, before it costs a claim", async () => {
    const episodeId = `${SCOPE}~${LIMIT}~${String(WEEKLY)}~${RESET}`;
    const { deps, trace } = fakeDeps({
      history: [
        ...steadyHistory(),
        { episodeId, kind: "episode-opened", openedAtIso: "2026-09-12T21:05:00.000Z", schemaVersion: 1, triggers: [] },
      ],
    });

    const outcome = await tick({ deps, gauges: [anomalousGauge()], mode: "watch" });

    expect(outcome.investigation).toBe("suppressed");
    expect(trace.calls.some((call) => call.startsWith("claim:"))).toBe(false);
    expect(trace.calls.some((call) => call.startsWith("spawn:"))).toBe(false);
  });

  it("suppresses even when the earlier investigation FAILED — a failure is not a reason to retry", async () => {
    const episodeId = `${SCOPE}~${LIMIT}~${String(WEEKLY)}~${RESET}`;
    const { deps, trace } = fakeDeps({
      history: [
        ...steadyHistory(),
        { episodeId, kind: "episode-opened", openedAtIso: "2026-09-12T21:05:00.000Z", schemaVersion: 1, triggers: [] },
        {
          episodeId,
          kind: "investigation-failed",
          reason: "cmux refused",
          recordedAtIso: "2026-09-12T21:05:01.000Z",
          schemaVersion: 1,
          workspaceRef: undefined,
        },
      ],
    });

    const outcome = await tick({ deps, gauges: [anomalousGauge()], mode: "watch" });

    expect(outcome.investigation).toBe("suppressed");
    expect(trace.calls.some((call) => call.startsWith("spawn:"))).toBe(false);
  });

  it("reports a failed spawn that named NO workspace as `failed`, and journals it", async () => {
    const { deps, trace } = fakeDeps({
      history: steadyHistory(),
      spawn: err(CodexDrawdownErrors.spawnFailed({ cause: "cmux is not running" })),
    });

    const outcome = await tick({ deps, gauges: [anomalousGauge()], mode: "watch" });

    expect(outcome.investigation).toBe("failed");
    expect(trace.appended.some((event) => event.kind === "investigation-failed")).toBe(true);
    expect(outcome.lines.join("\n")).toContain("not retried automatically");
  });

  it("reports a failed spawn that DID name a workspace as `ambiguous`, carrying the ref", async () => {
    const { deps, trace } = fakeDeps({
      history: steadyHistory(),
      spawn: err(CodexDrawdownErrors.spawnFailed({ cause: "the session never booted (workspace workspace:7)" })),
    });

    const outcome = await tick({ deps, gauges: [anomalousGauge()], mode: "watch" });

    expect(outcome.investigation).toBe("ambiguous");
    expect(outcome.lines.join("\n")).toContain("workspace workspace:7 may be open and needs a human look");
    expect(failedWorkspaceRef({ trace })).toBe("workspace:7");
  });

  it("judges NOTHING when the journal cannot be read, and says so rather than reporting normal", async () => {
    const { deps, trace } = fakeDeps({ readFails: true });

    const outcome = await tick({ deps, gauges: [anomalousGauge()], mode: "watch" });

    expect(outcome.evaluation.verdict).toBe("warming");
    expect(outcome.lines[0]).toBe("codex burn: NOT MEASURED — the journal could not be read");
    expect(trace.calls).toStrictEqual(["read"]);
  });

  it("judges nothing when ANY journal line will not parse — a lost reading is a wrong baseline", async () => {
    const { deps, trace } = fakeDeps({ history: steadyHistory(), unreadable: 1 });

    const outcome = await tick({ deps, gauges: [anomalousGauge()], mode: "watch" });

    expect(outcome.evaluation.verdict).toBe("warming");
    expect(outcome.lines[0]).toContain("1 journal line(s) will not parse");
    expect(trace.calls).toStrictEqual(["read"]);
  });

  it("records only readings it has not seen, so re-reading the same tail records nothing", async () => {
    const already = sample({ observedAtIso: "2026-09-12T21:00:00.000Z", usedPercent: 65 });
    const { deps, trace } = fakeDeps({ history: [...steadyHistory(), already] });

    const outcome = await tick({ deps, gauges: [anomalousGauge()], mode: "sample-only" });

    expect(outcome.recorded).toBe(0);
    expect(trace.calls).toStrictEqual(["read"]);
  });

  it("opens nothing when the verdict is not an anomaly", async () => {
    const { deps, trace } = fakeDeps({ history: steadyHistory() });

    const outcome = await tick({
      deps,
      gauges: [gauge({ observedAtIso: "2026-09-12T21:00:00.000Z", usedPercent: 42 })],
      mode: "watch",
    });

    expect(outcome.evaluation.verdict).toBe("normal");
    expect(outcome.investigation).toBe("none");
    expect(trace.calls.some((call) => call.startsWith("claim:"))).toBe(false);
  });

  it("still spawns when the episode row could not be journalled, because the CLAIM is the lock", async () => {
    // The journal row is the readable record; the claim is what makes this at-most-once. Refusing to spawn
    // on a lost row would mean a full disk silences the detector entirely, and the errors carry the loss.
    const { deps, trace } = fakeDeps({ appendFails: true, history: steadyHistory() });

    const outcome = await tick({ deps, gauges: [anomalousGauge()], mode: "watch" });

    expect(outcome.investigation).toBe("opened");
    expect(trace.calls.some((call) => call.startsWith("spawn:"))).toBe(true);
    expect(outcome.errors.length).toBeGreaterThan(0);
  });
});

describe("codexDrawdownBrief", () => {
  it("points the session at the evidence and forbids it changing anything", () => {
    const brief = codexDrawdownBrief({
      episode: {
        episodeId: "e1",
        observedAtIso: "2026-09-12T21:00:00.000Z",
        triggers: [
          {
            accountScope: SCOPE,
            baselinePercentPointsPerHour: 2,
            currentPercentPointsPerHour: 25,
            fromIso: "2026-09-12T20:00:00.000Z",
            limitId: LIMIT,
            ratio: 12.5,
            resetAtIso: RESET,
            seriesId: "s1",
            toIso: "2026-09-12T21:00:00.000Z",
            windowMinutes: WEEKLY,
          },
        ],
      },
    });

    expect(brief).toContain("25.00 points/h, 12.5x its normal 2.00");
    expect(brief).toContain("Do not abort a running pass, remove a pass kind, change an account or");
    expect(brief).toContain("slopweaver codex usage");
    expect(brief).toContain("--diff-sha256");
  });
});

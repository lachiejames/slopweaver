import { describe, expect, it } from "vitest";

import { absentAsEmpty, absentAsNumber } from "#lib/absent.js";
import type { ClaudeAccount, ClaudeAccountGauge } from "../../../claude/contracts.js";
import type { StoreLife } from "../../../claude/credentialRepair.js";
import { ClaudeRotationErrors } from "../../../claude/errors.js";
import {
  effectiveProbe,
  type ProbeRepairDeps,
  probePlansWithRepair,
  renderRepair,
  repairProbedPlans,
} from "../../../claude/probeRepair.js";
import type { ClaudeProbeResult } from "../../../claude/probeStore.js";
import { claudeStoreService } from "../../../claude/storeService.js";
import { err, ok } from "../../../lib/result.js";

const NOW = "2026-09-12T06:00:00.000Z";
const EXPIRED = "2026-09-12T05:45:00.000Z";
const ALIVE = "2026-09-12T14:00:00.000Z";
const GRANT_ALIVE = "2026-10-11T12:00:12.000Z";

const accountFor = ({ alias }: { alias: string }): ClaudeAccount => ({ alias, storeDir: `/stores/${alias}` });
const TWO = accountFor({ alias: "plan-two" });
const THREE = accountFor({ alias: "plan-three" });

const gauge = ({ alias }: { alias: string }): ClaudeAccountGauge => ({
  alias,
  fiveHour: { resetAtIso: ALIVE, status: "allowed", utilization: 0.2 },
  observedAtIso: NOW,
  sevenDay: { resetAtIso: ALIVE, status: "allowed", utilization: 0.3 },
});

const life = ({ alias, expiresAtIso = EXPIRED }: { alias: string; expiresAtIso?: string }): StoreLife => ({
  alias,
  expiresAtIso,
  hasCredential: true,
  hasRefreshToken: true,
  refreshExpiresAtIso: GRANT_ALIVE,
});

const refusedProbe = ({ alias }: { alias: string }): ClaudeProbeResult => ({
  life: life({ alias }),
  outcome: { alias, problem: "refused" },
  reading: err(ClaudeRotationErrors.credentialRejected({ alias, status: 401 })),
});

const healthyProbe = ({ alias }: { alias: string }): ClaudeProbeResult => ({
  life: life({ alias, expiresAtIso: ALIVE }),
  outcome: { alias, gauge: gauge({ alias }) },
  reading: ok(gauge({ alias })),
});

const offlineProbe = ({ alias }: { alias: string }): ClaudeProbeResult => ({
  life: life({ alias }),
  outcome: { alias, problem: "no answer" },
  reading: err(ClaudeRotationErrors.probeTransportFailed({ alias })),
});

/** A recorder for every effect, in the exact order the orchestrator performed them. */
interface Recorder {
  readonly calls: string[];
}

/**
 * Deps that record every effect in order, so the ORDERING itself is what is asserted rather than the result.
 *
 * @param lives what each store's metadata read answers, by how many times that store has been read
 * @param probes what each probe answers, by how many times that store has been probed
 * @param recorder where the call order is collected
 * @param refreshProblem what the refresh command reports, when it reports anything
 * @returns the four seams
 */
const recordingDeps = ({
  lives,
  probeDelays,
  probes,
  recorder,
  refreshProblem,
}: {
  lives: Readonly<Record<string, readonly StoreLife[]>>;
  probeDelays?: Readonly<Record<string, number>>;
  probes: Readonly<Record<string, readonly ClaudeProbeResult[]>>;
  recorder: Recorder;
  refreshProblem?: string;
}): ProbeRepairDeps => {
  const probeCounts: Record<string, number> = {};
  const lifeCounts: Record<string, number> = {};
  let clock = 0;
  return {
    nowIso: () => {
      clock += 1;
      recorder.calls.push(`clock:${String(clock)}`);
      return NOW;
    },
    probe: async ({ alias }) => {
      const index = absentAsNumber({ value: probeCounts[alias], whenAbsent: 0 });
      probeCounts[alias] = index + 1;
      recorder.calls.push(`probe:${alias}:${String(index + 1)}`);
      const sequence = absentAsEmpty({ value: probes[alias] });
      // Microtask turns before the record, so a probe that has been INVOKED is distinguishable from one that has
      // SETTLED — and so one store's probe can still be PENDING while another's has settled. Codex review pass
      // Both halves are needed: recording only the invocation let a per-store-await implementation pass, and
      // giving every probe the same single turn let it pass again, because both fakes settled together.
      const turns = absentAsNumber({ value: probeDelays?.[alias], whenAbsent: 1 });
      for (let turn = 0; turn < turns; turn += 1) {
        await Promise.resolve();
      }
      recorder.calls.push(`settled:${alias}:${String(index + 1)}`);
      return sequence[Math.min(index, sequence.length - 1)]!;
    },
    readLife: ({ account }) => {
      const index = absentAsNumber({ value: lifeCounts[account.alias], whenAbsent: 0 });
      lifeCounts[account.alias] = index + 1;
      recorder.calls.push(`life:${account.alias}:${String(index + 1)}`);
      const sequence = absentAsEmpty({ value: lives[account.alias] });
      return sequence[Math.min(index, sequence.length - 1)]!;
    },
    refresh: ({ storeDir }) => {
      recorder.calls.push(`refresh:${storeDir}`);
      return refreshProblem;
    },
  };
};

describe("probePlansWithRepair performs its effects in the one safe order", () => {
  it("settles EVERY first probe before running any refresh", async () => {
    // The refresh is `execFileSync` and blocks the thread. Starting one while probes are in flight would hold
    // up their own timeout handling and make a slow network look like a refusal.
    const recorder: Recorder = { calls: [] };
    await probePlansWithRepair({
      accounts: [TWO, THREE],
      deps: recordingDeps({
        lives: { "plan-three": [life({ alias: "plan-three" })], "plan-two": [life({ alias: "plan-two" })] },
        // plan-three settles TEN microtask turns after plan-two, so an implementation that awaited plan-two and
        // repaired it immediately would run that refresh while plan-three's probe was still pending. Without
        // this the two fakes settled together and the mutation passed.
        probeDelays: { "plan-three": 11, "plan-two": 1 },
        probes: {
          "plan-three": [refusedProbe({ alias: "plan-three" }), healthyProbe({ alias: "plan-three" })],
          "plan-two": [refusedProbe({ alias: "plan-two" }), healthyProbe({ alias: "plan-two" })],
        },
        recorder,
      }),
    });
    // Every first probe must have SETTLED before the first refresh, not merely been invoked — the refresh is
    // `execFileSync` and blocks the thread, so a refresh started while a probe is still in flight holds up that
    // probe's own timeout handling and makes a slow network look like a refusal.
    const firstRefresh = recorder.calls.indexOf("refresh:/stores/plan-two");
    const settledFirstSweep = recorder.calls
      .map((call, index) => ({ call, index }))
      .filter((entry) => entry.call === "settled:plan-two:1" || entry.call === "settled:plan-three:1")
      .map((entry) => entry.index);
    expect(settledFirstSweep.length).toBe(2);
    expect(Math.max(...settledFirstSweep)).toBeLessThan(firstRefresh);
  });

  it("reads the store ONCE, then the clock, then runs one command, then reads the store back", async () => {
    const recorder: Recorder = { calls: [] };
    await probePlansWithRepair({
      accounts: [TWO],
      deps: recordingDeps({
        lives: { "plan-two": [life({ alias: "plan-two" }), life({ alias: "plan-two", expiresAtIso: ALIVE })] },
        probes: { "plan-two": [refusedProbe({ alias: "plan-two" }), healthyProbe({ alias: "plan-two" })] },
        recorder,
      }),
    });
    // ONE metadata read decides and is also the before-baseline the witness compares against. A second read
    // between the decision and the command would reopen a window: another
    // session refreshing the store, or its grant going away, between deciding and refreshing.
    expect(recorder.calls).toStrictEqual([
      "clock:1",
      "probe:plan-two:1",
      "settled:plan-two:1",
      "life:plan-two:1",
      "clock:2",
      "refresh:/stores/plan-two",
      "life:plan-two:2",
      "clock:3",
      "probe:plan-two:2",
      "settled:plan-two:2",
    ]);
  });

  it("reads a FRESH clock for each second probe rather than reusing the first sweep's", async () => {
    const recorder: Recorder = { calls: [] };
    await probePlansWithRepair({
      accounts: [TWO],
      deps: recordingDeps({
        lives: { "plan-two": [life({ alias: "plan-two" })] },
        probes: { "plan-two": [refusedProbe({ alias: "plan-two" }), healthyProbe({ alias: "plan-two" })] },
        recorder,
      }),
    });
    expect(recorder.calls.filter((call) => call.startsWith("clock:")).length).toBe(3);
  });
});

describe("probePlansWithRepair runs exactly one refresh per store per invocation", () => {
  it("refreshes a refused expired store once and re-probes it once", async () => {
    const recorder: Recorder = { calls: [] };
    const repairs = await probePlansWithRepair({
      accounts: [TWO],
      deps: recordingDeps({
        lives: { "plan-two": [life({ alias: "plan-two" })] },
        probes: { "plan-two": [refusedProbe({ alias: "plan-two" }), healthyProbe({ alias: "plan-two" })] },
        recorder,
      }),
    });
    expect(recorder.calls.filter((call) => call.startsWith("refresh:")).length).toBe(1);
    expect(recorder.calls.filter((call) => call === "probe:plan-two:2").length).toBe(1);
    expect(repairs[0]!.decision).toStrictEqual({ kind: "attempt" });
  });

  it("takes its decision and its before-baseline from ONE reading, so nothing can change between them", async () => {
    // There used to be a second `readLife` between the decision and the command, and a
    // store that became ineligible in that window was refreshed anyway. The witness: a fixture whose SECOND
    // reading says the store is already healthy. Under the old shape that reading became the before-baseline and
    // the refresh ran regardless; now the second reading is the AFTER, so the command is judged against the
    // reading that authorised it and the store is reported repaired rather than refreshed for no reason.
    const recorder: Recorder = { calls: [] };
    const repairs = await probePlansWithRepair({
      accounts: [TWO],
      deps: recordingDeps({
        lives: { "plan-two": [life({ alias: "plan-two" }), life({ alias: "plan-two", expiresAtIso: ALIVE })] },
        probes: { "plan-two": [refusedProbe({ alias: "plan-two" }), healthyProbe({ alias: "plan-two" })] },
        recorder,
      }),
    });
    // Exactly two metadata reads for an attempted store, never three.
    expect(recorder.calls.filter((call) => call.startsWith("life:")).length).toBe(2);
    expect(repairs[0]!.before).toStrictEqual(life({ alias: "plan-two" }));
    expect(repairs[0]!.refresh).toStrictEqual({
      afterExpiresAtIso: ALIVE,
      alias: "plan-two",
      beforeExpiresAtIso: EXPIRED,
      status: "refreshed",
    });
  });

  it("refreshes a PHYSICAL store once even when two configured aliases name the same directory", async () => {
    // Two aliases can be configured against one store path, by a typo or by deliberate aliasing. The guard is
    // keyed on the path rather than on the alias precisely so the second one cannot fire a second command.
    const recorder: Recorder = { calls: [] };
    const twin: ClaudeAccount = { alias: "plan-two-again", storeDir: TWO.storeDir };
    const repairs = await probePlansWithRepair({
      accounts: [TWO, twin],
      deps: recordingDeps({
        lives: {
          "plan-two": [life({ alias: "plan-two" })],
          "plan-two-again": [life({ alias: "plan-two-again" })],
        },
        probes: {
          "plan-two": [refusedProbe({ alias: "plan-two" }), healthyProbe({ alias: "plan-two" })],
          "plan-two-again": [refusedProbe({ alias: "plan-two-again" }), healthyProbe({ alias: "plan-two-again" })],
        },
        recorder,
      }),
    });
    expect(recorder.calls.filter((call) => call.startsWith("refresh:")).length).toBe(1);
    expect(repairs[1]!.decision).toStrictEqual({ kind: "skip", reason: "already-attempted" });
  });

  it("refreshes once across two DIFFERENT paths that collide onto one keychain item", async () => {
    // The NFC fix below is not sufficient alone. `storeService.ts` keeps only
    // the first EIGHT hex digits of the path digest, so two genuinely different paths can name one keychain
    // item — this pair is the live one it built. The guard is keyed on the derived service name now, so it
    // agrees with the thing it guards by construction.
    expect(claudeStoreService({ storeDir: "/tmp/r1-store-9327" })).toBe(
      claudeStoreService({ storeDir: "/tmp/r1-store-56152" }),
    );
    const recorder: Recorder = { calls: [] };
    const first: ClaudeAccount = { alias: "plan-collide-a", storeDir: "/tmp/r1-store-9327" };
    const second: ClaudeAccount = { alias: "plan-collide-b", storeDir: "/tmp/r1-store-56152" };
    const repairs = await probePlansWithRepair({
      accounts: [first, second],
      deps: recordingDeps({
        lives: {
          "plan-collide-a": [life({ alias: "plan-collide-a" })],
          "plan-collide-b": [life({ alias: "plan-collide-b" })],
        },
        probes: {
          "plan-collide-a": [refusedProbe({ alias: "plan-collide-a" }), refusedProbe({ alias: "plan-collide-a" })],
          "plan-collide-b": [refusedProbe({ alias: "plan-collide-b" }), refusedProbe({ alias: "plan-collide-b" })],
        },
        recorder,
      }),
    });
    expect(recorder.calls.filter((call) => call.startsWith("refresh:")).length).toBe(1);
    expect(repairs[1]!.decision).toStrictEqual({ kind: "skip", reason: "already-attempted" });
  });

  it("refreshes once across two NFC-equivalent spellings of one store path", async () => {
    // `storeService.ts` NFC-normalises a path before hashing it into a keychain
    // service name, so `/stores/café` and `/stores/cafe\u0301` ARE one physical credential store — and a raw
    // string key let each of them fire its own refresh command against it.
    const recorder: Recorder = { calls: [] };
    const composed: ClaudeAccount = { alias: "plan-nfc-a", storeDir: "/stores/caf\u00e9" };
    const decomposed: ClaudeAccount = { alias: "plan-nfc-b", storeDir: "/stores/cafe\u0301" };
    const repairs = await probePlansWithRepair({
      accounts: [composed, decomposed],
      deps: recordingDeps({
        lives: {
          "plan-nfc-a": [life({ alias: "plan-nfc-a" })],
          "plan-nfc-b": [life({ alias: "plan-nfc-b" })],
        },
        probes: {
          "plan-nfc-a": [refusedProbe({ alias: "plan-nfc-a" }), refusedProbe({ alias: "plan-nfc-a" })],
          "plan-nfc-b": [refusedProbe({ alias: "plan-nfc-b" }), refusedProbe({ alias: "plan-nfc-b" })],
        },
        recorder,
      }),
    });
    expect(recorder.calls.filter((call) => call.startsWith("refresh:")).length).toBe(1);
    expect(repairs[1]!.decision).toStrictEqual({ kind: "skip", reason: "already-attempted" });
  });

  it("never probes a third time, however the second probe answers", async () => {
    const recorder: Recorder = { calls: [] };
    await probePlansWithRepair({
      accounts: [TWO],
      deps: recordingDeps({
        lives: { "plan-two": [life({ alias: "plan-two" })] },
        probes: { "plan-two": [refusedProbe({ alias: "plan-two" }), refusedProbe({ alias: "plan-two" })] },
        recorder,
      }),
    });
    expect(recorder.calls.filter((call) => call.startsWith("probe:")).length).toBe(2);
    expect(recorder.calls.filter((call) => call.startsWith("refresh:")).length).toBe(1);
  });

  it("re-probes after an INCONCLUSIVE witness, because the provider's answer is the stronger evidence", async () => {
    // The expiry witness fails when the command exited cleanly and nothing moved. That is not proof the store
    // is unusable — another process may have refreshed it a moment before — so the second probe still runs.
    const recorder: Recorder = { calls: [] };
    const repairs = await probePlansWithRepair({
      accounts: [TWO],
      deps: recordingDeps({
        lives: { "plan-two": [life({ alias: "plan-two" })] },
        probes: { "plan-two": [refusedProbe({ alias: "plan-two" }), healthyProbe({ alias: "plan-two" })] },
        recorder,
      }),
    });
    expect(repairs[0]!.refresh!.status).toBe("failed");
    expect(repairs[0]!.second).toBeDefined();
  });
});

describe("repairProbedPlans repairs over first probes the caller already settled", () => {
  it("takes no first probe of its own, refreshes the refused store, and re-probes only that one", async () => {
    const recorder: Recorder = { calls: [] };
    const repairs = await repairProbedPlans({
      deps: recordingDeps({
        lives: { "plan-two": [life({ alias: "plan-two" }), life({ alias: "plan-two", expiresAtIso: ALIVE })] },
        probes: { "plan-two": [healthyProbe({ alias: "plan-two" })] },
        recorder,
      }),
      first: [
        { account: TWO, result: refusedProbe({ alias: "plan-two" }) },
        { account: THREE, result: healthyProbe({ alias: "plan-three" }) },
      ],
    });
    expect(recorder.calls.filter((call) => call.startsWith("probe:"))).toStrictEqual(["probe:plan-two:1"]);
    expect(recorder.calls.filter((call) => call.startsWith("refresh:"))).toStrictEqual(["refresh:/stores/plan-two"]);
    expect(repairs.map((repair) => repair.decision.kind)).toStrictEqual(["attempt", "skip"]);
    expect(effectiveProbe({ repair: repairs[0]! }).outcome).toStrictEqual({
      alias: "plan-two",
      gauge: gauge({ alias: "plan-two" }),
    });
  });

  it("repairs nothing when handed no stores, which is a watch tick whose guard cleared none", async () => {
    const recorder: Recorder = { calls: [] };
    const repairs = await repairProbedPlans({ deps: recordingDeps({ lives: {}, probes: {}, recorder }), first: [] });
    expect(repairs).toStrictEqual([]);
    expect(recorder.calls).toStrictEqual([]);
  });
});

describe("probePlansWithRepair refreshes NOTHING it should not", () => {
  it("runs zero commands when every probe is a TRANSPORT failure — the owner's offline day", async () => {
    const recorder: Recorder = { calls: [] };
    const repairs = await probePlansWithRepair({
      accounts: [TWO, THREE],
      deps: recordingDeps({
        lives: { "plan-three": [life({ alias: "plan-three" })], "plan-two": [life({ alias: "plan-two" })] },
        probes: {
          "plan-three": [offlineProbe({ alias: "plan-three" })],
          "plan-two": [offlineProbe({ alias: "plan-two" })],
        },
        recorder,
      }),
    });
    expect(recorder.calls.filter((call) => call.startsWith("refresh:")).length).toBe(0);
    expect(recorder.calls.filter((call) => call.startsWith("probe:")).length).toBe(2);
    expect(repairs.map((repair) => repair.decision)).toStrictEqual([
      { kind: "skip", reason: "not-credential-rejected" },
      { kind: "skip", reason: "not-credential-rejected" },
    ]);
  });

  it("runs zero commands for a store something else refreshed between the probe and the decision", async () => {
    const recorder: Recorder = { calls: [] };
    const repairs = await probePlansWithRepair({
      accounts: [TWO],
      deps: recordingDeps({
        lives: { "plan-two": [life({ alias: "plan-two", expiresAtIso: ALIVE })] },
        probes: { "plan-two": [refusedProbe({ alias: "plan-two" }), healthyProbe({ alias: "plan-two" })] },
        recorder,
      }),
    });
    expect(recorder.calls.filter((call) => call.startsWith("refresh:")).length).toBe(0);
    expect(repairs[0]!.decision).toStrictEqual({ kind: "reprobe", reason: "advanced-since-probe" });
    expect(repairs[0]!.second).toBeDefined();
  });

  it("does not re-probe a store it skipped, so a healthy fleet costs exactly one sweep", async () => {
    const recorder: Recorder = { calls: [] };
    await probePlansWithRepair({
      accounts: [TWO, THREE],
      deps: recordingDeps({
        lives: { "plan-three": [life({ alias: "plan-three" })], "plan-two": [life({ alias: "plan-two" })] },
        probes: {
          "plan-three": [healthyProbe({ alias: "plan-three" })],
          "plan-two": [healthyProbe({ alias: "plan-two" })],
        },
        recorder,
      }),
    });
    expect(recorder.calls.filter((call) => call.startsWith("probe:")).length).toBe(2);
    expect(recorder.calls.filter((call) => call.startsWith("refresh:")).length).toBe(0);
  });
});

describe("probePlansWithRepair keeps one store's failure from hiding another's", () => {
  it("attempts the second store after the first one's refresh failed", async () => {
    const recorder: Recorder = { calls: [] };
    const repairs = await probePlansWithRepair({
      accounts: [TWO, THREE],
      deps: recordingDeps({
        lives: {
          "plan-three": [life({ alias: "plan-three" }), life({ alias: "plan-three", expiresAtIso: ALIVE })],
          "plan-two": [life({ alias: "plan-two" })],
        },
        probes: {
          "plan-three": [refusedProbe({ alias: "plan-three" }), healthyProbe({ alias: "plan-three" })],
          "plan-two": [refusedProbe({ alias: "plan-two" }), refusedProbe({ alias: "plan-two" })],
        },
        recorder,
      }),
    });
    expect(recorder.calls.filter((call) => call.startsWith("refresh:")).length).toBe(2);
    expect(repairs[1]!.refresh!.status).toBe("refreshed");
  });

  it("keeps every store's own witness even when a different store wins the route", async () => {
    const repairs = await probePlansWithRepair({
      accounts: [TWO, THREE],
      deps: recordingDeps({
        lives: { "plan-three": [life({ alias: "plan-three" })], "plan-two": [life({ alias: "plan-two" })] },
        probes: {
          "plan-three": [healthyProbe({ alias: "plan-three" })],
          "plan-two": [refusedProbe({ alias: "plan-two" }), refusedProbe({ alias: "plan-two" })],
        },
        recorder: { calls: [] },
      }),
    });
    expect(repairs[0]!.account.alias).toBe("plan-two");
    expect(repairs[0]!.refresh!.status).toBe("failed");
    expect(repairs[1]!.decision).toStrictEqual({ kind: "skip", reason: "not-credential-rejected" });
  });
});

describe("effectiveProbe prefers the SECOND reading", () => {
  it("returns the second probe when one was taken", async () => {
    const repairs = await probePlansWithRepair({
      accounts: [TWO],
      deps: recordingDeps({
        lives: { "plan-two": [life({ alias: "plan-two" })] },
        probes: { "plan-two": [refusedProbe({ alias: "plan-two" }), healthyProbe({ alias: "plan-two" })] },
        recorder: { calls: [] },
      }),
    });
    expect(effectiveProbe({ repair: repairs[0]! }).outcome.gauge!.alias).toBe("plan-two");
  });

  it("returns the first probe when no second was taken", async () => {
    const repairs = await probePlansWithRepair({
      accounts: [TWO],
      deps: recordingDeps({
        lives: { "plan-two": [life({ alias: "plan-two" })] },
        probes: { "plan-two": [offlineProbe({ alias: "plan-two" })] },
        recorder: { calls: [] },
      }),
    });
    expect(effectiveProbe({ repair: repairs[0]! }).outcome.problem).toBe("no answer");
  });
});

describe("renderRepair says what happened, and nothing about a healthy plan", () => {
  it("prints nothing for an ordinary healthy plan, so a spawn log is not a wall of text", async () => {
    const repairs = await probePlansWithRepair({
      accounts: [TWO],
      deps: recordingDeps({
        lives: { "plan-two": [life({ alias: "plan-two" })] },
        probes: { "plan-two": [healthyProbe({ alias: "plan-two" })] },
        recorder: { calls: [] },
      }),
    });
    expect(renderRepair({ repair: repairs[0]! })).toBe(undefined);
  });

  it("names both instants for a repair that worked", async () => {
    const repairs = await probePlansWithRepair({
      accounts: [TWO],
      deps: recordingDeps({
        lives: { "plan-two": [life({ alias: "plan-two" }), life({ alias: "plan-two", expiresAtIso: ALIVE })] },
        probes: { "plan-two": [refusedProbe({ alias: "plan-two" }), healthyProbe({ alias: "plan-two" })] },
        recorder: { calls: [] },
      }),
    });
    expect(renderRepair({ repair: repairs[0]! })).toBe(
      `claude routing: plan-two repaired on demand — expiry ${EXPIRED} to ${ALIVE}`,
    );
    expect(renderRepair({ repair: repairs[0]!, speaker: "claude watch" })).toBe(
      `claude watch: plan-two repaired on demand — expiry ${EXPIRED} to ${ALIVE}`,
    );
  });

  it("names the reason a refused store was NOT repaired", async () => {
    const repairs = await probePlansWithRepair({
      accounts: [TWO],
      deps: recordingDeps({
        lives: { "plan-two": [{ alias: "plan-two", hasCredential: true, hasRefreshToken: false }] },
        probes: { "plan-two": [refusedProbe({ alias: "plan-two" })] },
        recorder: { calls: [] },
      }),
    });
    expect(renderRepair({ repair: repairs[0]! })).toBe(
      "claude routing: plan-two was refused and NOT repaired — no-refresh-token: this store has no refresh grant, " +
        "so no refresh can repair it; sign in again with `slopweaver claude signin --plan plan-two`",
    );
  });

  it("carries no token in any line it prints", async () => {
    const repairs = await probePlansWithRepair({
      accounts: [TWO],
      deps: recordingDeps({
        lives: { "plan-two": [life({ alias: "plan-two" })] },
        probes: { "plan-two": [refusedProbe({ alias: "plan-two" }), refusedProbe({ alias: "plan-two" })] },
        recorder: { calls: [] },
      }),
    });
    const line = renderRepair({ repair: repairs[0]! })!;
    expect(line.includes("sk-ant")).toBe(false);
    expect(line).toContain("plan-two repair FAILED");
  });
});

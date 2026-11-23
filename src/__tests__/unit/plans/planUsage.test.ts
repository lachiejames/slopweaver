/**
 * {@link planUsageReport} — each registered plan's recorded usage and sign-in, judged against the report instant.
 * Pure: every piece of evidence is built here.
 */
import { describe, expect, it } from "vitest";

import type { ClaudePlanProbeRecord } from "../../../claude/planProbeRecord.js";
import type { ClaudePlanUsageSnapshot } from "../../../claude/planUsageSnapshot.js";
import type { CodexGauge } from "../../../codex/gauge.js";
import type { CodexAuthStamp } from "../../../codex/signInRecord.js";
import { planUsageReport } from "../../../plans/planUsage.js";
import type {
  ClaudePlanUsageEvidence,
  CodexPlanUsageEvidence,
  CodexStoreFiles,
  PlanUsageRow,
} from "../../../plans/planUsageTypes.js";
import type { RegisteredPlan } from "../../../plans/types.js";

const NOW = "2026-11-06T12:00:00.000Z";
const TEN_MIN_AGO = "2026-11-06T11:50:00.000Z";
const RESET = "2026-11-10T00:00:00.000Z";
const STAMP: CodexAuthStamp = { ctimeMs: 1, kind: "present", mtimeMs: 2, size: 300 };
const SIGNED_IN_FILES: CodexStoreFiles = {
  auth: { hasApiKey: false, hasTokens: true, readable: true },
  authFile: { kind: "present" },
  authStamp: STAMP,
  store: { kind: "present" },
};

/** A weekly register row. */
function plan({ over = {} }: { over?: Partial<RegisteredPlan> } = {}): RegisteredPlan {
  return {
    alias: "plan-one",
    allowance: { kind: "weekly-window" },
    email: "owner@example.com",
    provider: "claude",
    storeDir: "/stores/plan-one",
    usageLimitPercent: 100,
    ...over,
  };
}

/** A Claude snapshot observed at `observedAtIso`. */
function snapshot({
  fable = true,
  observedAtIso = TEN_MIN_AGO,
  resetAtIso = RESET,
}: {
  fable?: boolean;
  observedAtIso?: string;
  resetAtIso?: string;
} = {}): ClaudePlanUsageSnapshot {
  const window = { resetAtIso, status: "allowed", utilization: 0.29 } as const;
  return {
    alias: "plan-one",
    observedAtIso,
    sevenDay: window,
    ...(fable ? { sevenDayFable: { ...window, utilization: 0.61 } } : {}),
  };
}

/** A Claude probe record for `/stores/plan-one`. */
function probe(over: Partial<ClaudePlanProbeRecord> = {}): ClaudePlanProbeRecord {
  return {
    alias: "plan-one",
    fault: undefined,
    latest: "ok",
    observedAtIso: TEN_MIN_AGO,
    storeDir: "/stores/plan-one",
    unmeasuredBecause: undefined,
    ...over,
  };
}

/** Claude evidence with a fresh snapshot and an ok probe unless overridden. */
function claude({ over = {} }: { over?: Partial<ClaudePlanUsageEvidence> } = {}): ClaudePlanUsageEvidence {
  return {
    plan: plan(),
    probe: { kind: "read", value: probe() },
    modelHost: "claude",
    snapshot: { kind: "read", value: snapshot() },
    ...over,
  };
}

/** A Codex gauge with one weekly window. */
function gauge({ resetAtIso }: { resetAtIso: string | undefined }): CodexGauge {
  return {
    credits: undefined,
    limitId: "codex",
    observedAtIso: TEN_MIN_AGO,
    planType: "team",
    reached: undefined,
    reachedType: undefined,
    windows: [
      { label: "five-hour", resetAtIso: RESET, slot: "primary", usedPercent: 3, windowMinutes: 300 },
      { label: "weekly", resetAtIso, slot: "secondary", usedPercent: 42, windowMinutes: 10080 },
    ],
  };
}

const CODEX_PLAN = plan({ over: { alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" } });

/** Codex evidence with a signed-in filed read for the same stamp unless overridden. */
function codex({ over = {} }: { over?: Partial<CodexPlanUsageEvidence> } = {}): CodexPlanUsageEvidence {
  return {
    files: SIGNED_IN_FILES,
    gauge: { filesUnreadable: 0, gauge: gauge({ resetAtIso: RESET }), kind: "scanned" },
    plan: CODEX_PLAN,
    modelHost: "codex",
    signIn: {
      kind: "read",
      value: {
        alias: "codex-one",
        kind: "record",
        record: {
          alias: "codex-one",
          authStamp: STAMP,
          codexHome: "/stores/codex-one",
          failingSinceIso: undefined,
          readAtIso: TEN_MIN_AGO,
          state: "signed-in",
        },
        revision: 1,
      },
    },
    ...over,
  };
}

/** The one row a single piece of evidence projects to. */
function only({ evidence }: { evidence: ClaudePlanUsageEvidence | CodexPlanUsageEvidence }): PlanUsageRow {
  return planUsageReport({ evidence: [evidence], observedAtIso: NOW }).rows[0]!;
}

describe("planUsageReport", () => {
  it("keeps register order, one row per destination", () => {
    const report = planUsageReport({ evidence: [codex(), claude()], observedAtIso: NOW });

    expect(report.observedAtIso).toBe(NOW);
    expect(report.rows.map((row) => row.alias)).toEqual(["codex-one", "plan-one"]);
  });

  it("converts Claude's fraction to a percentage once, and carries the Fable week beside it", () => {
    const row = only({ evidence: claude() });

    expect(row.usage).toEqual({
      kind: "weekly",
      windows: [
        {
          kind: "measured",
          label: "week",
          observedAtIso: TEN_MIN_AGO,
          resetAtIso: RESET,
          source: "claude-gauge-snapshot",
          usedPercent: 29,
        },
        {
          kind: "measured",
          label: "fable-week",
          observedAtIso: TEN_MIN_AGO,
          resetAtIso: RESET,
          source: "claude-gauge-snapshot",
          usedPercent: 61,
        },
      ],
    });
    expect(row.signIn).toEqual({ kind: "ok", observedAtIso: TEN_MIN_AGO, source: "claude-gauge-probe" });
    expect(row.email).toBe("owner@example.com");
  });

  it("says no reading for an absent Fable week, never 0%", () => {
    const row = only({ evidence: claude({ over: { snapshot: { kind: "read", value: snapshot({ fable: false }) } } }) });

    expect(row.usage).toMatchObject({
      kind: "weekly",
      windows: [
        { kind: "measured", label: "week", usedPercent: 29 },
        {
          kind: "no-reading",
          label: "fable-week",
          observedAtIso: TEN_MIN_AGO,
          reason: "the last gauge carried no reading of this window",
          source: "claude-gauge-snapshot",
        },
      ],
    });
  });

  it("measures a Claude reading exactly an hour old, and marks one a millisecond older stale with its number kept", () => {
    const atHour = only({
      evidence: claude({
        over: { snapshot: { kind: "read", value: snapshot({ observedAtIso: "2026-11-06T11:00:00.000Z" }) } },
      }),
    });
    const pastHour = only({
      evidence: claude({
        over: { snapshot: { kind: "read", value: snapshot({ observedAtIso: "2026-11-06T10:59:59.999Z" }) } },
      }),
    });

    expect(atHour.usage).toMatchObject({ windows: [{ kind: "measured", usedPercent: 29 }, { kind: "measured" }] });
    expect(pastHour.usage).toMatchObject({
      windows: [
        {
          kind: "stale",
          reason: "the last reading is older than the hour a reading stays evidence",
          usedPercent: 29,
        },
        { kind: "stale", usedPercent: 61 },
      ],
    });
  });

  it("refuses a reading dated after the report as unavailable", () => {
    const row = only({
      evidence: claude({
        over: { snapshot: { kind: "read", value: snapshot({ observedAtIso: "2026-11-06T12:00:00.001Z" }) } },
      }),
    });

    expect(row.usage).toMatchObject({
      windows: [
        { kind: "unavailable", reason: "the reading is dated 2026-11-06T12:00:00.001Z, after this report" },
        { kind: "unavailable" },
      ],
    });
  });

  it("drops a number whose window has reset since it was read, at the reset instant itself", () => {
    const row = only({
      evidence: claude({ over: { snapshot: { kind: "read", value: snapshot({ resetAtIso: NOW }) } } }),
    });

    expect(row.usage).toMatchObject({
      windows: [
        { kind: "no-reading", reason: `the window reset at ${NOW}, after the last reading` },
        { kind: "no-reading" },
      ],
    });
  });

  it("says no gauge has recorded a plan with no snapshot, and keeps an unreadable one to its own row", () => {
    const none = only({ evidence: claude({ over: { snapshot: { kind: "read", value: undefined } } }) });
    const report = planUsageReport({
      evidence: [claude({ over: { snapshot: { kind: "unreadable", reason: "bad json" } } }), codex()],
      observedAtIso: NOW,
    });

    expect(none.usage).toMatchObject({
      windows: [{ kind: "no-reading", reason: "no gauge has recorded this plan yet" }, { kind: "no-reading" }],
    });
    expect(report.rows[0]!.usage).toMatchObject({
      windows: [{ kind: "unavailable", reason: "bad json" }, { kind: "unavailable" }],
    });
    expect(report.rows[1]!.usage).toMatchObject({ windows: [{ kind: "measured", usedPercent: 42 }] });
  });

  it("carries no weekly number on a paused or a monthly-spend row", () => {
    const paused = only({
      evidence: claude({
        over: { plan: plan({ over: { paused: { reason: "lapsed", sinceIso: "2026-11-01T00:00:00.000Z" } } }) },
      }),
    });
    const monthly = only({
      evidence: codex({
        over: { gauge: { kind: "not-scanned" }, plan: { ...CODEX_PLAN, allowance: { kind: "monthly-spend" } } },
      }),
    });

    expect(paused.usage).toEqual({ kind: "paused", reason: "lapsed", sinceIso: "2026-11-01T00:00:00.000Z" });
    expect(monthly.usage).toEqual({
      kind: "not-measured",
      reason: "a monthly-spend allowance: nothing here measures monthly spend",
    });
    expect(monthly.allowance).toBe("monthly-spend");
  });

  it("says a Claude plan needs a sign-in on a carried sign-in fault, and unknown on a fault a sign-in does not fix", () => {
    const fault = { lastSeenIso: TEN_MIN_AGO, message: "nothing signed in", sinceIso: "2026-11-05T00:00:00.000Z" };
    const signedOut = only({
      evidence: claude({
        over: {
          probe: { kind: "read", value: probe({ fault: { ...fault, code: "STORE_NOT_READY" }, latest: "unmeasured" }) },
        },
      }),
    });
    const broken = only({
      evidence: claude({
        over: {
          probe: { kind: "read", value: probe({ fault: { ...fault, code: "SETUP_TOKEN_REJECTED" }, latest: "fault" }) },
        },
      }),
    });

    expect(signedOut.signIn).toEqual({
      kind: "needs-sign-in",
      observedAtIso: TEN_MIN_AGO,
      reason: "nothing signed in",
      source: "claude-gauge-probe",
    });
    expect(broken.signIn.kind).toBe("unknown");
  });

  it("trusts no Claude probe of another store, and none at all when the probe store is down", () => {
    const moved = only({ evidence: claude({ over: { probe: { kind: "read", value: probe({ storeDir: "/old" }) } } }) });
    const down = only({ evidence: claude({ over: { probe: { kind: "unreadable", reason: "store unavailable" } } }) });

    expect(moved.signIn).toEqual({
      kind: "unknown",
      observedAtIso: TEN_MIN_AGO,
      reason: "the last probe read a different store than the one this plan names",
      source: "claude-gauge-probe",
    });
    expect(down.signIn).toEqual({
      kind: "unknown",
      observedAtIso: null,
      reason: "store unavailable",
      source: "claude-gauge-probe",
    });
  });

  it("reads Codex's weekly window by its label, never its slot, and keeps a missing reset as null", () => {
    const row = only({ evidence: codex() });
    const noReset = only({
      evidence: codex({
        over: { gauge: { filesUnreadable: 0, gauge: gauge({ resetAtIso: undefined }), kind: "scanned" } },
      }),
    });

    expect(row.usage).toEqual({
      kind: "weekly",
      windows: [
        {
          kind: "measured",
          label: "week",
          observedAtIso: TEN_MIN_AGO,
          resetAtIso: RESET,
          source: "codex-rollout-log",
          usedPercent: 42,
        },
      ],
    });
    expect(noReset.usage).toMatchObject({ windows: [{ kind: "measured", resetAtIso: null, usedPercent: 42 }] });
  });

  it("keeps a reading with no reset for exactly a week, and calls one a millisecond older no reading", () => {
    const aged = ({ observedAtIso }: { observedAtIso: string }): PlanUsageRow =>
      only({
        evidence: codex({
          over: {
            gauge: {
              filesUnreadable: 0,
              gauge: { ...gauge({ resetAtIso: undefined }), observedAtIso },
              kind: "scanned",
            },
          },
        }),
      });

    expect(aged({ observedAtIso: "2026-10-30T12:00:00.000Z" }).usage).toMatchObject({
      windows: [{ kind: "measured", resetAtIso: null, usedPercent: 42 }],
    });
    expect(aged({ observedAtIso: "2026-10-30T11:59:59.999Z" }).usage).toEqual({
      kind: "weekly",
      windows: [
        {
          kind: "no-reading",
          label: "week",
          observedAtIso: "2026-10-30T11:59:59.999Z",
          reason: "the last reading is older than a week, so its window has reset since",
          source: "codex-rollout-log",
        },
      ],
    });
  });

  it("says a Codex store with no reading in its logs has none, nor one whose newest reading has no weekly window", () => {
    const row = only({
      evidence: codex({ over: { gauge: { filesUnreadable: 0, gauge: undefined, kind: "scanned" } } }),
    });
    const fiveHourOnly = { ...gauge({ resetAtIso: RESET }), windows: gauge({ resetAtIso: RESET }).windows.slice(0, 1) };
    const noWeek = only({
      evidence: codex({ over: { gauge: { filesUnreadable: 0, gauge: fiveHourOnly, kind: "scanned" } } }),
    });
    const unscanned = only({ evidence: codex({ over: { gauge: { kind: "not-scanned" } } }) });

    expect(row.usage).toMatchObject({
      windows: [{ kind: "no-reading", reason: "no rollout log in this store holds a reading" }],
    });
    expect(noWeek.usage).toMatchObject({
      windows: [
        { kind: "no-reading", observedAtIso: TEN_MIN_AGO, reason: "the newest reading carried no weekly window" },
      ],
    });
    expect(unscanned.usage).toMatchObject({ windows: [{ kind: "no-reading", reason: "not scanned" }] });
  });

  it("never calls a Codex reading measured when the scan met a rollout file or directory it could not read", () => {
    const doubted = only({
      evidence: codex({
        over: { gauge: { filesUnreadable: 1, gauge: gauge({ resetAtIso: RESET }), kind: "scanned" } },
      }),
    });
    const nothing = only({
      evidence: codex({ over: { gauge: { filesUnreadable: 2, gauge: undefined, kind: "scanned" } } }),
    });

    expect(doubted.usage).toEqual({
      kind: "weekly",
      windows: [
        {
          kind: "stale",
          label: "week",
          observedAtIso: TEN_MIN_AGO,
          reason: "1 rollout file or directory in this store could not be read, so a later reading may exist",
          resetAtIso: RESET,
          source: "codex-rollout-log",
          usedPercent: 42,
        },
      ],
    });
    expect(nothing.usage).toEqual({
      kind: "weekly",
      windows: [
        {
          kind: "no-reading",
          label: "week",
          observedAtIso: null,
          reason: "2 rollout files or directories in this store could not be read",
          source: "codex-rollout-log",
        },
      ],
    });
  });

  it("calls a Codex store ok only on a live read filed for the same home and auth.json", () => {
    const ok = only({ evidence: codex() });
    const changed = only({
      evidence: codex({ over: { files: { ...SIGNED_IN_FILES, authStamp: { ...STAMP, size: 301 } } } }),
    });
    const unfiled = only({
      evidence: codex({ over: { signIn: { kind: "read", value: { alias: "codex-one", kind: "absent" } } } }),
    });

    expect(ok.signIn).toEqual({ kind: "ok", observedAtIso: TEN_MIN_AGO, source: "codex-live-read" });
    expect(changed.signIn).toEqual({
      kind: "unknown",
      observedAtIso: TEN_MIN_AGO,
      reason: "auth.json changed since the last live read",
      source: "codex-live-read",
    });
    expect(unfiled.signIn).toEqual({
      kind: "unknown",
      observedAtIso: null,
      reason: "no live read of this store is filed",
      source: "codex-live-read",
    });
  });

  it("says a Codex store needs a sign-in off its own files, before any live read", () => {
    const absent = only({
      evidence: codex({
        over: { files: { ...SIGNED_IN_FILES, authFile: { kind: "missing" }, authStamp: { kind: "absent" } } },
      }),
    });
    const empty = only({
      evidence: codex({
        over: { files: { ...SIGNED_IN_FILES, auth: { hasApiKey: false, hasTokens: false, readable: true } } },
      }),
    });
    const missing = only({ evidence: codex({ over: { files: { ...SIGNED_IN_FILES, store: { kind: "missing" } } } }) });

    expect(absent.signIn).toEqual({
      kind: "needs-sign-in",
      observedAtIso: null,
      reason: "auth.json is absent",
      source: "codex-store-files",
    });
    expect(empty.signIn).toMatchObject({ kind: "needs-sign-in", reason: "auth.json holds no sign-in" });
    expect(missing.signIn).toMatchObject({ kind: "needs-sign-in", reason: "the store directory is missing" });
  });

  it("says a Codex store the last live read found signed out needs a sign-in, against the same auth.json", () => {
    const row = only({
      evidence: codex({
        over: {
          signIn: {
            kind: "read",
            value: {
              alias: "codex-one",
              kind: "record",
              record: {
                alias: "codex-one",
                authStamp: STAMP,
                codexHome: "/stores/codex-one",
                failingSinceIso: TEN_MIN_AGO,
                readAtIso: TEN_MIN_AGO,
                state: "signed-out",
              },
              revision: 2,
            },
          },
        },
      }),
    });

    expect(row.signIn).toEqual({
      kind: "needs-sign-in",
      observedAtIso: TEN_MIN_AGO,
      reason: "the last live read found it signed out",
      source: "codex-live-read",
    });
  });
});

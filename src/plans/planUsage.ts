/**
 * Each registered plan's usage and sign-in state, projected from what this machine ALREADY RECORDED — the report
 * `plans usage` prints and the desktop app's menu bar reads through the console. Pure: the evidence arrives already
 * read (`./planUsageRead.ts` is the effectful half), and the clock is an argument.
 *
 * ## Nothing here is a live reading, and every row says where its number came from
 *
 * A Claude plan's week is the snapshot `claude gauge` or `claude watch` last recorded
 * (`../claude/planUsageSnapshot.ts`); a Codex plan's is the newest rate-limit event in its store's own rollout logs
 * (`../codex/gaugeScan.ts`). Neither read asks a model host anything, so each window carries its own observation instant
 * and source, and a reader ages it rather than trusting it.
 *
 * ## What a row may NOT say
 *
 * A plan with no reading never says 0%. A Claude reading older than {@link CLAUDE_USAGE_READING_FRESH_MS} is `stale`
 * — its number kept, so a reader can see what it was, but never as `measured`. A window whose reset has passed since
 * it was read has reopened, so its old number is dropped as `no-reading`. A Codex reading from a scan that reached a
 * rollout file it could not open is `stale` too, since that file may hold a later one. A paused plan and a monthly-spend plan carry
 * no weekly number at all: nothing here measures monthly spend, and a paused plan is the owner's decision to take it out.
 *
 * ## Sign-in is a separate question from usage
 *
 * It is `./planUsageSignIn.ts`'s, and its header says what counts as `ok`. The shapes are `./planUsageTypes.ts`.
 */
import { parseIsoMs } from "#lib/date.js";

import type { ClaudeWindowReading } from "../claude/contracts.js";
import type { ClaudePlanUsageSnapshot } from "../claude/planUsageSnapshot.js";
import { CLAUDE_USAGE_READING_FRESH_MS } from "../claude/seatUsageGate.js";
import { codexWindowByLabel } from "../codex/gauge.js";

import { claudeSignIn, codexSignIn } from "./planUsageSignIn.js";
import type {
  CodexPlanUsageEvidence,
  PlanUsageEvidence,
  PlanUsageRead,
  PlanUsageReport,
  PlanUsageRow,
  PlanUsageSource,
  PlanUsageState,
  PlanUsageWindow,
  PlanUsageWindowLabel,
} from "./planUsageTypes.js";
import type { RegisteredPlan } from "./types.js";

/** Why a monthly-spend row carries no weekly number. */
const MONTHLY_NOT_MEASURED = "a monthly-spend allowance: nothing here measures monthly spend";

/** The longest a weekly window stays open: a reading older than this is of a window that has reset since. */
const WEEK_MS = 7 * 24 * 60 * 60_000;

/**
 * Whether a row carries weekly windows at all, or why not.
 *
 * @param plan the register row
 * @returns `undefined` when the row is a measured weekly plan, else the state it carries instead
 */
function unmeasuredState({ plan }: { plan: RegisteredPlan }): PlanUsageState | undefined {
  if (plan.paused !== undefined) {
    return { kind: "paused", reason: plan.paused.reason, sinceIso: plan.paused.sinceIso };
  }
  if (plan.allowance.kind === "monthly-spend") {
    return { kind: "not-measured", reason: MONTHLY_NOT_MEASURED };
  }
  return undefined;
}

/**
 * Whether a plan's evidence calls for its rollout logs to be scanned — a measured weekly row only.
 *
 * @param plan the register row
 * @returns true when the collector should scan this row's store
 */
export function wantsWeeklyReading({ plan }: { plan: RegisteredPlan }): boolean {
  return unmeasuredState({ plan }) === undefined;
}

/** A Claude fraction as a percentage, to one decimal place so `0.29` reads 29 and not 28.999999999999996. */
function claudePercent({ utilization }: { utilization: number }): number {
  return Math.round(utilization * 1000) / 10;
}

/**
 * Whether a reading's window has reopened since it was read, and so says nothing about the window open now.
 *
 * @param observedMs when the reading was taken, already known not to be after the report
 * @returns why it has reopened, or `undefined` while the reading is still of the open window
 */
function reopenedReason({
  nowMs,
  observedMs,
  resetAtIso,
}: {
  nowMs: number;
  observedMs: number;
  resetAtIso: string | null;
}): string | undefined {
  // A weekly window with no recorded reset still resets within a week of any reading of it, so a reading older than
  // that has reopened since, whichever instant the reset fell on.
  if (resetAtIso === null) {
    if (nowMs - observedMs > WEEK_MS) {
      return "the last reading is older than a week, so its window has reset since";
    }
    return undefined;
  }
  const resetMs = parseIsoMs({ tsIso: resetAtIso });
  if (resetMs !== undefined && resetMs <= nowMs) {
    return `the window reset at ${resetAtIso}, after the last reading`;
  }
  return undefined;
}

/**
 * One recorded window, judged against the report instant: dropped once its reset has passed, and for Claude marked
 * stale past the hour a reading stays evidence.
 *
 * @param freshForMs how long a reading stays `measured`, or `undefined` when its source has no such bound (Codex)
 * @returns the window
 */
function judgedWindow({
  freshForMs,
  label,
  nowMs,
  observedAtIso,
  resetAtIso,
  source,
  usedPercent,
}: {
  freshForMs: number | undefined;
  label: PlanUsageWindowLabel;
  nowMs: number;
  observedAtIso: string;
  resetAtIso: string | null;
  source: PlanUsageSource;
  usedPercent: number;
}): PlanUsageWindow {
  const observedMs = parseIsoMs({ tsIso: observedAtIso });
  if (observedMs === undefined || observedMs > nowMs) {
    return {
      kind: "unavailable",
      label,
      observedAtIso,
      reason: `the reading is dated ${observedAtIso}, after this report`,
      source,
    };
  }
  const reopened = reopenedReason({ nowMs, observedMs, resetAtIso });
  if (reopened !== undefined) {
    return { kind: "no-reading", label, observedAtIso, reason: reopened, source };
  }
  if (freshForMs !== undefined && nowMs - observedMs > freshForMs) {
    return {
      kind: "stale",
      label,
      observedAtIso,
      reason: "the last reading is older than the hour a reading stays evidence",
      resetAtIso,
      source,
      usedPercent,
    };
  }
  return { kind: "measured", label, observedAtIso, resetAtIso, source, usedPercent };
}

/**
 * One Claude window off a snapshot.
 *
 * @param window the recorded window, or `undefined` when the snapshot carried none (a Fable week the probe never asked for)
 * @returns the judged window
 */
function claudeWindow({
  label,
  nowMs,
  observedAtIso,
  window,
}: {
  label: PlanUsageWindowLabel;
  nowMs: number;
  observedAtIso: string;
  window: ClaudeWindowReading | undefined;
}): PlanUsageWindow {
  if (window === undefined) {
    return {
      kind: "no-reading",
      label,
      observedAtIso,
      reason: "the last gauge carried no reading of this window",
      source: "claude-gauge-snapshot",
    };
  }
  return judgedWindow({
    freshForMs: CLAUDE_USAGE_READING_FRESH_MS,
    label,
    nowMs,
    observedAtIso,
    resetAtIso: window.resetAtIso,
    source: "claude-gauge-snapshot",
    usedPercent: claudePercent({ utilization: window.utilization }),
  });
}

/**
 * A Claude row's weekly windows: the plan-wide week, then the Fable week.
 *
 * @returns both windows, each saying what can be said of it
 */
function claudeWindows({
  nowMs,
  snapshot,
}: {
  nowMs: number;
  snapshot: PlanUsageRead<ClaudePlanUsageSnapshot | undefined>;
}): readonly PlanUsageWindow[] {
  const labels: readonly PlanUsageWindowLabel[] = ["week", "fable-week"];
  if (snapshot.kind === "unreadable") {
    return labels.map((label) => ({
      kind: "unavailable",
      label,
      observedAtIso: null,
      reason: snapshot.reason,
      source: "claude-gauge-snapshot",
    }));
  }
  const recorded = snapshot.value;
  if (recorded === undefined) {
    return labels.map((label) => ({
      kind: "no-reading",
      label,
      observedAtIso: null,
      reason: "no gauge has recorded this plan yet",
      source: "claude-gauge-snapshot",
    }));
  }
  return [
    claudeWindow({ label: "week", nowMs, observedAtIso: recorded.observedAtIso, window: recorded.sevenDay }),
    claudeWindow({ label: "fable-week", nowMs, observedAtIso: recorded.observedAtIso, window: recorded.sevenDayFable }),
  ];
}

/**
 * A Codex row's weekly window, off its store's newest rollout reading — the window found by its width-derived label,
 * never by slot.
 *
 * @returns the one window
 */
function codexWindows({
  gauge,
  nowMs,
}: {
  gauge: CodexPlanUsageEvidence["gauge"];
  nowMs: number;
}): readonly PlanUsageWindow[] {
  const source: PlanUsageSource = "codex-rollout-log";
  if (gauge.kind === "not-scanned") {
    return [{ kind: "no-reading", label: "week", observedAtIso: null, reason: "not scanned", source }];
  }
  if (gauge.kind === "shared") {
    const reason = `this store's sessions folder is also ${gauge.sharedWith.join(", ")}'s, so its reading cannot be told to be this plan's`;
    return [{ kind: "no-reading", label: "week", observedAtIso: null, reason, source }];
  }
  const unreadable = unreadableReason({ filesUnreadable: gauge.filesUnreadable });
  if (gauge.gauge === undefined) {
    let reason = "no rollout log in this store holds a reading";
    if (unreadable !== undefined) {
      reason = unreadable;
    }
    return [{ kind: "no-reading", label: "week", observedAtIso: null, reason, source }];
  }
  const weekly = codexWindowByLabel({ gauge: gauge.gauge, label: "weekly" });
  if (weekly === undefined) {
    return [
      {
        kind: "no-reading",
        label: "week",
        observedAtIso: gauge.gauge.observedAtIso,
        reason: "the newest reading carried no weekly window",
        source,
      },
    ];
  }
  let resetAtIso: string | null = null;
  if (weekly.resetAtIso !== undefined) {
    resetAtIso = weekly.resetAtIso;
  }
  const judged = judgedWindow({
    freshForMs: undefined,
    label: "week",
    nowMs,
    observedAtIso: gauge.gauge.observedAtIso,
    resetAtIso,
    source,
    usedPercent: weekly.usedPercent,
  });
  if (judged.kind === "measured" && unreadable !== undefined) {
    return [{ ...judged, kind: "stale", reason: `${unreadable}, so a later reading may exist` }];
  }
  return [judged];
}

/**
 * Why a Codex scan's answer is in doubt: a rollout file or session directory it could not open reads as empty, so the
 * reading it returned may be older than one hidden there.
 *
 * @param filesUnreadable how many rollout files and session directories the scan could not read
 * @returns the reason, or `undefined` when every file it reached was read
 */
function unreadableReason({ filesUnreadable }: { filesUnreadable: number }): string | undefined {
  if (filesUnreadable === 0) {
    return undefined;
  }
  const noun = filesUnreadable === 1 ? "file or directory" : "files or directories";
  return `${String(filesUnreadable)} rollout ${noun} in this store could not be read`;
}

/**
 * One row off its evidence.
 *
 * @returns the row
 */
function planUsageRow({ evidence, nowMs }: { evidence: PlanUsageEvidence; nowMs: number }): PlanUsageRow {
  const { plan } = evidence;
  let email: string | null = null;
  if (plan.email !== undefined) {
    email = plan.email;
  }
  const head = {
    alias: plan.alias,
    allowance: plan.allowance.kind,
    email,
    modelHost: plan.provider,
    usageLimitPercent: plan.usageLimitPercent,
  };
  const unmeasured = unmeasuredState({ plan });
  if (evidence.modelHost === "claude") {
    const signIn = claudeSignIn({ plan, probe: evidence.probe });
    if (unmeasured !== undefined) {
      return { ...head, signIn, usage: unmeasured };
    }
    return {
      ...head,
      signIn,
      usage: { kind: "weekly", windows: claudeWindows({ nowMs, snapshot: evidence.snapshot }) },
    };
  }
  const signIn = codexSignIn({ files: evidence.files, plan, signIn: evidence.signIn });
  if (unmeasured !== undefined) {
    return { ...head, signIn, usage: unmeasured };
  }
  return { ...head, signIn, usage: { kind: "weekly", windows: codexWindows({ gauge: evidence.gauge, nowMs }) } };
}

/**
 * The report: one row per registered destination, in the order the evidence arrives (the register's).
 *
 * @param evidence what was read for each registered row
 * @param observedAtIso the report instant every reading is judged against
 * @returns the report
 */
export function planUsageReport({
  evidence,
  observedAtIso,
}: {
  evidence: readonly PlanUsageEvidence[];
  observedAtIso: string;
}): PlanUsageReport {
  const nowMs = parseIsoMs({ tsIso: observedAtIso })!;
  return { observedAtIso, rows: evidence.map((one) => planUsageRow({ evidence: one, nowMs })) };
}

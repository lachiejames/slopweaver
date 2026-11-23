/**
 * The shapes `plans usage` reports and is built from: the report the desktop menu bar reads, and the recorded evidence
 * each row is projected from. The projection is `./planUsage.ts`, the sign-in verdicts `./planUsageSignIn.ts`, the
 * reads `./planUsageRead.ts`; what a row may and may not say is `./planUsage.ts`'s header.
 */
import type { ClaudePlanProbeRecord } from "../claude/planProbeRecord.js";
import type { ClaudePlanUsageSnapshot } from "../claude/planUsageSnapshot.js";
import type { CodexAuthReport } from "../codex/auth.js";
import type { CodexGauge } from "../codex/gauge.js";
import type { CodexSignInAliasRead } from "../codex/signInPort.js";
import type { CodexAuthStamp } from "../codex/signInRecord.js";

import type { PlanProvider, RegisteredPlan } from "./types.js";
import type { PlanAllowanceKind, UsageLimitPercent } from "./usageLimit.js";

/** Which weekly window a reading is of: the plan-wide week, or Claude's Fable-only week. */
export type PlanUsageWindowLabel = "week" | "fable-week";

/** Where a window's number came from. Neither is a live model-host read. */
export type PlanUsageSource = "claude-gauge-snapshot" | "codex-rollout-log";

/** One weekly window, as far as the recorded evidence lets it be said. */
export type PlanUsageWindow =
  | {
      /** A reading still inside its window, and for Claude inside the hour a reading stays evidence. */
      readonly kind: "measured";
      readonly label: PlanUsageWindowLabel;
      /** 0..100 — Claude's fraction converted once, Codex's percentage as it reported it. */
      readonly usedPercent: number;
      /** When the window resets; `null` when the reading carried no reset. */
      readonly resetAtIso: string | null;
      readonly observedAtIso: string;
      readonly source: PlanUsageSource;
    }
  | {
      /** A Claude reading past its hour: the number it said, never presented as current. */
      readonly kind: "stale";
      readonly label: PlanUsageWindowLabel;
      readonly usedPercent: number;
      readonly resetAtIso: string | null;
      readonly observedAtIso: string;
      readonly source: PlanUsageSource;
      readonly reason: string;
    }
  | {
      /** Nothing recorded for this window, or its reset has passed since — never 0%. */
      readonly kind: "no-reading";
      readonly label: PlanUsageWindowLabel;
      readonly observedAtIso: string | null;
      readonly source: PlanUsageSource;
      readonly reason: string;
    }
  | {
      /** A record exists and could not be used: unreadable, or dated after the report. */
      readonly kind: "unavailable";
      readonly label: PlanUsageWindowLabel;
      readonly observedAtIso: string | null;
      readonly source: PlanUsageSource;
      readonly reason: string;
    };

/** Where a sign-in verdict came from. */
export type PlanSignInSource = "claude-gauge-probe" | "codex-store-files" | "codex-live-read";

/** Whether the store a row names is signed in, as far as recorded evidence says. */
export type PlanUsageSignIn =
  | { readonly kind: "ok"; readonly observedAtIso: string; readonly source: PlanSignInSource }
  | {
      readonly kind: "needs-sign-in";
      readonly observedAtIso: string | null;
      readonly reason: string;
      readonly source: PlanSignInSource;
    }
  | {
      readonly kind: "unknown";
      readonly observedAtIso: string | null;
      readonly reason: string;
      readonly source: PlanSignInSource;
    };

/** A row's usage: its weekly windows, or why it carries none. */
export type PlanUsageState =
  | { readonly kind: "weekly"; readonly windows: readonly PlanUsageWindow[] }
  | { readonly kind: "paused"; readonly reason: string; readonly sinceIso: string }
  | { readonly kind: "not-measured"; readonly reason: string };

/** One registered destination's row. Absent fields are an explicit `null`, so a reader never meets a dropped key. */
export interface PlanUsageRow {
  readonly alias: string;
  readonly modelHost: PlanProvider;
  /** The register's display cache of the account's address — never its identity. */
  readonly email: string | null;
  readonly allowance: PlanAllowanceKind;
  readonly usageLimitPercent: UsageLimitPercent;
  readonly signIn: PlanUsageSignIn;
  readonly usage: PlanUsageState;
}

/** The whole report: when it was assembled, and one row per registered destination in register order. */
export interface PlanUsageReport {
  readonly observedAtIso: string;
  readonly rows: readonly PlanUsageRow[];
}

/** A read that worked, or the reason it did not — evidence a row is built from, never carried as `undefined`. */
export type PlanUsageRead<T> =
  { readonly kind: "read"; readonly value: T } | { readonly kind: "unreadable"; readonly reason: string };

/** What was read for one Claude row. */
export interface ClaudePlanUsageEvidence {
  readonly modelHost: "claude";
  readonly plan: RegisteredPlan;
  /** The plan's last recorded weekly snapshot; `undefined` inside `read` when none was ever recorded. */
  readonly snapshot: PlanUsageRead<ClaudePlanUsageSnapshot | undefined>;
  /** Every plan's probe record, one shared read; `undefined` inside `read` when this plan has none. */
  readonly probe: PlanUsageRead<ClaudePlanProbeRecord | undefined>;
}

/**
 * Whether a Codex store's directory is there to read: `missing` only when the filesystem says no such path, so a
 * directory that exists but cannot be searched is `unreadable`, never taken for an absent sign-in.
 */
export type CodexStoreState =
  | { readonly kind: "present" }
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable"; readonly reason: string };

/** What was read for one Codex row's store. */
export interface CodexStoreFiles {
  readonly store: CodexStoreState;
  /** Whether `auth.json` itself is there to read, told from the filesystem's own error rather than a failed stat. */
  readonly authFile: CodexStoreState;
  readonly auth: Pick<CodexAuthReport, "readable" | "hasTokens" | "hasApiKey">;
  readonly authStamp: CodexAuthStamp;
}

/** What was read for one Codex row. */
export interface CodexPlanUsageEvidence {
  readonly modelHost: "codex";
  readonly plan: RegisteredPlan;
  readonly files: CodexStoreFiles;
  /** What the store holds for this alias's last live read. */
  readonly signIn: PlanUsageRead<CodexSignInAliasRead>;
  /**
   * The rollout scan's newest reading: `scanned` with `undefined` when no log held one, or `not-scanned` for a row
   * that carries no weekly number (paused, monthly-spend) and so is never scanned. `filesUnreadable` counts the rollout
   * files the scan reached and could not open: a newer one of those may hold a later reading than `gauge`. `shared`
   * when another registered store's `sessions/` resolves to the same folder, so no reading in it can be told to be
   * this plan's rather than the other's, and none is scanned.
   */
  readonly gauge:
    | { readonly kind: "scanned"; readonly gauge: CodexGauge | undefined; readonly filesUnreadable: number }
    | { readonly kind: "not-scanned" }
    | { readonly kind: "shared"; readonly sharedWith: readonly string[] };
}

/** Everything one row is built from. */
export type PlanUsageEvidence = ClaudePlanUsageEvidence | CodexPlanUsageEvidence;

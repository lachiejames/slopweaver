/**
 * The LAST RECORDED weekly reading of one Claude plan — what the `UserPromptSubmit` seat check judges a running seat
 * on a limited plan against (`./seatUsageGate.ts`). Pure: the document's shape, its parser and its typed errors.
 * `./planUsageSnapshotStore.ts` is the effectful half.
 *
 * ## Why a snapshot of its own
 *
 * Nothing cheap held a plan's utilization before it. The plan probe register (`./planProbeRecord.ts`) keeps only
 * whether a probe worked; the drawdown journal holds utilization but grows by a line per window per tick and carries
 * no usage limit; the readings ledger keeps whole `claude gauge --json` documents only when the supervisor tick files
 * them. A prompt hook runs on every turn of every seat, under a 15 s budget node boot alone can spend
 * (`hooks/lib/seat-pass.sh`), so it reads ONE small file per plan.
 *
 * ## What it carries, and what it deliberately does not
 *
 * The two weekly windows a usage limit governs (`./select.ts` `claudeEffectiveUsageCeiling`: the five-hour window
 * keeps the house bar and never the owner's limit) and the instant they were read. NOT the usage limit or the
 * thresholds: the hook reads those off the register it already reads, so a limit the owner raises takes effect on
 * the next prompt rather than on the next gauge.
 */
import { z } from "zod";

import { parseIsoMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import { isPlanAlias } from "../plans/register.js";
import type { ClaudeAccountAlias, ClaudeAccountGauge, ClaudeWindowReading } from "./contracts.js";

/** One plan's last recorded weekly reading. */
export interface ClaudePlanUsageSnapshot {
  readonly alias: ClaudeAccountAlias;
  /** When the reading was taken — the only clock its freshness is judged by. */
  readonly observedAtIso: string;
  readonly sevenDay: ClaudeWindowReading;
  /** Absent when the probe carried no Fable trio; absence never reads as an empty Fable week. */
  readonly sevenDayFable?: ClaudeWindowReading;
}

/** A plan alias the store cannot key a file on. */
export interface PlanUsageAliasInvalidError {
  readonly code: "PLAN_USAGE_ALIAS_INVALID";
  readonly message: string;
  readonly alias: string;
}

/** A snapshot file that exists and could not be read, or reads as something other than a snapshot of its plan. */
export interface PlanUsageSnapshotUnreadableError {
  readonly code: "PLAN_USAGE_SNAPSHOT_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A snapshot that could not be written. */
export interface PlanUsageSnapshotWriteFailedError {
  readonly code: "PLAN_USAGE_SNAPSHOT_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** Another writer held the plan's lock, so this reading was not recorded. */
export interface PlanUsageSnapshotLockUnavailableError {
  readonly code: "PLAN_USAGE_SNAPSHOT_LOCK_UNAVAILABLE";
  readonly message: string;
  readonly alias: string;
}

/** Every failure of fact the snapshot store reports. A usage verdict is policy, never one of these. */
export type ClaudePlanUsageSnapshotError =
  | PlanUsageAliasInvalidError
  | PlanUsageSnapshotUnreadableError
  | PlanUsageSnapshotWriteFailedError
  | PlanUsageSnapshotLockUnavailableError;

/** The factories every {@link ClaudePlanUsageSnapshotError} is built through. */
export const ClaudePlanUsageSnapshotErrors = {
  aliasInvalid: ({ alias }: { alias: string }): PlanUsageAliasInvalidError => ({
    alias,
    code: "PLAN_USAGE_ALIAS_INVALID",
    message: `"${alias}" is not a plan alias, so no usage snapshot is keyed on it`,
  }),
  lockUnavailable: ({ alias, why }: { alias: string; why: string }): PlanUsageSnapshotLockUnavailableError => ({
    alias,
    code: "PLAN_USAGE_SNAPSHOT_LOCK_UNAVAILABLE",
    message: `${alias}'s usage snapshot was not recorded: its lock is held (${why})`,
  }),
  unreadable: ({ path, why }: { path: string; why: string }): PlanUsageSnapshotUnreadableError => ({
    code: "PLAN_USAGE_SNAPSHOT_UNREADABLE",
    message: `the usage snapshot at ${path} could not be read: ${why}`,
    path,
  }),
  writeFailed: ({ path, why }: { path: string; why: string }): PlanUsageSnapshotWriteFailedError => ({
    code: "PLAN_USAGE_SNAPSHOT_WRITE_FAILED",
    message: `the usage snapshot at ${path} was not written: ${why}`,
    path,
  }),
} as const;

/** An ISO instant that parses. */
const INSTANT = z.string().refine((value) => parseIsoMs({ tsIso: value }) !== undefined, "not an ISO instant");

/** One window, as the document spells it. */
const WINDOW = z.strictObject({
  resetAtIso: INSTANT,
  status: z.enum(["allowed", "allowed_warning", "rejected"]),
  // Zod 4's `number()` already refuses NaN and both infinities.
  utilization: z.number().nonnegative(),
});

/** The whole document. */
const SNAPSHOT = z.strictObject({
  alias: z.string(),
  observedAtIso: INSTANT,
  sevenDay: WINDOW,
  sevenDayFable: WINDOW.optional(),
});

/**
 * The snapshot one successful reading records: its two weekly windows and when it was taken.
 *
 * @param gauge the reading `claude gauge` or a `claude watch` tick already took
 * @returns the snapshot to record
 */
export function planUsageSnapshot({ gauge }: { gauge: ClaudeAccountGauge }): ClaudePlanUsageSnapshot {
  return {
    alias: gauge.alias,
    observedAtIso: gauge.observedAtIso,
    sevenDay: gauge.sevenDay,
    ...(gauge.sevenDayFable === undefined ? {} : { sevenDayFable: gauge.sevenDayFable }),
  };
}

/**
 * Decode one snapshot document, refusing anything that is not exactly a snapshot of the plan asked for.
 *
 * A document that names another plan is refused rather than read: a copied or renamed file would otherwise judge
 * one plan's seats by another plan's week.
 *
 * @param document the parsed JSON
 * @param expectedAlias the plan whose file it was read from
 * @param path where it was read from, named in a refusal
 * @returns the snapshot, or why it is not one
 */
export function parseClaudePlanUsageSnapshot({
  document,
  expectedAlias,
  path,
}: {
  document: unknown;
  expectedAlias: string;
  path: string;
}): Result<ClaudePlanUsageSnapshot, ClaudePlanUsageSnapshotError> {
  const parsed = SNAPSHOT.safeParse(document);
  if (!parsed.success) {
    return err(ClaudePlanUsageSnapshotErrors.unreadable({ path, why: parsed.error.issues[0]!.message }));
  }
  if (parsed.data.alias !== expectedAlias) {
    return err(
      ClaudePlanUsageSnapshotErrors.unreadable({
        path,
        why: `it names plan "${parsed.data.alias}", not "${expectedAlias}"`,
      }),
    );
  }
  const { sevenDayFable, ...rest } = parsed.data;
  return ok({ ...rest, ...(sevenDayFable === undefined ? {} : { sevenDayFable }) });
}

/**
 * Whether an alias may key a snapshot file — the register's own alias class, so a path segment from a hook payload
 * or a register row can never leave the directory.
 *
 * @param alias the candidate
 * @returns the alias, or why it cannot key a file
 */
export function snapshotAlias({ alias }: { alias: string }): Result<string, ClaudePlanUsageSnapshotError> {
  if (!isPlanAlias({ alias })) {
    return err(ClaudePlanUsageSnapshotErrors.aliasInvalid({ alias }));
  }
  return ok(alias);
}

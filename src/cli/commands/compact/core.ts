/**
 * The PURE core of `slopweaver compact`: flag parsing (including the `--older-than` age grammar and the
 * horizon arithmetic against an INJECTED clock), the per-source slot partition over an INJECTED acquirer,
 * and the human/JSON rendering of the before→after measure.
 * No fs, no clock, no console — the shell ({@link ./run}) supplies `now` and does every read and write.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import type { SlotVerdict } from "#lib/loadSlots.js";
import type { CompactPlan } from "../../../corpus/compact.js";
import type { InFlightRefresh } from "../../../corpus/refreshSlot.js";
import { type CorpusSource } from "../../../corpus/types.js";
import { BRONZE_SOURCES } from "../../../integrations/corpusSources.js";
import { isOneOf } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";

/** The validated invocation. `olderThanDays` is absent unless explicitly asked for — pruning is opt-in. */
export interface CompactOptions {
  readonly home: string;
  readonly sources: readonly CorpusSource[];
  readonly olderThanDays?: number;
  readonly json: boolean;
}

/** `--older-than` accepts a whole number of days, with or without the `d` suffix: `30` or `30d`. */
const AGE_PATTERN = /^([0-9]{1,6})d?$/;

/**
 * Parse an `--older-than` value into whole days. Accepts `30` and `30d`; everything else (`30days`, `d30`,
 * `1.5`, `-1`, `0`) is a usage error rather than a silently-coerced horizon — this flag DELETES records,
 * so a value we had to guess at is a value we refuse. Pure.
 *
 * @param value the raw flag value
 * @returns the positive day count, or an error naming what was accepted
 */
export function parseOlderThanDays({ value }: { value: string }): Result<number> {
  const matched = AGE_PATTERN.exec(value);
  const days = matched === null ? 0 : Number(matched[1]);
  if (days <= 0) {
    return err([`--older-than must be a positive whole number of days (e.g. \`30\` or \`30d\`), got: ${value}`]);
  }
  return ok(days);
}

/**
 * The age horizon as an ISO instant: records strictly before it are past-horizon. Pure — `now` is
 * injected, so the boundary is testable against a fixed clock.
 *
 * @param now the reference instant (the shell injects the real clock)
 * @param days how many days back the horizon sits
 * @returns the horizon as an ISO-8601 instant
 */
export function horizonIso({ now, days }: { now: Date; days: number }): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Resolve `--source`: the one named source, or every known source when the flag is absent. Pure. */
function selectSources({ source }: { source: string | undefined }): Result<readonly CorpusSource[]> {
  if (source === undefined) {
    return ok(BRONZE_SOURCES);
  }
  if (!isOneOf(source, BRONZE_SOURCES)) {
    return err([`unknown source: ${source} (expected one of: ${BRONZE_SOURCES.join(", ")})`]);
  }
  return ok([source]);
}

/**
 * Parse the verb tail into a validated {@link CompactOptions}. Every rejection (unknown flag, bad source,
 * malformed age) is accumulated, so one run reports everything wrong. Pure.
 *
 * @param rest the argv tail (after `slopweaver compact`)
 * @param defaultHome the home to use when `--home` is absent
 * @returns the validated options, or every rejection
 */
export function parseCompactOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<CompactOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "source", "older-than"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const selected = selectSources({ source: values["source"] });
  if (selected.isErr()) {
    errors.push(...selected.error);
  }
  const rawAge = values["older-than"];
  const age = rawAge === undefined ? undefined : parseOlderThanDays({ value: rawAge });
  if (age?.isErr()) {
    errors.push(...age.error);
  }
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
    sources: selected.isOk() ? selected.value : BRONZE_SOURCES,
    ...(age?.isOk() ? { olderThanDays: age.value } : {}),
  });
}

/** Sum one measure field across every plan. Pure. */
function totalOf({ plans, pick }: { plans: readonly CompactPlan[]; pick: (plan: CompactPlan) => number }): number {
  return plans.reduce((sum, plan) => sum + pick(plan), 0);
}

/**
 * The corpus-wide before→after totals across every compacted source. Pure.
 *
 * @param plans one plan per source, already computed
 * @returns the summed before/after records, bytes and files, plus how much was collapsed as duplicate, how
 *   much was pruned by an age horizon, and how many rows were rejected for failing the required-field gate
 *   — reported apart because pruning and rejection are the only two that lose data — plus the dead
 *   writers' staged files swept, which hold no record and so sit outside every before/after figure
 */
export function compactTotals({ plans }: { plans: readonly CompactPlan[] }): {
  readonly beforeRecords: number;
  readonly afterRecords: number;
  readonly beforeBytes: number;
  readonly afterBytes: number;
  readonly beforeFiles: number;
  readonly afterFiles: number;
  readonly duplicatesCollapsed: number;
  readonly pruned: number;
  readonly rejected: number;
  readonly orphanTempsRemoved: number;
  readonly orphanTempBytes: number;
} {
  return {
    orphanTempBytes: totalOf({ pick: (plan) => plan.orphanTemps.bytes, plans }),
    orphanTempsRemoved: totalOf({ pick: (plan) => plan.orphanTemps.removed, plans }),
    afterBytes: totalOf({ pick: (plan) => plan.after.bytes, plans }),
    afterFiles: totalOf({ pick: (plan) => plan.after.files, plans }),
    afterRecords: totalOf({ pick: (plan) => plan.after.records, plans }),
    beforeBytes: totalOf({ pick: (plan) => plan.before.bytes, plans }),
    beforeFiles: totalOf({ pick: (plan) => plan.before.files, plans }),
    beforeRecords: totalOf({ pick: (plan) => plan.before.records, plans }),
    duplicatesCollapsed: totalOf({ pick: (plan) => plan.duplicatesCollapsed, plans }),
    pruned: totalOf({ pick: (plan) => plan.pruned, plans }),
    rejected: totalOf({ pick: (plan) => plan.rejected, plans }),
  };
}

/** One per-source report line: `github  12 file(s) → 1, 480 → 431 record(s), 49 duplicate(s)`. Pure. */
function planLine({ plan }: { plan: CompactPlan }): string {
  const pruned = plan.pruned === 0 ? "" : `, ${String(plan.pruned)} age-pruned`;
  const rejected = plan.rejected === 0 ? "" : `, ${String(plan.rejected)} rejected (bad record)`;
  const swept =
    plan.orphanTemps.removed === 0
      ? ""
      : `, ${String(plan.orphanTemps.removed)} dead writer's staged file(s) swept (${String(plan.orphanTemps.bytes)} byte(s))`;
  const rekeyed = plan.rekeyed === 0 ? "" : `, ${String(plan.rekeyed)} re-keyed onto a dashed page id`;
  return (
    `  ${plan.source.padEnd(7)} ${String(plan.before.files)} file(s) → ${String(plan.after.files)}, ` +
    `${String(plan.before.records)} → ${String(plan.after.records)} record(s), ` +
    `${String(plan.before.bytes)} → ${String(plan.after.bytes)} byte(s), ` +
    `${String(plan.duplicatesCollapsed)} duplicate(s) collapsed${pruned}${rejected}${rekeyed}${swept}`
  );
}

/**
 * The human report lines (for stderr). The age horizon is ALWAYS stated when pruning ran — a lossy pass
 * never happens quietly. Pure.
 *
 * @param plans the applied per-source plans
 * @param olderThanDays the explicit age horizon, when one was given
 * @param failed the sources that could not be compacted (left unfinished — never partially LOST)
 * @returns the report lines, in display order
 */
export function compactHumanLines({
  plans,
  olderThanDays,
  failed = [],
}: {
  plans: readonly CompactPlan[];
  olderThanDays?: number;
  failed?: readonly CorpusSource[];
}): readonly string[] {
  const totals = compactTotals({ plans });
  const mode =
    olderThanDays === undefined
      ? "lossless (cross-window dedup only — no records dropped by age)"
      : `AGE-PRUNING: dropping records older than ${String(olderThanDays)} day(s)`;
  return [
    `slopweaver compact — ${mode}`,
    "",
    ...plans.map((plan) => planLine({ plan })),
    "",
    `total: ${String(totals.beforeFiles)} → ${String(totals.afterFiles)} file(s), ` +
      `${String(totals.beforeRecords)} → ${String(totals.afterRecords)} record(s), ` +
      `${String(totals.beforeBytes)} → ${String(totals.afterBytes)} byte(s)`,
    `${String(totals.duplicatesCollapsed)} cross-window duplicate(s) collapsed, ${String(totals.pruned)} record(s) age-pruned, ` +
      `${String(totals.rejected)} record(s) rejected (failed the required-field gate)`,
    ...(totals.orphanTempsRemoved === 0
      ? []
      : [
          `${String(totals.orphanTempsRemoved)} staged file(s) of killed earlier runs swept, ` +
            `${String(totals.orphanTempBytes)} byte(s) reclaimed — they held no record`,
        ]),
    "watermarks + thread/repo cursors untouched — the next `slopweaver refresh` resumes exactly where it would have",
    ...(failed.length === 0
      ? []
      : [`FAILED: ${failed.join(", ")} — left UNFINISHED, no records lost; see the warnings above and re-run`]),
  ];
}

/**
 * The stable machine shape for `--json` (stdout). Pure.
 *
 * @param plans the applied per-source plans
 * @param olderThanDays the explicit age horizon, when one was given
 * @param failed the sources that could not be compacted (left unfinished — never partially LOST)
 * @returns the JSON-serialisable object
 */
export function compactJson({
  plans,
  failed = [],
  ...horizon
}: {
  plans: readonly CompactPlan[];
  olderThanDays?: number;
  failed?: readonly CorpusSource[];
}): Readonly<Record<string, unknown>> {
  return {
    failed,
    olderThanDays: unsetFieldAsNull({ key: "olderThanDays", record: horizon }),
    schemaVersion: 1,
    sources: plans.map((plan) => ({
      after: plan.after,
      before: plan.before,
      canonicalPath: plan.canonicalPath,
      duplicatesCollapsed: plan.duplicatesCollapsed,
      orphanTemps: { bytes: plan.orphanTemps.bytes, removed: plan.orphanTemps.removed },
      pruned: plan.pruned,
      rejected: plan.rejected,
      rejectedSamples: plan.rejectedSamples,
      rekeyed: plan.rekeyed,
      source: plan.source,
    })),
    totals: compactTotals({ plans }),
  };
}

/**
 * Split the sources a compaction was asked for into the ones whose slot this process now holds and the ones
 * another process's refresh or compaction holds. Pure over the injected `take`.
 *
 * A source is SKIPPED rather than the whole run refused, exactly as `refresh` drops a held source: a pass
 * over slack and linear, while a refresh holds slack, should still compact linear. A source whose slot could not
 * be taken at all — a refusal naming no holder — is skipped as `unavailable`, never compacted without the slot.
 *
 * @param sources the sources with bronze on disk, in the order they will be compacted
 * @param take the slot acquirer — `acquireRefreshSlot` in the shell, a plain fake in a test
 * @returns the admitted sources, one holder per held source, and the obstacles for each unavailable one
 */
export function partitionBySlot({
  sources,
  take,
}: {
  sources: readonly CorpusSource[];
  take: (args: { source: CorpusSource }) => SlotVerdict;
}): {
  readonly admitted: readonly CorpusSource[];
  readonly held: readonly InFlightRefresh[];
  readonly unavailable: readonly SlotUnavailable[];
} {
  const admitted: CorpusSource[] = [];
  const held: InFlightRefresh[] = [];
  const unavailable: SlotUnavailable[] = [];
  for (const source of sources) {
    const verdict = take({ source });
    if (verdict.admitted) {
      admitted.push(source);
      continue;
    }
    const holder = verdict.holders[0];
    if (holder === undefined) {
      unavailable.push({ obstacles: verdict.obstacles, source });
    } else {
      held.push({ pid: holder.pid, source, startedAtIso: holder.startedAtIso });
    }
  }
  return { admitted, held, unavailable };
}

/** A source whose slot could not be taken, and what stopped it. */
export interface SlotUnavailable {
  readonly source: CorpusSource;
  readonly obstacles: readonly string[];
}

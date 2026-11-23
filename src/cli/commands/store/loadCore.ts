/**
 * The pure half of `store load`: what a load is asked for, and how its report reads.
 *
 * The scope decision lives here as a constant with the ruling that set it, rather than as a default buried
 * in a flag parser, because it is the part of this verb the owner ruled on directly.
 */
import type { CorpusSource, ExportWindow } from "../../../corpus/types.js";
import { CORPUS_SOURCES } from "../../../integrations/corpusSources.js";
import { yyyyMmDdMinusDays, yyyyMmDdTodayPlus } from "../../../lib/date.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlags } from "../../parseFlags.js";
import { type Parsed, type StoreCommandError, StoreCommandErrors, storeCommandErrorLines } from "./errors.js";

/**
 * The flags `store load` takes.
 *
 * @internal
 */
export const LOAD_FLAGS = { boolean: ["json"], string: ["source", "days", "cap", "github-org", "home"] } as const;

/**
 * The flags `store load` advertises, for the help-truth ratchet.
 *
 * @internal
 */
export const STORE_LOAD_FLAG_NAMES: readonly string[] = [
  ...LOAD_FLAGS.string.map((name) => `--${name}`),
  ...LOAD_FLAGS.boolean.map((name) => `--${name}`),
];

/**
 * How many days back one load pulls, unless the caller moves it.
 *
 * One load pulls about a week first across all platforms, or at most the 10,000 most recent records per platform:
 * a whole-history pull is not run before the confidence to earn it exists, and fast feedback loops matter more than
 * the completeness of data at this point.
 */
export const LOAD_DAYS = 7;

/**
 * The most records one platform contributes to one load, whatever the window returns.
 *
 * ## Which of their two bounds is primary, and why it is this way round
 *
 * They offered either, and this verb takes **the week as the bound and the cap as the ceiling**. The WINDOW
 * is what makes a cross-platform question comparable — "this person, across these platforms, this week" is
 * the query shape the same ruling asked for, and a per-platform record cap alone would give Slack a week
 * and Notion a year, so an answer spanning both would be reading two different time ranges and would have
 * no way to say so. The cap stays as the safety bound, so a platform that is unexpectedly chatty inside
 * one week cannot turn a crawl into a backfill. Whichever binds first is reported, by name.
 *
 * ## What this number actually counts, stated because a Codex pass found the claim was looser than the code
 *
 * It bounds what is **WRITTEN**, not what is fetched. The connectors' own `fetchCap` is a PER-LANE hint —
 * Slack applies it to several lanes and to per-channel reads, Linear applies it independently per
 * collection, Notion builds its own budgets from it, and the GitHub org job accepts none at all — so
 * passing it does not make a platform's crawl stop at this number. A load therefore keeps the most recent
 * `cap` records of what came back and REPORTS both counts, which is why {@link SourceLoadResult} carries
 * `fetched` and `offered` separately and {@link sourceLoadLine} prints the fetched figure whenever the cap
 * bound. Reproduce the difference: the first real load fetched 11,266 Linear records for a cap of 10,000.
 * A source-wide budget threaded into each connector's lanes is the correct fix and is the named follow-up.
 */
export const LOAD_CAP = 10_000;

/**
 * The sources a load pulls when the caller names none, and the only ones it accepts: the org-shared surfaces
 * `refresh --all-sources` sweeps ({@link CORPUS_SOURCES}, derived from each manifest's `allSourcesSweep`). A private
 * source is never loaded, for the reason it is never swept. A swept source `jobFor` (`./load.ts`) has no job for,
 * neither GitHub nor token-gated, is refused there by name.
 *
 * @internal
 */
export const LOAD_SOURCES: readonly CorpusSource[] = CORPUS_SOURCES;

/** What one platform's leg of a load did. */
export interface SourceLoadResult {
  readonly source: CorpusSource;
  readonly ok: boolean;
  /** How many records the connector returned, before the cap. */
  readonly fetched: number;
  /** How many of those the cap let through — equal to {@link fetched} unless the cap bound. */
  readonly offered: number;
  readonly stored: number;
  readonly refused: number;
  /** How many of the offered records were a repeat of one already in the same batch, and so collapsed. */
  readonly collapsed: number;
  readonly elapsedMs: number;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * The window a load pulls, from a reference instant.
 *
 * `until` is TOMORROW rather than today, matching what `refresh` does, so a record written later today is
 * inside the window rather than one day out of it.
 *
 * @param now the reference instant
 * @param days how many days back to pull
 * @returns the export window
 */
export function loadWindow({ now, days = LOAD_DAYS }: { now: Date; days?: number }): ExportWindow {
  const until = yyyyMmDdTodayPlus({ days: 1, now });
  return { since: yyyyMmDdMinusDays({ date: until, days: days + 1 }), until };
}

/**
 * The line one platform's leg earns, saying exactly what each number counts.
 *
 * Every count here has been the recurring defect on this workstream — a facet percentage that was of the
 * page, a byte count that was of chunks touched, a row count that was of write operations. So the label
 * and the number are written together: `fetched` is what the connector returned, `stored` is what the
 * database wrote (an upsert of a row already there counts, because the row was refreshed), and the cap is
 * named only when it actually bound.
 *
 * @param result one platform's leg
 * @param cap the per-platform ceiling this load ran under
 * @returns the report line
 */
export function sourceLoadLine({ result, cap }: { result: SourceLoadResult; cap: number }): string {
  if (!result.ok) {
    return `${result.source}: FAILED — ${result.errors.join("; ")}`;
  }
  const capped =
    result.fetched > result.offered ? `, CAPPED at ${String(cap)} (${String(result.fetched)} fetched)` : "";
  const refused = result.refused > 0 ? `, ${String(result.refused)} record(s) refused` : "";
  // The gap between what was offered and what was written is duplicates collapsed inside the batch, and
  // it is named for the reason every count here is named: a reader who cannot account for 95 missing
  // records assumes a bug, and a report that leaves them to assume is the defect.
  const collapsed = result.collapsed > 0 ? `, ${String(result.collapsed)} collapsed as repeats` : "";
  return (
    `${result.source}: ${String(result.stored)} row(s) written from ${String(result.offered)} record(s) ` +
    `fetched${capped}${collapsed}${refused}, ${String(Math.round(result.elapsedMs / 1000))}s`
  );
}

/**
 * The whole report a load prints.
 *
 * @param results one entry per platform, in the order they ran
 * @param window the window every platform was pulled over
 * @param cap the per-platform ceiling
 * @returns the lines to print
 */
export function loadLines({
  results,
  window,
  cap,
}: {
  results: readonly SourceLoadResult[];
  window: ExportWindow;
  cap: number;
}): readonly string[] {
  const stored = results.reduce((total, result) => total + result.stored, 0);
  return [
    `store load — ${window.since} to ${window.until}, keeping at most the newest ${String(cap)} record(s) per platform`,
    ...results.map((result) => `  ${sourceLoadLine({ cap, result })}`),
    `${String(stored)} row(s) written across ${String(results.filter((result) => result.ok).length)} platform(s)`,
    "This pulled from the PROVIDERS. It read no bronze file; `slopweaver store status` is what the store now holds.",
  ];
}

/**
 * The exit code a load earns: non-zero when any platform failed, so a partial pull is visible to a caller.
 *
 * One failure never sinks the others — every platform runs and every one reports — but a run where GitHub
 * failed and Slack did not is not a successful run, and a zero exit would say it was.
 *
 * @param results one entry per platform
 * @returns whether every platform succeeded
 */
export function loadSucceeded({ results }: { results: readonly SourceLoadResult[] }): boolean {
  return results.length > 0 && results.every((result) => result.ok);
}

/** A parsed `store load` invocation. */
export interface StoreLoadArgs {
  readonly sources: readonly CorpusSource[];
  readonly days: number;
  readonly cap: number;
  readonly json: boolean;
  readonly org?: string;
  readonly home?: string;
}

/**
 * Whether a source name is one this verb can pull.
 *
 * @returns whether {@link LOAD_SOURCES} names it
 *
 * @internal
 */
export function isLoadSource(value: string): value is CorpusSource {
  return LOAD_SOURCES.some((source) => source === value);
}

/**
 * Read a positive integer flag, or the fallback when it was absent; a value that is not one is a refusal.
 *
 * A refusal rather than a silent fallback: `--days seven` taking the default would run a seven-day pull
 * and report a seven-day pull, so the caller would never learn their flag did nothing.
 *
 * @param values the tokenised flag values
 * @param key the flag name, without the leading dashes
 * @param fallback the value to use when the flag is absent
 * @returns the number, or the reason it was refused
 */
function intFlag({
  values,
  key,
  fallback,
}: {
  values: Readonly<Record<string, string | boolean>>;
  key: string;
  fallback: number;
}): Result<number, StoreCommandError> {
  const raw = values[key];
  if (typeof raw !== "string") {
    return ok(fallback);
  }
  if (!/^\d+$/.test(raw) || Number(raw) === 0) {
    return err(StoreCommandErrors.aboveZeroRequired({ flag: key, got: raw }));
  }
  return ok(Number(raw));
}

/**
 * Parse a `store load` invocation. PURE — no network, no database, no clock.
 *
 * @param rest the argv tail
 * @returns the platforms, depth and ceiling to pull, or every reason the invocation was refused
 */
export function parseStoreLoadArgs({ rest }: { rest: readonly string[] }): Parsed<StoreLoadArgs> {
  const parsed = parseFlags({ args: rest, spec: LOAD_FLAGS });
  if (parsed.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const values = parsed.value.values;
  const raw = values["source"];
  const named =
    typeof raw === "string"
      ? raw
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
      : [];
  const unknown = named.filter((source) => !isLoadSource(source));
  const days = intFlag({ fallback: LOAD_DAYS, key: "days", values });
  const cap = intFlag({ fallback: LOAD_CAP, key: "cap", values });
  const errors = [
    ...(unknown.length > 0 ? [StoreCommandErrors.loadSourceUnknown({ known: LOAD_SOURCES, unknown }).message] : []),
    ...(days.isErr() ? storeCommandErrorLines({ error: days.error }) : []),
    ...(cap.isErr() ? storeCommandErrorLines({ error: cap.error }) : []),
  ];
  if (errors.length > 0) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: errors }));
  }
  const org = values["github-org"];
  const home = values["home"];
  return ok({
    cap: cap.isOk() ? cap.value : LOAD_CAP,
    days: days.isOk() ? days.value : LOAD_DAYS,
    json: values["json"] === true,
    sources: named.length > 0 ? named.filter(isLoadSource) : LOAD_SOURCES,
    ...(typeof org === "string" ? { org } : {}),
    ...(typeof home === "string" ? { home } : {}),
  });
}

/**
 * The `--store` leg of `refresh` — replay each fetched source's bronze WINDOW files into the Supabase store.
 *
 * ## Why refresh carries it, rather than the scheduler adding a second step
 *
 * `refresh` writes BRONZE and nothing else, and until this leg existed nothing scheduled ingested bronze
 * into Postgres. A `resync-corpus-<source>` row's only step was `refresh --source <s>`, its clock was the
 * bronze watermark, and so the row reported `succeeded` with the store untouched — MEASURED:
 * `resync-corpus-linear` recorded an `afterClock` over ten hours past the store's newest linear row.
 *
 * ## Why it replays the SOURCE rather than the file this run wrote
 *
 * It used to ingest exactly the window file the plan named, and that left a hole nothing could ever
 * close. MEASURED on a real home: over ten thousand rows stood in bronze that the store did
 * not hold, across six sources — the whole measurement, and the two mechanisms that make such a row
 * permanent, are in `../../../store/bronzeWindows.ts`. The short of it is that bronze dedups per
 * `sourceId` against everything it already holds, so a record that reached bronze in a run WITHOUT
 * `--store` is never written into a later window file, and a leg reading only the newest file could not
 * see it however many times it ran.
 *
 * Replaying the window files makes the leg idempotent-by-upsert rather than incremental-by-position, and
 * the cost of that is measured rather than assumed: about forty seconds for slack's few dozen window files
 * (over a hundred thousand lines, tens of thousands of rows), about as long for linear, a third of that for
 * github. The canonical `compact.jsonl` is omitted and the
 * omission is PRINTED — see `bronzeWindows.ts` for why that is a cost claim and not a coverage one.
 *
 * ## A failed leg fails the verb
 *
 * The same judgement `run.ts`'s derive step makes, for the same reason: a store that did not take what
 * bronze just took is a store that no longer matches bronze, and a resync row that exits zero over that is
 * exactly the false green this leg exists to end. A source with no bronze at all is a printed skip and not
 * a failure — nothing has ever been written for it.
 *
 * Pure orchestration over an injected ingest seam; the production seam opens the store and reads the files.
 */
import { WITHHELD } from "#lib/numbersOnly.js";
import { safeFsAsync } from "#lib/safeBoundary.js";
import type { SourceIngestJob } from "../../../corpus/ingestJob.js";
import type { CorpusSource } from "../../../corpus/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type BronzeScanScope, bronzeBytes, planBronzeWindows } from "../../../store/bronzeWindows.js";
import { connectStore } from "../../../store/client.js";
import { ingestSource } from "../../../store/ingestSource.js";
import { listProtectedBronzeFiles, ownerProtectionFor } from "../../../store/protectedBronze.js";
import type { RefreshResult, RefreshSummaryLine } from "./core.js";
import type { RefreshDeps } from "./deps.js";
import type { RefreshLegFailure, RefreshLegFailures } from "./failureClosingLine.js";
import { emitSummaryLine } from "./summary.js";

/**
 * The per-slice ceiling the leg reads a window file at, in storable records.
 *
 * `store ingest` requires one so nobody gets an unbounded read by omission, and it is a HEAP bound per
 * slice rather than a cap on the pass: the leg always reads every file to its end. A CHOICE rather than a
 * measurement — `docs/store/corpus-scale-and-retrieval-slice.md` took its census at `--limit 10000` per slice over a source's whole bronze,
 * and one window file is one refresh's worth of records, so this sits well under it. Reproduce the cost of
 * a whole source's windows with
 * `time slopweaver store ingest --source <s> --limit 2000 --all --from-file <first window basename>`.
 *
 * @internal — read by {@link productionStoreIngest} and named here so the number has one home.
 */
export const STORE_LEG_SLICE = 2000;

/** The reason a replay that failed without saying why stands on. */
const UNSTATED_STORE_REASON = "the store replay failed without an error message";

/**
 * The sources whose leg replays `compact.jsonl` as well as the window files.
 *
 * `chatgpt sync` receipts an export on this leg's exit, so the leg has to reach every record bronze holds for it.
 * Under `windows` it would not: an export refreshed once WITHOUT `--store` and then compacted sits only in
 * `compact.jsonl`, a re-read dedups to no window file, and the receipt would land over a store missing all of it.
 * One person's chat history is the bronze in question, not a team's Slack, so reading it whole is the cheap side.
 */
export const FULL_REPLAY_SOURCES: ReadonlySet<CorpusSource> = new Set<CorpusSource>(["chatgpt"]);

/**
 * The scope the leg replays a source at when its caller names none.
 *
 * @returns `full` for a {@link FULL_REPLAY_SOURCES} member, else `windows`
 */
export function storeLegScope({ source }: { source: CorpusSource }): BronzeScanScope {
  return FULL_REPLAY_SOURCES.has(source) ? "full" : "windows";
}

/**
 * What replaying one source's window files did, that the source has no bronze to replay, or that the owner's
 * protect list withheld it — a `no-access` source is never listed, and saying so is not a failure of the leg.
 */
export type StoreLegOutcome =
  | { readonly kind: "absent" }
  | { readonly kind: "withheld" }
  | {
      readonly kind: "ingested";
      /** How many window files the pass read. */
      readonly files: number;
      readonly linesRead: number;
      readonly stored: number;
      readonly refused: number;
      /** Files the `windows` scope left out — the canonical `compact.jsonl`, when the source has one. */
      readonly omittedFiles: number;
      /** Bytes in those omitted files, so the line states the size of what it did not read. */
      readonly omittedBytes: number;
    };

/** The seam: replay one source's bronze window files into the selected store, or explain why not. */
export type StoreIngestSource = (args: { home: string; source: CorpusSource }) => Promise<Result<StoreLegOutcome>>;

/**
 * The sources this run should replay: every planned job's source whose bronze write succeeded, each once,
 * in plan order.
 *
 * A job whose source FAILED is skipped rather than replayed, because its window file may hold a partial
 * write and the verb is already exiting non-zero for it; a job whose source is not in `results` at all
 * (nothing ran for it) is skipped for the same reason. Pure.
 *
 * @param jobs the planned ingest jobs
 * @param results the per-source ingest results, in run order
 * @returns the sources to replay, in plan order, each named once
 */
export function storeLegSources({
  jobs,
  results,
}: {
  readonly jobs: readonly SourceIngestJob[];
  readonly results: readonly RefreshResult[];
}): readonly CorpusSource[] {
  const succeeded = new Set(results.filter((result) => result.ok).map((result) => result.source));
  const seen = new Set<CorpusSource>();
  const sources: CorpusSource[] = [];
  for (const job of jobs) {
    if (!succeeded.has(job.source) || seen.has(job.source)) {
      continue;
    }
    seen.add(job.source);
    sources.push(job.source);
  }
  return sources;
}

/**
 * The `--store` leg as `refresh` runs it: replay every fetched source's bronze WINDOW files into the selected
 * store, unless it was not asked for.
 *
 * Runs AFTER the bronze summary, so a reader sees what was written before what was stored, and BEFORE
 * derive, because it depends on bronze alone. A leg that was asked for with no seam wired is a failure
 * rather than a skip: the resync roster passes `--store` on every corpus row, and a row that exited zero
 * having stored nothing is the false green this leg exists to end.
 *
 * @param deps the store seam and the sink every line goes to
 * @param home the Slopweaver home
 * @param jobs the planned per-source ingest jobs, which name the sources to replay
 * @param results the per-source ingest results, in run order
 * @param store whether `--store` was passed
 * @param numbersOnly whether output is a paste-safe capture, which withholds each failure's reason
 * @returns what did not reach the store; none when every replayed source did, or the leg was not asked for
 */
export async function runRefreshStoreStep({
  deps,
  home,
  jobs,
  results,
  store,
  numbersOnly,
}: {
  readonly deps: Pick<RefreshDeps, "logger" | "storeIngest">;
  readonly home: string;
  readonly jobs: readonly SourceIngestJob[];
  readonly results: readonly RefreshResult[];
  readonly store: boolean;
  readonly numbersOnly: boolean;
}): Promise<RefreshLegFailures> {
  if (!store) {
    return { failures: [] };
  }
  if (deps.storeIngest === undefined) {
    const reason = "this run has no store seam wired, so nothing can reach the store";
    deps.logger.error({ msg: `--store: ${reason}` });
    return { failures: [{ reason, source: null }] };
  }
  const sources = storeLegSources({ jobs, results });
  return runStoreLeg({ home, ingest: deps.storeIngest, numbersOnly, sink: deps.logger, sources });
}

/**
 * Replay every named source's window files into the store, printing one line each, and say what did not
 * reach the store.
 *
 * The failures are RETURNED as well as printed because the printed line is followed by every hydration lane's
 * progress, and a scheduled firing keeps only the tail of stderr — `./failureClosingLine.ts` restates them last.
 *
 * @param sources the sources to replay, from {@link storeLegSources}
 * @param home the Slopweaver home the store selection is read under
 * @param ingest the seam that replays one source's windows
 * @param sink where the per-source lines go
 * @param numbersOnly whether output is a paste-safe capture, which prints each failed source but withholds its reason
 * @returns every failure in replay order; none when every source reached the store or had nothing to replay
 */
export async function runStoreLeg({
  sources,
  home,
  ingest,
  sink,
  numbersOnly,
}: {
  readonly sources: readonly CorpusSource[];
  readonly home: string;
  readonly ingest: StoreIngestSource;
  readonly sink: RefreshDeps["logger"];
  readonly numbersOnly: boolean;
}): Promise<RefreshLegFailures> {
  const failures: RefreshLegFailure[] = [];
  for (const source of sources) {
    // A replay that throws (an unlistable bronze directory, a store that fails to close) is a failure like any other,
    // so it reaches the closing line instead of escaping it.
    const replayed = await safeFsAsync({ execute: () => ingest({ home, source }), operation: "storeIngest" });
    const outcome: Result<StoreLegOutcome> = replayed.isErr() ? err([replayed.error.message]) : replayed.value;
    const verdict = storeLegVerdict({ numbersOnly, outcome, source });
    failures.push(...verdict.failures);
    for (const line of verdict.lines) {
      emitSummaryLine({ level: line.level, sink, text: line.text });
    }
  }
  return { failures };
}

/**
 * What one source's replay result means for the leg: the failures it adds and the lines it prints. Pure.
 *
 * @param source the source that was replayed
 * @param outcome the seam's result, a thrown replay already folded into an Err
 * @param numbersOnly whether each failure's printed reason is withheld
 * @returns the failures in reason order, and the lines in print order
 */
function storeLegVerdict({
  source,
  outcome,
  numbersOnly,
}: {
  readonly source: CorpusSource;
  readonly outcome: Result<StoreLegOutcome>;
  readonly numbersOnly: boolean;
}): { readonly failures: readonly RefreshLegFailure[]; readonly lines: readonly RefreshSummaryLine[] } {
  if (outcome.isErr()) {
    // A failure with no words is still a failure: a list holding no reason would otherwise pass the leg. `filter`
    // skips a sparse array's holes as well as a blank string, so every Err reaches `failures`.
    const stated = outcome.error.filter((reason) => reason.trim().length > 0);
    const reasons = stated.length === 0 ? [UNSTATED_STORE_REASON] : stated;
    return {
      failures: reasons.map((reason) => ({ reason, source })),
      lines: reasons.map((reason) => ({
        level: "error",
        text: `--store: ${source}: ${numbersOnly ? WITHHELD : reason}`,
      })),
    };
  }
  // A full-replay source is one whose receipt is written on this leg's verdict, so a row the store refused is a
  // record that never arrived — the leg fails and the receipt is withheld, rather than landing over a gap.
  // A withheld full-replay source fails for the same reason: its receipt would claim rows the leg never read.
  const refusedWhole =
    (outcome.value.kind === "ingested" && outcome.value.refused > 0 && FULL_REPLAY_SOURCES.has(source)) ||
    (outcome.value.kind === "withheld" && FULL_REPLAY_SOURCES.has(source));
  const line = storeLegLine({ outcome: outcome.value, source });
  if (refusedWhole) {
    return {
      failures: [{ reason: storeLegSaid({ outcome: outcome.value }), source }],
      lines: [{ level: "error", text: line }],
    };
  }
  return { failures: [], lines: [{ level: "out", text: line }] };
}

/**
 * The one line a source's replay prints.
 *
 * The omission is stated on EVERY ingested line, including a zero-row one, because it is the boundary of
 * the claim rather than a detail: "0 row(s) stored" over a scope that skipped several gigabytes means something very
 * different from the same words over a scope that read everything.
 *
 * @param source the source that was replayed
 * @param outcome what the seam did with it
 * @returns the line
 */
export function storeLegLine({
  source,
  outcome,
}: {
  readonly source: CorpusSource;
  readonly outcome: StoreLegOutcome;
}): string {
  return `--store: ${source}: ${storeLegSaid({ outcome })}`;
}

/** What {@link storeLegLine} says after its `--store: <source>: ` prefix, which a failure carries as its reason. */
function storeLegSaid({ outcome }: { readonly outcome: StoreLegOutcome }): string {
  if (outcome.kind === "absent") {
    return "no bronze window file to replay";
  }
  if (outcome.kind === "withheld") {
    return "not replayed — its bronze is no-access on the owner's protect list (`slopweaver protect list`)";
  }
  const omitted =
    outcome.omittedFiles > 0 ? ` · compact.jsonl not replayed (${String(outcome.omittedBytes)} bytes)` : "";
  return (
    `${String(outcome.stored)} row(s) stored from ${String(outcome.linesRead)} ` +
    `line(s) across ${String(outcome.files)} window file(s)` +
    (outcome.refused > 0 ? ` · ${String(outcome.refused)} refused` : "") +
    omitted
  );
}

/**
 * The production seam: open the selected store, replay the source's bronze window files into it, close.
 *
 * The owner's protect list is read first: a source reaching a `no-access` path is `withheld` before anything
 * is listed or the store is opened, and a protect list that cannot be read fails the leg.
 *
 * A source with no window file at all is `absent` rather than a failure — nothing has ever been written
 * for it. An unselected, unreachable or stale store is a failure, in the store's own words, because a
 * `--store` that quietly did nothing is the shape this leg replaces.
 *
 * @param home the Slopweaver home the store selection is read under
 * @param source the source whose window files to replay
 * @param scope `windows` (the leg's own default bar {@link FULL_REPLAY_SOURCES}) or `full`, which replays the
 *   canonical `compact.jsonl` too — what `gmail clear-meeting-notes` takes when a transcript bronze proves is
 *   missing from the store
 * @returns what happened, or why the source could not reach the store
 */
export async function productionStoreIngest({
  home,
  source,
  scope = storeLegScope({ source }),
}: {
  home: string;
  source: CorpusSource;
  scope?: BronzeScanScope;
}): Promise<Result<StoreLegOutcome>> {
  const protection = ownerProtectionFor({ home });
  if (protection.isErr()) {
    return err([protection.error.message]);
  }
  const listed = listProtectedBronzeFiles({ entries: protection.value, home, source });
  if (listed.isErr()) {
    if (listed.error.code === "BRONZE_PROTECTED") {
      return ok({ kind: "withheld" });
    }
    return err([listed.error.message]);
  }
  const plan = planBronzeWindows({ files: listed.value, home, scope, source });
  if (plan.read.length === 0) {
    return ok({ kind: "absent" });
  }
  const opened = await connectStore({ home, max: 4 });
  if (opened.isErr()) {
    return err([opened.error.message]);
  }
  try {
    const report = await ingestSource({
      client: opened.value,
      files: plan.read,
      home,
      limit: STORE_LEG_SLICE,
      protection: protection.value,
      source,
      wholeFile: true,
    });
    if (report.isErr()) {
      return err([report.error.message]);
    }
    return ok({
      files: report.value.files.length,
      kind: "ingested",
      linesRead: report.value.linesRead,
      omittedBytes: bronzeBytes({ files: plan.omitted }),
      omittedFiles: plan.omitted.length,
      refused: report.value.refusalsCounted,
      stored: report.value.recordsStored,
    });
  } finally {
    await opened.value.close();
  }
}

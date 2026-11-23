/**
 * The PURE half of `slopweaver store rehearse` — the parser, the rendered report, the record a run leaves, and
 * the knowledge row that files its proof. No process, socket, clock or filesystem.
 *
 * The flags choose the THROWAWAY, never the live store: the live coordinates come from the store selection and
 * the running container, and every flag here is checked against them by `rehearsalTarget` before anything
 * runs. A flag naming the live database, port or container is therefore not an invocation that does something
 * dangerous — it is one refused with exit 2 before a byte is downloaded.
 */
import { err, ok, type Result } from "#lib/result.js";

import { backupErrorLines } from "../../../store/backup/errors.js";
import { validateDatabaseName } from "../../../store/backup/plan.js";
import type { RehearsalRecord } from "../../../store/backup/rehearsalRecord.js";
import type { RehearsalReport } from "../../../store/backup/rehearsalReport.js";
import {
  DEFAULT_REHEARSAL_CONTAINER,
  DEFAULT_REHEARSAL_DATABASE,
  DEFAULT_REHEARSAL_PORT,
  type RehearsalRequest,
} from "../../../store/backup/rehearsalTarget.js";
import { parseFlags } from "../../parseFlags.js";

import { type Parsed, StoreCommandErrors, type StoreCommandInvalidFlagValueError } from "./errors.js";

/** The flags `store rehearse` accepts. */
const REHEARSE_FLAGS = {
  boolean: ["json", "keep", "no-record"],
  string: ["container", "destination", "from", "home", "into", "port", "sample-size"],
} as const;

/** The flags `store rehearse` advertises, for the help-truth ratchet. */
export const STORE_REHEARSE_FLAG_NAMES: readonly string[] = [
  ...REHEARSE_FLAGS.string.map((name) => `--${name}`),
  ...REHEARSE_FLAGS.boolean.map((name) => `--${name}`),
];

/** Rows per table in the byte-equal sample unless the caller moves it. */
const DEFAULT_SAMPLE_SIZE = 5;

/** A Docker container name: what `docker run --name` accepts. */
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

/** A backup prefix as the destination spells one: `<project>/<instant>/`. */
const BACKUP_PREFIX = /^[a-z0-9_-]+\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\/?$/;

/** What a `store rehearse` invocation asked for. */
export interface StoreRehearseArgs {
  readonly home?: string;
  readonly json: boolean;
  readonly requested: RehearsalRequest;
  /** A `<project>/<instant>/` prefix to rehearse instead of the newest, or `null`. */
  readonly from: string | null;
  /** The destination directory to read instead of the selected one, or `null`. */
  readonly destination: string | null;
  readonly sampleSize: number;
  /** Leave the throwaway running afterwards, for a hand look. */
  readonly keep: boolean;
  /** Skip filing the knowledge row — the run's one write to the live store. */
  readonly record: boolean;
}

/**
 * A whole number flag within bounds, or why it is not one.
 *
 * @param raw what the caller typed, absent when the flag was not passed
 * @param flag its name, for the refusal
 * @param fallback the value when it was not passed
 * @param min the least it may be
 * @param max the most it may be
 * @returns the number, or the refusal line
 */
function wholeNumber({
  raw,
  flag,
  fallback,
  min,
  max,
}: {
  raw: string | boolean | undefined;
  flag: string;
  fallback: number;
  min: number;
  max: number;
}): Result<number, StoreCommandInvalidFlagValueError> {
  if (typeof raw !== "string") {
    return ok(fallback);
  }
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < min || value > max) {
    return err(StoreCommandErrors.rangeInvalid({ flag, got: raw, max, min }));
  }
  return ok(value);
}

/**
 * Every reason a `store rehearse` invocation's parsed values are refused, in flag order.
 *
 * @param fromRaw the `--from` value as parsed, which must be a `<project>/<instant>/` prefix when given
 * @param container the container name, which must be one docker accepts
 * @returns the refusal lines, empty when every value stands
 */
function refusalLines({
  port,
  sampleSize,
  database,
  container,
  fromRaw,
}: {
  port: Result<number, StoreCommandInvalidFlagValueError>;
  sampleSize: Result<number, StoreCommandInvalidFlagValueError>;
  database: ReturnType<typeof validateDatabaseName>;
  container: string;
  fromRaw: unknown;
}): string[] {
  const badFrom = typeof fromRaw === "string" && !BACKUP_PREFIX.test(fromRaw);
  return [
    ...(port.isErr() ? [port.error.message] : []),
    ...(sampleSize.isErr() ? [sampleSize.error.message] : []),
    ...(database.isErr() ? backupErrorLines({ error: database.error }) : []),
    ...(CONTAINER_NAME.test(container) ? [] : [StoreCommandErrors.containerNameInvalid({ got: container }).message]),
    ...(badFrom ? [StoreCommandErrors.fromPrefixInvalid({ got: fromRaw }).message] : []),
  ];
}

/**
 * Parse a `store rehearse` invocation.
 *
 * @param rest the argv tail
 * @returns the arguments, or every reason the invocation was refused
 */
export function parseStoreRehearseArgs({ rest }: { rest: readonly string[] }): Parsed<StoreRehearseArgs> {
  const parsed = parseFlags({ args: rest, spec: REHEARSE_FLAGS });
  if (parsed.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const values = parsed.value.values;
  const port = wholeNumber({
    fallback: DEFAULT_REHEARSAL_PORT,
    flag: "port",
    max: 65535,
    min: 1024,
    raw: values["port"],
  });
  const sampleSize = wholeNumber({
    fallback: DEFAULT_SAMPLE_SIZE,
    flag: "sample-size",
    max: 1000,
    min: 1,
    raw: values["sample-size"],
  });
  const intoRaw = values["into"];
  const database = validateDatabaseName({ name: typeof intoRaw === "string" ? intoRaw : DEFAULT_REHEARSAL_DATABASE });
  const containerRaw = values["container"];
  const container = typeof containerRaw === "string" ? containerRaw : DEFAULT_REHEARSAL_CONTAINER;
  const fromRaw = values["from"];
  const errors = refusalLines({ container, database, fromRaw, port, sampleSize });
  if (errors.length > 0 || port.isErr() || sampleSize.isErr() || database.isErr()) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: errors }));
  }
  const home = values["home"];
  const destination = values["destination"];
  return ok({
    destination: typeof destination === "string" ? destination : null,
    from: typeof fromRaw === "string" ? fromRaw : null,
    json: values["json"] === true,
    keep: values["keep"] === true,
    record: values["no-record"] !== true,
    requested: { container, database: database.value, port: port.value },
    sampleSize: sampleSize.value,
    ...(typeof home === "string" ? { home } : {}),
  });
}

/**
 * How many of a list carry each value, as `a 3 · b 1`, in a fixed order.
 *
 * @param values the values
 * @param order every value that may appear, in the order to print them
 * @returns the tally, zero counts omitted
 */
function tally({ values, order }: { values: readonly string[]; order: readonly string[] }): string {
  return order
    .map((name) => ({ count: values.filter((value) => value === name).length, name }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.name} ${String(entry.count)}`)
    .join(" · ");
}

/**
 * The storage leg in words, with its entry count when the tar listed.
 *
 * @param storage what listing `storage.tar` found
 * @returns the phrase the report and the knowledge row both carry
 */
function storageLeg({ storage }: { storage: RehearsalReport["legs"]["storage"] }): string {
  if (storage.status === "listed") {
    return `storage.tar ${String(storage.entries)} entries`;
  }
  return `storage.tar does NOT list: ${storage.why}`;
}

/**
 * Total the counts one side has, skipping a table that side lacks.
 *
 * @param values one count per table, `null` where the side has no such table
 * @returns their sum
 */
function sumPresent({ values }: { values: readonly (number | null)[] }): number {
  let sum = 0;
  for (const value of values) {
    if (value !== null) {
      sum += value;
    }
  }
  return sum;
}

/**
 * The report as a reader meets it: the verdict first, then what was rehearsed, then each check's numbers.
 *
 * @param report what the rehearsal found
 * @returns the lines to print
 */
export function rehearsalLines({ report }: { report: RehearsalReport }): readonly string[] {
  const { source, live, throwaway, schema, counts, sample, legs, verdict } = report;
  const rowsLive = sumPresent({ values: counts.map((row) => row.live) });
  const rowsCopy = sumPresent({ values: counts.map((row) => row.copy) });
  const stopped = throwaway.kept
    ? `left running (--keep) as ${throwaway.container} on 127.0.0.1:${String(throwaway.port)}`
    : "stopped";
  return [
    verdict.passed ? "rehearsal PASSED" : `rehearsal FAILED — ${String(verdict.failures.length)} reason(s)`,
    ...verdict.failures.map((line) => `  ✗ ${line}`),
    `backup   ${source.destination}/${source.prefix} · taken ${source.createdAtIso} · dump ${String(source.dumpBytes)} bytes`,
    `live     ${live.database} on :${String(live.port)} in ${live.container} — read only, never written`,
    `copy     ${throwaway.database} on 127.0.0.1:${String(throwaway.port)} in ${throwaway.container} ` +
      `(${throwaway.id.slice(0, 12)}, ${String(throwaway.mounts)} mounts, image ${live.imageId.slice(0, 19)}) — ${stopped}`,
    `restore  ${report.restoreMode} in ${String(report.restoreSeconds)}s`,
    `schema   ${schema.identical ? "identical" : "DIFFERS"} — ${String(schema.liveLines)} catalog lines live, ${String(schema.copyLines)} copy`,
    ...schema.onlyLive.slice(0, 10).map((line) => `  only live: ${line}`),
    ...schema.onlyCopy.slice(0, 10).map((line) => `  only copy: ${line}`),
    `counts   ${String(counts.length)} tables · ${String(rowsCopy)} rows in the copy, ${String(rowsLive)} live now · ` +
      tally({ order: ["equal", "reconciled", "drifted", "missing"], values: counts.map((row) => row.verdict) }),
    ...counts
      .filter((row) => row.verdict === "drifted" || row.verdict === "missing")
      .map((row) => `  ${row.verdict}: ${row.table} copy ${String(row.copy)} live ${String(row.live)}`),
    `sample   ${String(sample.length)} rows from ${String(new Set(sample.map((row) => row.table)).size)} tables · ` +
      tally({
        order: ["equal", "changed-after-backup", "untracked-change", "missing-on-live", "different"],
        values: sample.map((row) => row.verdict),
      }) +
      ` · ${String(report.unsampled.length)} tables unsampled`,
    ...sample.filter((row) => row.verdict !== "equal").map((row) => `  ${row.verdict}: ${row.table} ${row.key}`),
    `storage  ${storageLeg({ storage: legs.storage })}`,
    `files    ${String(legs.files.named)} named in files.json · ${String(legs.files.missing.length)} missing from the destination`,
    `vault    ${vaultLeg({ vault: report.vault })}`,
  ];
}

/**
 * The Vault leg in one phrase.
 *
 * @param vault the Vault leg's reading
 * @returns what the throwaway's Vault holds against what the backup recorded, or why it does not
 */
function vaultLeg({ vault }: { vault: RehearsalReport["vault"] }): string {
  if (vault.status === "absent") {
    return "NOT in this backup";
  }
  if (vault.status === "failed") {
    return `did not restore: ${vault.why}`;
  }
  return `${String(vault.restored)}/${String(vault.expected)} secrets restored and openable in the copy`;
}

/**
 * The record a finished rehearsal leaves for the monitor.
 *
 * @param report what the rehearsal found
 * @returns the record
 */
export function passedOrFailedRecord({ report }: { report: RehearsalReport }): RehearsalRecord {
  return {
    atIso: report.finishedAtIso,
    failures: report.verdict.failures,
    prefix: report.source.prefix,
    status: report.verdict.passed ? "passed" : "failed",
  };
}

/** The text of the knowledge row a finished rehearsal files. */
export interface RehearsalLesson {
  readonly claim: string;
  readonly evidence: string;
  readonly verdict: "confirmed" | "refuted";
}

/**
 * The knowledge row's words: the claim a rehearsal tests, and the numbers that settled it.
 *
 * @param report what the rehearsal found
 * @returns the claim, the evidence and the verdict
 */
export function rehearsalLesson({ report }: { report: RehearsalReport }): RehearsalLesson {
  const { source, counts, sample, schema, legs, verdict } = report;
  const equalRows = sample.filter((row) => row.verdict === "equal").length;
  const evidence = [
    `${source.destination}/${source.prefix} (dump sha256 ${source.dumpSha256.slice(0, 16)}) restored ${report.restoreMode} ` +
      `in ${String(report.restoreSeconds)}s into a throwaway container with no mounts`,
    `schema ${schema.identical ? "identical" : "differs"} (${String(schema.liveLines)}/${String(schema.copyLines)} catalog lines)`,
    `${String(counts.length)} tables counted: ` +
      tally({ order: ["equal", "reconciled", "drifted", "missing"], values: counts.map((row) => row.verdict) }),
    `${String(equalRows)}/${String(sample.length)} sampled rows byte-equal`,
    storageLeg({ storage: legs.storage }),
    `${String(legs.files.missing.length)}/${String(legs.files.named)} files-leg objects missing`,
    `vault ${vaultLeg({ vault: report.vault })}`,
    ...verdict.failures.map((line) => `FAILED: ${line}`),
  ].join("; ");
  return {
    claim: `The newest store backup (${source.prefix}) restores into a throwaway Postgres and matches the live store`,
    evidence: evidence.slice(0, 1600),
    verdict: verdict.passed ? "confirmed" : "refuted",
  };
}

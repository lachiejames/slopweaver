/**
 * Where each run's snapshot is kept, so the next one can say what moved.
 * `$SLOPWEAVER_HOME/ledgers/session-start/runs.jsonl`, append-only, one line per run.
 *
 * A sibling of `lock-in.jsonl` and a different kind of thing: the lock-in ledger records what the OWNER said, and
 * this records what the LIST said. Keeping them apart matters because they answer different questions and
 * decay differently — a resolution of the owner's stays interesting for as long as the item has not moved, while a
 * snapshot is interesting only until the next one replaces it.
 *
 * Append-only rather than one overwritten file, for the reason every ledger here is: a run that dies
 * mid-write must not destroy the previous run's snapshot, and a truncated final line is then the normal
 * failure rather than a lost baseline.
 *
 * Same pure-line / effectful-append split as the rest: {@link snapshotLine} is pure, {@link recordRun} is
 * the thin append, and nothing here reads a clock.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { appendLines } from "../lib/appendSeparator.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { lockInLedgerDir } from "./lockIn.js";
import type { RunSnapshot, SnapshotItem } from "./reconcile.js";

/**
 * Render one snapshot as its JSONL line. Pure and deterministic — keys are emitted in a fixed order so two
 * runs writing the same snapshot produce byte-identical lines.
 *
 * @param snapshot the run to record
 * @returns the JSON line, with no trailing newline
 */
export function snapshotLine({ snapshot }: { snapshot: RunSnapshot }): string {
  return JSON.stringify({
    atIso: snapshot.atIso,
    items: snapshot.items.map((item) => ({
      closing: item.closing,
      identity: item.identity,
      whenIso: item.whenIso,
      ...(item.state === undefined ? {} : { state: item.state }),
    })),
    schemaVersion: 1,
  });
}

/** Decode one recorded item, or `undefined` when this version cannot read it. */
function decodeItem({ value }: { value: unknown }): SnapshotItem | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { identity, whenIso, closing, state } = value;
  if (typeof identity !== "string" || typeof whenIso !== "string" || typeof closing !== "boolean") {
    return undefined;
  }
  return {
    closing,
    identity,
    whenIso,
    ...(typeof state === "string" ? { state } : {}),
  };
}

/** Decode one snapshot line, or `undefined` when this version cannot read it. */
function decodeSnapshot({ line }: { line: string }): RunSnapshot | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed["atIso"] !== "string" || !Array.isArray(parsed["items"])) {
    return undefined;
  }
  const items = parsed["items"].flatMap((value) => {
    const item = decodeItem({ value });
    return item === undefined ? [] : [item];
  });
  return { atIso: parsed["atIso"], items };
}

/**
 * Parse the store into snapshots, skipping what it cannot read.
 *
 * A skipped line loses a baseline, which makes the next diff report everything as `new`. That is loud and
 * harmless; the alternative — refusing the whole file — would lose every baseline at once.
 *
 * @param text the raw `runs.jsonl` contents
 * @returns the snapshots that decoded, in file order
 */
export function parseSnapshots({ text }: { text: string }): readonly RunSnapshot[] {
  return text.split("\n").flatMap((line) => {
    if (line.trim().length === 0) {
      return [];
    }
    const snapshot = decodeSnapshot({ line });
    return snapshot === undefined ? [] : [snapshot];
  });
}

/**
 * The most recent snapshot, which is the only one a diff needs.
 *
 * File order is append order, so "most recent" is the last line rather than the newest `atIso` — a run given
 * an explicit `--now` in the past must not become the baseline for runs that already happened after it.
 *
 * @param snapshots every snapshot in the store, in file order
 * @returns the last one, or undefined when the store is empty
 */
export function latestSnapshot({ snapshots }: { snapshots: readonly RunSnapshot[] }): RunSnapshot | undefined {
  return snapshots.at(-1);
}

/**
 * The store's own path.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 *
 * @param home the state home
 * @returns the absolute path to `runs.jsonl`
 */
export function runStorePath({ home }: { home?: string } = {}): string {
  return join(lockInLedgerDir(home !== undefined ? { home } : {}), "runs.jsonl");
}

/**
 * Read the store's raw text.
 *
 * An absent store is the empty string rather than an error, so a first run reads as "no baseline yet"
 * instead of as a broken home.
 *
 * @param home the state home
 * @returns the file's contents, or the empty string when it does not exist
 */
export function readRunStore({ home }: { home?: string } = {}): string {
  try {
    return readFileSync(runStorePath(home !== undefined ? { home } : {}), "utf8");
  } catch {
    return "";
  }
}

/**
 * Append one run's snapshot.
 *
 * @param snapshot what this run showed
 * @param home the state home
 * @returns the path written, or the reason the append failed
 */
export function recordRun({ snapshot, home }: { snapshot: RunSnapshot; home?: string }): Result<string> {
  const dir = lockInLedgerDir(home !== undefined ? { home } : {});
  const path = runStorePath(home !== undefined ? { home } : {});
  const written = safeFs({
    execute: (): string => {
      mkdirSync(dir, { recursive: true });
      appendLines({ path, text: `${snapshotLine({ snapshot })}\n` });
      return path;
    },
    operation: "recordRun",
    path,
  });
  return written.isOk() ? ok(written.value) : err([written.error.message]);
}

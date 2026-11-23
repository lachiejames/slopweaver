/*
 * In the src lane, not the site one, because the reader returns a neverthrow Result through `#lib/` imports the site
 * build cannot resolve. The console writes the console sync failure ledger itself (`site/lib/consoleSyncFailureAppend.ts`)
 * and the monitor reads it (`src/live/consoleSyncFailureStore.ts`); this binds the two, so a row the console writes is
 * one the monitor sweep can read, at the path it reads, owner-only. The site module is imported at run time, by
 * address, because `src/`'s `rootDir` may not contain a `site/` file (TS6059).
 */

import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import {
  type ConsoleSyncFailure,
  readConsoleSyncAppendFailures,
  readConsoleSyncFailures,
} from "../../../live/consoleSyncFailureStore.js";
import { evaluateConsoleSyncFailed } from "../../../monitor/consoleSyncFailed.js";
import type { FiringReading, MonitorReading } from "../../../monitor/types.js";
import { stateHomePaths } from "../../../stateHome.js";

const CONSOLE_HOME = new URL("../../../../site/lib/consoleHome.ts", import.meta.url).href;
const CONSOLE_SYNC_FAILURE_APPEND = new URL("../../../../site/lib/consoleSyncFailureAppend.ts", import.meta.url).href;

/** Where the site says a failure landed, as far as this test reads it. */
type SiteRecord =
  | { readonly kind: "recorded"; readonly path: string }
  | { readonly kind: "fallback"; readonly path: string; readonly appendError: string; readonly notice: string }
  | { readonly kind: "lost"; readonly appendError: string; readonly fallbackError: string; readonly notice: string };

/** The site's two functions, as far as this test calls them. */
interface SiteLedger {
  readonly consoleHomePaths: (args: { home: string }) => {
    consoleSyncFailures: string;
    consoleSyncFailureAppendFailures: string;
  };
  readonly appendConsoleSyncFailure: (args: { failure: ConsoleSyncFailure; home: string }) => SiteRecord;
}

/**
 * The path a failure was recorded at, failing the test when it was not the ledger's.
 *
 * @param record what the site's append answered
 * @returns the ledger path
 */
function recordedPath({ record }: { record: SiteRecord }): string {
  expect(record.kind).toBe("recorded");
  return (record as Extract<SiteRecord, { kind: "recorded" }>).path;
}

/**
 * Whether a module exposes the named function.
 *
 * @param module what the run-time import returned
 * @param name the export it must carry
 * @returns true when it carries that function
 */
function exportsFunction({ module, name }: { module: unknown; name: string }): boolean {
  return typeof module === "object" && module !== null && typeof Reflect.get(module, name) === "function";
}

/**
 * The site's path owner and writer, loaded by address.
 *
 * @returns both functions
 */
async function siteLedger(): Promise<SiteLedger> {
  const home: unknown = await import(CONSOLE_HOME);
  const append: unknown = await import(CONSOLE_SYNC_FAILURE_APPEND);
  expect(exportsFunction({ module: home, name: "consoleHomePaths" })).toBe(true);
  expect(exportsFunction({ module: append, name: "appendConsoleSyncFailure" })).toBe(true);
  return {
    appendConsoleSyncFailure: (append as Pick<SiteLedger, "appendConsoleSyncFailure">).appendConsoleSyncFailure,
    consoleHomePaths: (home as Pick<SiteLedger, "consoleHomePaths">).consoleHomePaths,
  };
}

/**
 * The monitor's reading of a home, read the way the sweep reads it: both ledgers, judged at one instant.
 *
 * @param home the throwaway state home
 * @param nowIso the instant the reading is judged at
 * @returns what the `console-sync-failed` monitor reads
 */
function readingAt({ home, nowIso }: { home: string; nowIso: string }): MonitorReading {
  return evaluateConsoleSyncFailed({
    appendFailures: readConsoleSyncAppendFailures({ home }),
    ledger: readConsoleSyncFailures({ home }),
    nowIso,
  });
}

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => rmSync(home, { force: true, recursive: true }));
});

/**
 * A throwaway state home, removed after each test.
 *
 * @returns its absolute path
 */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "console-sync-mirror-"));
  homes.push(home);
  return home;
}

const FAILURE: ConsoleSyncFailure = {
  failureId: "a0000016-0000-4000-8000-000000000017",
  slug: "landing",
  startedAtIso: "2026-11-12T09:58:00.000Z",
  title: "slopweaver github landing",
  tookMs: 1_200,
  why: "GitHub answered 502",
};

/**
 * The bytes one value takes as a JSON line, so an expected byte offset is computed rather than typed.
 *
 * @param value the row as written
 * @returns its line's length in bytes, newline included
 */
function lineBytes({ value }: { value: unknown }): number {
  return Buffer.byteLength(`${JSON.stringify(value)}\n`);
}

/** A header's token as the writer mints it: a lowercase UUID. */
const TOKEN_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * A file's generation computed independently of both modules: the SHA-256 of its first line.
 *
 * @param line the first line, without its newline
 * @returns the digest in lowercase hex
 */
function digestOf({ line }: { line: string }): string {
  return createHash("sha256").update(line).digest("hex");
}

/**
 * The header the writer put on a file's first line, failing the test unless it is one, with the generation it gives.
 *
 * @param path the file read
 * @param generation what the reader returned for the file
 * @returns the header's line length in bytes, newline included
 */
function headerBytes({ generation, path }: { generation: string | undefined; path: string }): number {
  const first = readFileSync(path, "utf8").split("\n")[0]!;
  const header: unknown = JSON.parse(first);
  expect(Object.keys(header as object)).toStrictEqual(["generation"]);
  expect(Reflect.get(header as object, "generation")).toMatch(TOKEN_SHAPE);
  expect(generation).toBe(digestOf({ line: first }));
  return Buffer.byteLength(`${first}\n`);
}

describe("the console's sync failure ledger matches the monitor's reader", () => {
  it("names the path the reader reads", async () => {
    const site = await siteLedger();
    const home = freshHome();
    expect(site.consoleHomePaths({ home }).consoleSyncFailures).toBe(
      stateHomePaths({ home }).live.consoleSyncFailuresJsonl,
    );
    expect(site.consoleHomePaths({ home }).consoleSyncFailures).toBe(join(home, "live", "console-sync-failures.jsonl"));
    expect(site.consoleHomePaths({ home }).consoleSyncFailureAppendFailures).toBe(
      stateHomePaths({ home }).consoleSyncFailureAppendFailuresJsonl,
    );
    expect(site.consoleHomePaths({ home }).consoleSyncFailureAppendFailures).toBe(
      join(home, "console-sync-failure-append-failures.jsonl"),
    );
  });

  it("writes rows the reader returns exactly, owner-only", async () => {
    const site = await siteLedger();
    const home = freshHome();
    const second: ConsoleSyncFailure = { ...FAILURE, failureId: "failure-2", slug: "currency", why: "timed out" };
    const path = recordedPath({ record: site.appendConsoleSyncFailure({ failure: FAILURE, home }) });
    site.appendConsoleSyncFailure({ failure: second, home });

    expect(path).toBe(stateHomePaths({ home }).live.consoleSyncFailuresJsonl);
    const first = { ...FAILURE, fallbackBytes: 0 };
    const read = unwrap(readConsoleSyncFailures({ home }));
    const header = headerBytes({ generation: read.generation, path });
    expect(read).toStrictEqual({
      byteOffsets: [header, header + lineBytes({ value: first })],
      damaged: 0,
      failures: [first, { ...second, fallbackBytes: 0 }],
      generation: read.generation,
      path,
    });
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("narrows a ledger an earlier writer left world-readable before appending to it", async () => {
    const site = await siteLedger();
    const home = freshHome();
    const path = stateHomePaths({ home }).live.consoleSyncFailuresJsonl;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "", { mode: 0o644 });
    chmodSync(path, 0o644);
    expect(statSync(path).mode & 0o777).toBe(0o644);

    site.appendConsoleSyncFailure({ failure: FAILURE, home });

    expect(statSync(path).mode & 0o777).toBe(0o600);
    // A file left empty is stamped like a new one, its header written with the first row.
    const read = unwrap(readConsoleSyncFailures({ home }));
    expect(read).toStrictEqual({
      byteOffsets: [headerBytes({ generation: read.generation, path })],
      damaged: 0,
      failures: [{ ...FAILURE, fallbackBytes: 0 }],
      generation: read.generation,
      path,
    });
  });

  it("keeps a ledger written before the header existed headerless, identified by its own first row", async () => {
    const site = await siteLedger();
    const home = freshHome();
    const path = stateHomePaths({ home }).live.consoleSyncFailuresJsonl;
    const legacy = { ...FAILURE, failureId: "legacy", fallbackBytes: 0 };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(legacy)}\n`);

    site.appendConsoleSyncFailure({ failure: FAILURE, home });

    expect(unwrap(readConsoleSyncFailures({ home }))).toStrictEqual({
      byteOffsets: [0, lineBytes({ value: legacy })],
      damaged: 0,
      failures: [legacy, { ...FAILURE, fallbackBytes: 0 }],
      generation: digestOf({ line: JSON.stringify(legacy) }),
      path,
    });
  });

  it("records the generation the reader computes for the other file, whatever its first line holds", async () => {
    const site = await siteLedger();
    const home = freshHome();
    const fallback = stateHomePaths({ home }).consoleSyncFailureAppendFailuresJsonl;
    // A first line longer than the bounded read and carrying no newline in it: both sides digest the same prefix.
    writeFileSync(fallback, `${"x".repeat(5000)}\n`);

    site.appendConsoleSyncFailure({ failure: FAILURE, home });

    const generation = unwrap(readConsoleSyncAppendFailures({ home })).generation;
    expect(generation).toBe(digestOf({ line: "x".repeat(4096) }));
    expect(unwrap(readConsoleSyncFailures({ home })).failures[0]!.fallbackGeneration).toBe(generation);
  });

  it("reads a header only as the first line, exactly, and counts every other header-like line as damage", () => {
    const home = freshHome();
    const path = stateHomePaths({ home }).live.consoleSyncFailuresJsonl;
    const generation = "0b6f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4";
    const lines = [
      { generation },
      { generation, more: 1 },
      { generation: generation.toUpperCase() },
      { generation: "not-a-uuid" },
      { generation },
    ];
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
    const extraKeys = freshHome();
    const extraPath = stateHomePaths({ home: extraKeys }).live.consoleSyncFailuresJsonl;
    mkdirSync(dirname(extraPath), { recursive: true });
    writeFileSync(extraPath, `${JSON.stringify({ generation, more: 1 })}\n`);

    expect(unwrap(readConsoleSyncFailures({ home }))).toStrictEqual({
      byteOffsets: [],
      damaged: 4,
      failures: [],
      generation: digestOf({ line: JSON.stringify({ generation }) }),
      path,
    });
    expect(unwrap(readConsoleSyncFailures({ home: extraKeys }))).toStrictEqual({
      byteOffsets: [],
      damaged: 1,
      failures: [],
      generation: digestOf({ line: JSON.stringify({ generation, more: 1 }) }),
      path: extraPath,
    });
  });
});

describe("no damage to the ledger keeps a failed run off a card", () => {
  const NOW = "2026-11-12T10:00:00.000Z";

  it("writes a run the wall clock timed below zero as zero, so the reader keeps it", async () => {
    const site = await siteLedger();
    const home = freshHome();
    site.appendConsoleSyncFailure({ failure: { ...FAILURE, tookMs: -250 }, home });

    const reading = readingAt({ home, nowIso: NOW });

    expect(reading.state).toBe("firing");
    expect((reading as FiringReading).subjects[0]!.key).toBe(FAILURE.failureId);
    expect(unwrap(readConsoleSyncFailures({ home })).failures[0]!.tookMs).toBe(0);
  });

  it("keeps the next row whole after a torn tail, and names the torn line on the card", async () => {
    const site = await siteLedger();
    const home = freshHome();
    const next: ConsoleSyncFailure = { ...FAILURE, failureId: "next", startedAtIso: "2026-11-12T09:59:00.000Z" };
    const path = recordedPath({ record: site.appendConsoleSyncFailure({ failure: FAILURE, home }) });
    const torn = '{"failureId":"torn","slug":"lan';
    appendFileSync(path, torn);
    site.appendConsoleSyncFailure({ failure: next, home });

    const reading = readingAt({ home, nowIso: NOW });

    const first = { ...FAILURE, fallbackBytes: 0 };
    const read = unwrap(readConsoleSyncFailures({ home }));
    const header = headerBytes({ generation: read.generation, path });
    expect(read).toStrictEqual({
      // The torn fragment and the newline the writer put after it are one damaged line before `next`.
      byteOffsets: [header, header + lineBytes({ value: first }) + Buffer.byteLength(torn) + 1],
      damaged: 1,
      failures: [first, { ...next, fallbackBytes: 0 }],
      generation: read.generation,
      path,
    });
    expect(reading.state).toBe("firing");
    expect((reading as FiringReading).subjects[0]!.key).toBe("next");
    expect((reading as FiringReading).subjects[0]!.details![0]).toBe(
      `1 line(s) in the console sync failure ledger at ${path} did not decode`,
    );
  });

  it("cards a fresh failure a month after an old damaged line", async () => {
    const site = await siteLedger();
    const home = freshHome();
    const path = stateHomePaths({ home }).live.consoleSyncFailuresJsonl;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not a row\n");
    const fresh: ConsoleSyncFailure = { ...FAILURE, failureId: "fresh", startedAtIso: "2026-12-12T09:59:00.000Z" };
    site.appendConsoleSyncFailure({ failure: fresh, home });

    const reading = readingAt({ home, nowIso: "2026-12-12T10:00:00.000Z" });

    expect(reading.state).toBe("firing");
    expect((reading as FiringReading).subjects[0]!.key).toBe("fresh");
  });
});

describe("a failure the ledger refuses reaches the monitor through the fallback", () => {
  const NOW = "2026-11-12T10:00:00.000Z";
  const LINE = "slopweaver github landing failed at 2026-11-12T09:58:00.000Z: GitHub answered 502";

  it("records to the fallback when the ledger path is a directory, and the card names the run", async () => {
    const site = await siteLedger();
    const home = freshHome();
    const ledger = stateHomePaths({ home }).live.consoleSyncFailuresJsonl;
    mkdirSync(ledger, { recursive: true });

    const record = site.appendConsoleSyncFailure({ failure: FAILURE, home });
    const reading = readingAt({ home, nowIso: NOW }) as FiringReading;

    expect(record.kind).toBe("fallback");
    const fallback = record as Extract<SiteRecord, { kind: "fallback" }>;
    expect(fallback.path).toBe(stateHomePaths({ home }).consoleSyncFailureAppendFailuresJsonl);
    expect(fallback.appendError).toContain("EISDIR");
    expect(fallback.notice).toBe(
      `the server's failure ledger refused this failure (${fallback.appendError}), so the fleet reads it from ${fallback.path} instead`,
    );
    // A ledger path that is a directory has no size or generation to record, so the row carries neither.
    const read = unwrap(readConsoleSyncAppendFailures({ home }));
    expect(read).toStrictEqual({
      byteOffsets: [headerBytes({ generation: read.generation, path: fallback.path })],
      damaged: 0,
      failures: [{ appendError: fallback.appendError, failure: FAILURE }],
      generation: read.generation,
      path: fallback.path,
    });
    expect(statSync(fallback.path).mode & 0o777).toBe(0o600);
    expect(reading.state).toBe("firing");
    expect(reading.blindSpot).toContain(`the console sync failure ledger at ${ledger} could not be read`);
    expect(reading.subjects[0]!.key).toBe(FAILURE.failureId);
    expect(reading.subjects[0]!.detailsInFull).toStrictEqual([
      `the console sync failure ledger refused 1 failure(s), read from its fallback instead; the latest refusal: ${fallback.appendError}`,
      LINE,
    ]);
  });

  it("records to the fallback when live/ cannot be written and no ledger exists, and the card names the run", async () => {
    const site = await siteLedger();
    const home = freshHome();
    const live = dirname(stateHomePaths({ home }).live.consoleSyncFailuresJsonl);
    mkdirSync(live, { recursive: true });
    chmodSync(live, 0o500);
    try {
      const record = site.appendConsoleSyncFailure({ failure: FAILURE, home });
      const reading = readingAt({ home, nowIso: NOW }) as FiringReading;

      expect(record.kind).toBe("fallback");
      expect((record as Extract<SiteRecord, { kind: "fallback" }>).appendError).toContain("EACCES");
      expect(unwrap(readConsoleSyncFailures({ home })).failures).toStrictEqual([]);
      // No ledger exists yet, so it held zero bytes when it refused the row.
      expect(unwrap(readConsoleSyncAppendFailures({ home })).failures).toStrictEqual([
        {
          appendError: (record as Extract<SiteRecord, { kind: "fallback" }>).appendError,
          failure: FAILURE,
          ledgerBytes: 0,
        },
      ]);
      expect(reading.state).toBe("firing");
      expect(reading.blindSpot).toBeUndefined();
      expect(reading.subjects[0]!.key).toBe(FAILURE.failureId);
      expect(reading.subjects[0]!.detailsInFull![1]).toBe(LINE);
    } finally {
      chmodSync(live, 0o700);
    }
  });

  it("keys the row written last across the two files whatever the clock said, by the sizes each recorded", async () => {
    const site = await siteLedger();
    const home = freshHome();
    const ledger = stateHomePaths({ home }).live.consoleSyncFailuresJsonl;
    mkdirSync(ledger, { recursive: true });
    site.appendConsoleSyncFailure({ failure: { ...FAILURE, failureId: "refused" }, home });
    rmSync(ledger, { recursive: true });
    // Written after the refusal, by a clock stepped back two minutes, then one tied to the millisecond.
    const steppedBack = { ...FAILURE, failureId: "stepped-back", startedAtIso: "2026-11-12T09:56:00.000Z" };
    const tied = { ...FAILURE, failureId: "tied" };

    site.appendConsoleSyncFailure({ failure: steppedBack, home });
    const afterStep = readingAt({ home, nowIso: NOW }) as FiringReading;
    rmSync(ledger);
    site.appendConsoleSyncFailure({ failure: tied, home });
    const afterTie = readingAt({ home, nowIso: NOW }) as FiringReading;

    expect(afterStep.subjects[0]!.key).toBe("stepped-back");
    expect(afterTie.subjects[0]!.key).toBe("tied");
  });

  it("keys a refused row written after the fallback was deleted by hand, whatever size a ledger row recorded for the old one", async () => {
    const site = await siteLedger();
    const home = freshHome();
    const ledger = stateHomePaths({ home }).live.consoleSyncFailuresJsonl;
    const fallback = stateHomePaths({ home }).consoleSyncFailureAppendFailuresJsonl;
    mkdirSync(ledger, { recursive: true });
    site.appendConsoleSyncFailure({ failure: { ...FAILURE, failureId: "old-refused" }, home });
    const oldGeneration = unwrap(readConsoleSyncAppendFailures({ home })).generation;
    headerBytes({ generation: oldGeneration, path: fallback });
    rmSync(ledger, { recursive: true });
    site.appendConsoleSyncFailure({ failure: { ...FAILURE, failureId: "kept" }, home });
    const kept = unwrap(readConsoleSyncFailures({ home }));
    rmSync(fallback);
    // The ledger stays readable but refuses the append, and the refused run's clock reads two minutes earlier.
    chmodSync(ledger, 0o400);
    try {
      const record = site.appendConsoleSyncFailure({
        failure: { ...FAILURE, failureId: "new-refused", startedAtIso: "2026-11-12T09:56:00.000Z" },
        home,
      });
      const refusedRows = unwrap(readConsoleSyncAppendFailures({ home }));
      const newGeneration = refusedRows.generation;
      const reading = readingAt({ home, nowIso: NOW }) as FiringReading;

      expect(record.kind).toBe("fallback");
      // The ledger row recorded the deleted fallback's size under that fallback's own generation...
      expect(kept.failures[0]!.fallbackGeneration).toBe(oldGeneration);
      expect(newGeneration).not.toBe(oldGeneration);
      // ...and the new fallback's only row starts below that size, so the size alone would order it first.
      expect(refusedRows.failures.map((row) => row.failure.failureId)).toStrictEqual(["new-refused"]);
      expect(refusedRows.byteOffsets).toStrictEqual([headerBytes({ generation: newGeneration, path: fallback })]);
      expect(refusedRows.byteOffsets[0]!).toBeLessThan(kept.failures[0]!.fallbackBytes!);
      expect(refusedRows.failures[0]!.ledgerGeneration).toBe(kept.generation);
      expect(refusedRows.failures[0]!.ledgerBytes).toBe(statSync(ledger).size);
      expect(reading.subjects[0]!.key).toBe("new-refused");
    } finally {
      chmodSync(ledger, 0o600);
    }
  });

  it("keys a refused row written after a headerless fallback was emptied and its first write tore", async () => {
    const site = await siteLedger();
    const home = freshHome();
    const ledger = stateHomePaths({ home }).live.consoleSyncFailuresJsonl;
    const fallback = stateHomePaths({ home }).consoleSyncFailureAppendFailuresJsonl;
    // A fallback written before the header existed: its first line is its first row.
    const legacy = {
      appendError: "EISDIR: illegal operation on a directory",
      failure: { ...FAILURE, failureId: "old" },
    };
    writeFileSync(fallback, `${JSON.stringify(legacy)}\n`);
    site.appendConsoleSyncFailure({ failure: { ...FAILURE, failureId: "kept" }, home });
    const kept = unwrap(readConsoleSyncFailures({ home }));
    // Emptied by hand, then a first write that tore after one byte, so the file gains no header.
    truncateSync(fallback, 0);
    appendFileSync(fallback, "{");
    chmodSync(ledger, 0o400);
    try {
      site.appendConsoleSyncFailure({
        failure: { ...FAILURE, failureId: "new-refused", startedAtIso: "2026-11-12T09:56:00.000Z" },
        home,
      });
      const refusedRows = unwrap(readConsoleSyncAppendFailures({ home }));
      const reading = readingAt({ home, nowIso: NOW }) as FiringReading;

      expect(kept.failures[0]!.fallbackGeneration).toBe(digestOf({ line: JSON.stringify(legacy) }));
      expect(refusedRows.generation).toBe(digestOf({ line: "{" }));
      // The torn byte and the newline the writer put after it come before the row, below the size the ledger recorded.
      expect(refusedRows.byteOffsets).toStrictEqual([2]);
      expect(refusedRows.damaged).toBe(1);
      expect(refusedRows.byteOffsets[0]!).toBeLessThan(kept.failures[0]!.fallbackBytes!);
      expect(reading.subjects[0]!.key).toBe("new-refused");
    } finally {
      chmodSync(ledger, 0o600);
    }
  });

  it("names both errors when the fallback refuses the row too", async () => {
    const site = await siteLedger();
    const home = freshHome();
    mkdirSync(stateHomePaths({ home }).live.consoleSyncFailuresJsonl, { recursive: true });
    mkdirSync(stateHomePaths({ home }).consoleSyncFailureAppendFailuresJsonl, { recursive: true });

    const record = site.appendConsoleSyncFailure({ failure: FAILURE, home });

    expect(record.kind).toBe("lost");
    const lost = record as Extract<SiteRecord, { kind: "lost" }>;
    expect(lost.appendError).toContain("EISDIR");
    expect(lost.fallbackError).toContain("EISDIR");
    expect(lost.notice).toBe(
      `the server could not record this failure for the fleet: its ledger refused it (${lost.appendError}) and so did the fallback (${lost.fallbackError})`,
    );
    expect(readingAt({ home, nowIso: NOW }).state).toBe("unmeasurable");
  });
});

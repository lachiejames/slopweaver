import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { lastReading, readingsInWindow, readReadingIndex, recordReading } from "../../../readings/store.js";
import { stateHomePaths } from "../../../stateHome.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  // Newest first: the permission the unreachable-index test narrows is widened again BEFORE its home is removed.
  cleanups
    .splice(0)
    .toReversed()
    .forEach((clean) => {
      clean();
    });
});

/** A throwaway state home this test may write into — never the ambient one. */
function home(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-readings-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  return root;
}

const DOCUMENT = '{"rows":[{"number":963}],"tally":{"total":1}}';

/** Record one landing reading into `home`, at `nowIso`, by `by`. */
function landing({ home: dir, nowIso, by = "tick-12" }: { home: string; nowIso: string; by?: string }) {
  return recordReading({
    by,
    document: DOCUMENT,
    home: dir,
    nowIso,
    observedAtIso: "2026-09-20T02:29:00.000Z",
    producer: "github landing",
  });
}

/** The cadence skip a not-due `github landing --if-due` prints — a cadence-skip document, verbatim. */
const SKIP =
  '{"cadenceMinutes":30,"kind":"skipped","lastReadAtIso":"2026-10-01T14:21:40.562Z","nextDueAtIso":"2026-10-01T14:51:40.562Z","selection":"acme/acme-admin,lachiejames/slopweaver@@me","why":"acme/acme-admin,lachiejames/slopweaver@@me was read 17 minute(s) ago and the cadence is 30 minute(s), so this tick makes no GitHub request"}';

/** Record that skip as a `github landing` reading, the way a tick before the fix did. */
function skipped({ home: dir, nowIso }: { home: string; nowIso: string }) {
  return recordReading({
    by: "tick-865",
    document: SKIP,
    home: dir,
    nowIso,
    observedAtIso: nowIso,
    producer: "github landing",
  });
}

describe("recordReading", () => {
  it("writes the document as the bytes it was given, then one index row naming it", () => {
    const dir = home();
    const receipt = unwrap(landing({ home: dir, nowIso: "2026-09-20T02:30:00.000Z" }));
    expect(receipt.documentPath).toBe(join(dir, "readings", "github-landing", "2026-09-20T023000.000Z.json"));
    expect(receipt.indexPath).toBe(join(dir, "readings", "index.jsonl"));
    expect(readFileSync(receipt.documentPath, "utf8")).toBe(DOCUMENT);
    expect(readFileSync(receipt.indexPath, "utf8")).toBe(`${JSON.stringify(receipt.record)}\n`);
    expect(receipt.record.bytes).toBe(DOCUMENT.length);
    expect(receipt.record.readingId).toBe("2026-09-20T02:30:00.000Z-github-landing");
  });

  it("keeps the document and the index owner-only", () => {
    const dir = home();
    const receipt = unwrap(landing({ home: dir, nowIso: "2026-09-20T02:30:00.000Z" }));
    expect(statSync(receipt.documentPath).mode & 0o777).toBe(0o600);
    expect(statSync(receipt.indexPath).mode & 0o777).toBe(0o600);
  });

  it("records a second append in the same millisecond one millisecond later, never over the first", () => {
    const dir = home();
    const first = unwrap(landing({ home: dir, nowIso: "2026-09-20T02:30:00.000Z" }));
    const second = unwrap(landing({ by: "sync-now", home: dir, nowIso: "2026-09-20T02:30:00.000Z" }));
    expect(second.record.recordedAtIso).toBe("2026-09-20T02:30:00.001Z");
    expect(second.record.readingId).toBe("2026-09-20T02:30:00.001Z-github-landing");
    expect(second.documentPath).not.toBe(first.documentPath);
    expect(readFileSync(first.documentPath, "utf8")).toBe(DOCUMENT);
    expect(unwrap(lastReading({ home: dir, producer: "github landing" })).record).toEqual(second.record);
  });

  it("refuses a document that is not JSON, writing nothing", () => {
    const dir = home();
    const failure = unwrapErr(
      recordReading({
        by: "tick-12",
        document: "{truncated",
        home: dir,
        nowIso: "2026-09-20T02:30:00.000Z",
        observedAtIso: "2026-09-20T02:29:00.000Z",
        producer: "github landing",
      }),
    );
    expect(failure.code).toBe("INVALID_FIELD");
    expect(failure.message).toContain("document must be JSON");
    expect(unwrap(readReadingIndex({ home: dir }))).toEqual([]);
  });

  it("refuses an empty `by` before writing anything", () => {
    const dir = home();
    const failure = unwrapErr(landing({ by: " ", home: dir, nowIso: "2026-09-20T02:30:00.000Z" }));
    expect(failure.code).toBe("INVALID_FIELD");
    expect(unwrap(readReadingIndex({ home: dir }))).toEqual([]);
  });
});

describe("readReadingIndex", () => {
  it("is empty for a home that has recorded nothing", () => {
    expect(unwrap(readReadingIndex({ home: home() }))).toEqual([]);
  });

  it("answers every row in append order", () => {
    const dir = home();
    const a = unwrap(landing({ home: dir, nowIso: "2026-09-20T02:30:00.000Z" })).record;
    const b = unwrap(landing({ by: "sync-now", home: dir, nowIso: "2026-09-20T02:31:00.000Z" })).record;
    expect(unwrap(readReadingIndex({ home: dir }))).toEqual([a, b]);
  });

  it("refuses a corrupt line rather than skipping it", () => {
    const dir = home();
    unwrap(landing({ home: dir, nowIso: "2026-09-20T02:30:00.000Z" }));
    writeFileSync(stateHomePaths({ home: dir }).readingsIndexJsonl, "{broken\n", { flag: "a" });
    const failure = unwrapErr(readReadingIndex({ home: dir }));
    expect(failure.code).toBe("CORRUPT_ROW");
    expect(failure.message).toBe("readings index line 2 is not a reading row — the line is not valid JSON");
  });

  it("refuses an index it cannot reach, never reporting it empty", () => {
    const dir = home();
    const paths = stateHomePaths({ home: dir });
    mkdirSync(paths.readings, { recursive: true });
    writeFileSync(paths.readingsIndexJsonl, "");
    chmodSync(paths.readings, 0o000);
    cleanups.push(() => {
      chmodSync(paths.readings, 0o700);
    });
    const failure = unwrapErr(readReadingIndex({ home: dir }));
    expect(failure.code).toBe("STORE_UNREADABLE");
  });
});

describe("lastReading", () => {
  it("answers the latest reading for the producer with its document parsed", () => {
    const dir = home();
    unwrap(landing({ home: dir, nowIso: "2026-09-20T02:30:00.000Z" }));
    const latest = unwrap(landing({ by: "sync-now", home: dir, nowIso: "2026-09-20T02:31:00.000Z" })).record;
    const read = unwrap(lastReading({ home: dir, producer: "github landing" }));
    expect(read.record).toEqual(latest);
    expect(read.document).toEqual({ rows: [{ number: 963 }], tally: { total: 1 } });
  });

  it("answers the reading in force at asOfIso, never one appended after it", () => {
    const dir = home();
    const earlier = unwrap(landing({ home: dir, nowIso: "2026-09-20T02:30:00.000Z" })).record;
    unwrap(landing({ by: "sync-now", home: dir, nowIso: "2026-09-20T02:31:00.000Z" }));
    const between = unwrap(lastReading({ asOfIso: "2026-09-20T02:30:30.000Z", home: dir, producer: "github landing" }));
    expect(between.record).toEqual(earlier);
    const before = unwrapErr(lastReading({ asOfIso: "2026-09-20T02:00:00Z", home: dir, producer: "github landing" }));
    expect(before.code).toBe("NO_READING");
    const bad = unwrapErr(lastReading({ asOfIso: "yesterday", home: dir, producer: "github landing" }));
    expect(bad.message).toBe('asOfIso is not an instant: "yesterday"');
  });

  it("passes over a row observed after observedByIso to the one before, and refuses a bound that is not an instant", () => {
    const dir = home();
    const earlier = unwrap(
      capacity({ home: dir, load1: 12, nowIso: "2026-10-09T14:40:00.000Z", observedAtIso: "2026-10-09T14:40:00.000Z" }),
    ).record;
    unwrap(
      capacity({ home: dir, load1: 30, nowIso: "2026-10-09T14:50:00.000Z", observedAtIso: "2026-10-09T15:30:00.000Z" }),
    );
    const bounds = { asOfIso: "2026-10-09T15:00:00.000Z", home: dir, producer: "machine capacity" };
    expect(unwrap(lastReading({ ...bounds, observedByIso: "2026-10-09T15:00:00.000Z" })).record).toEqual(earlier);
    expect(unwrap(lastReading(bounds)).document).toEqual({ load: { load1: 30 } });
    const bad = unwrapErr(lastReading({ ...bounds, observedByIso: "soon" }));
    expect(bad.message).toBe('observedByIso is not an instant: "soon"');
  });

  it("names the absence when the producer has no reading yet", () => {
    const failure = unwrapErr(lastReading({ home: home(), producer: "github landing" }));
    expect(failure.code).toBe("NO_READING");
    expect(failure.message).toBe(
      "the readings ledger holds no reading by `github landing` yet — record one with `slopweaver reading record`",
    );
  });

  it("passes over a newer cadence skip to the reading before it", () => {
    const dir = home();
    const real = unwrap(landing({ home: dir, nowIso: "2026-10-01T14:13:20.812Z" })).record;
    unwrap(skipped({ home: dir, nowIso: "2026-10-01T14:39:33.213Z" }));
    const read = unwrap(lastReading({ home: dir, producer: "github landing" }));
    expect(read.record).toEqual(real);
    expect(read.document).toEqual({ rows: [{ number: 963 }], tally: { total: 1 } });
  });

  it("names the absence when every reading the producer recorded is a skip", () => {
    const dir = home();
    unwrap(skipped({ home: dir, nowIso: "2026-10-01T14:39:33.213Z" }));
    const failure = unwrapErr(lastReading({ home: dir, producer: "github landing" }));
    expect(failure.code).toBe("NO_READING");
  });

  it("refuses a missing document under a skip rather than passing over it to an older reading", () => {
    const dir = home();
    unwrap(landing({ home: dir, nowIso: "2026-10-01T13:00:00.000Z" }));
    const gone = unwrap(landing({ home: dir, nowIso: "2026-10-01T14:13:20.812Z" }));
    unwrap(skipped({ home: dir, nowIso: "2026-10-01T14:39:33.213Z" }));
    rmSync(gone.documentPath);
    const failure = unwrapErr(lastReading({ home: dir, producer: "github landing" }));
    expect(failure.code).toBe("STORE_UNREADABLE");
    expect(failure.message).toContain(gone.documentPath);
  });

  it("refuses when the row's document file is gone, naming the path", () => {
    const dir = home();
    const receipt = unwrap(landing({ home: dir, nowIso: "2026-09-20T02:30:00.000Z" }));
    rmSync(receipt.documentPath);
    const failure = unwrapErr(lastReading({ home: dir, producer: "github landing" }));
    expect(failure.code).toBe("STORE_UNREADABLE");
    expect(failure.message).toContain(receipt.documentPath);
  });

  it("refuses a row whose document is a pipe instead of hanging on it", () => {
    const dir = home();
    const receipt = unwrap(landing({ home: dir, nowIso: "2026-09-20T02:30:00.000Z" }));
    rmSync(receipt.documentPath);
    execFileSync("mkfifo", [receipt.documentPath]);
    const failure = unwrapErr(lastReading({ home: dir, producer: "github landing" }));
    expect(failure.code).toBe("STORE_UNREADABLE");
    expect(failure.message).toContain(receipt.documentPath);
  });
});

/** Record one `machine capacity` reading observed at `observedAtIso` and recorded at `nowIso`. */
function capacity({
  home: dir,
  observedAtIso,
  nowIso,
  load1,
}: {
  home: string;
  observedAtIso: string;
  nowIso: string;
  load1: number;
}) {
  return recordReading({
    by: "tick-27",
    document: JSON.stringify({ load: { load1 } }),
    home: dir,
    nowIso,
    observedAtIso,
    producer: "machine capacity",
  });
}

/** The window every case below reads, unless it is the thing under test. */
const WINDOW = { fromIso: "2026-10-09T14:00:00.000Z", producer: "machine capacity", toIso: "2026-10-09T14:30:00.000Z" };

describe("readingsInWindow", () => {
  it("answers every reading observed inside the window, oldest first, edges included", () => {
    const dir = home();
    unwrap(
      capacity({ home: dir, load1: 30, nowIso: "2026-10-09T13:59:00.000Z", observedAtIso: "2026-10-09T13:59:00.000Z" }),
    );
    unwrap(
      capacity({
        home: dir,
        load1: 26.61,
        nowIso: "2026-10-09T14:30:00.000Z",
        observedAtIso: "2026-10-09T14:30:00.000Z",
      }),
    );
    unwrap(
      capacity({ home: dir, load1: 12, nowIso: "2026-10-09T14:00:01.000Z", observedAtIso: "2026-10-09T14:00:00.000Z" }),
    );
    unwrap(landing({ home: dir, nowIso: "2026-10-09T14:10:00.000Z" }));
    const series = unwrap(readingsInWindow({ ...WINDOW, home: dir }));
    expect(series.map((reading) => reading.document)).toEqual([{ load: { load1: 12 } }, { load: { load1: 26.61 } }]);
  });

  it("leaves out a reading recorded after the window's end, so a replay at that instant agrees", () => {
    const dir = home();
    unwrap(
      capacity({ home: dir, load1: 12, nowIso: "2026-10-09T14:00:01.000Z", observedAtIso: "2026-10-09T14:00:00.000Z" }),
    );
    unwrap(
      capacity({
        home: dir,
        load1: 26.61,
        nowIso: "2026-10-09T14:31:00.000Z",
        observedAtIso: "2026-10-09T14:29:00.000Z",
      }),
    );
    const series = unwrap(readingsInWindow({ ...WINDOW, home: dir }));
    expect(series.map((reading) => reading.document)).toEqual([{ load: { load1: 12 } }]);
  });

  it("answers an empty series for a window nothing landed in", () => {
    expect(unwrap(readingsInWindow({ ...WINDOW, home: home() }))).toEqual([]);
  });

  it("refuses an instant that is not one, and a window that ends before it starts", () => {
    const dir = home();
    const bad = unwrapErr(readingsInWindow({ ...WINDOW, fromIso: "an hour ago", home: dir }));
    expect(bad.message).toBe('fromIso is not an instant: "an hour ago"');
    const reversed = unwrapErr(
      readingsInWindow({
        ...WINDOW,
        fromIso: "2026-10-09T14:30:00.000Z",
        home: dir,
        toIso: "2026-10-09T14:00:00.000Z",
      }),
    );
    expect(reversed.message).toBe("toIso is before fromIso 2026-10-09T14:30:00.000Z");
  });

  it("refuses the whole series when a selected document is gone, rather than reading a quieter window", () => {
    const dir = home();
    const gone = unwrap(
      capacity({ home: dir, load1: 12, nowIso: "2026-10-09T14:00:01.000Z", observedAtIso: "2026-10-09T14:00:00.000Z" }),
    );
    rmSync(gone.documentPath);
    const failure = unwrapErr(readingsInWindow({ ...WINDOW, home: dir }));
    expect(failure.code).toBe("STORE_UNREADABLE");
    expect(failure.message).toContain(gone.documentPath);
  });
});

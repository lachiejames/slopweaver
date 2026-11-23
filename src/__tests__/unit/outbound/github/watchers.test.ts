/**
 * The watched-column fold: which sessions hold a `github checks --wait` on each pull request, judged from
 * the checks-read register alone, at a clock the test pins.
 */
import { describe, expect, it } from "vitest";

import type {
  ChecksRaisedRecord,
  ChecksReadRow,
  ChecksSeenRecord,
  ChecksWatchDoneRecord,
  ChecksWatchingRecord,
} from "../../../../outbound/github/checksReadLedger.js";
import { watchersOf } from "../../../../outbound/github/watchers.js";

const REPO = "lachiejames/slopweaver";

function watching({
  number = 973,
  headSha = "aaaaaaa",
  atIso = "2026-09-20T04:00:00.000Z",
  repo = REPO,
  session = "sess-a",
  mode = "wait",
  timeoutSeconds = 600,
}: Partial<ChecksWatchingRecord> = {}): ChecksWatchingRecord {
  return { atIso, headSha, kind: "watching", mode, number, repo, session, timeoutSeconds };
}

function watchDone({
  number = 973,
  headSha = "aaaaaaa",
  atIso = "2026-09-20T04:05:00.000Z",
  repo = REPO,
  session = "sess-a",
  outcome = "done",
}: Partial<ChecksWatchDoneRecord> = {}): ChecksWatchDoneRecord {
  return { atIso, headSha, kind: "watch-done", number, outcome, repo, session };
}

function read({
  number = 973,
  headSha = "aaaaaaa",
  atIso = "2026-09-20T04:00:00.000Z",
  repo = REPO,
  rollup = "PENDING",
}: Partial<ChecksSeenRecord> = {}): ChecksSeenRecord {
  return { atIso, headSha, kind: "read", number, repo, rollup };
}

function raise({
  number = 973,
  branch = "work",
  headSha = "aaaaaaa",
  atIso = "2026-09-20T03:59:00.000Z",
  repo = REPO,
}: Partial<ChecksRaisedRecord> = {}): ChecksRaisedRecord {
  return { atIso, branch, headSha, kind: "raised", number, repo };
}

/** Four minutes after the default watching row began — inside its ten-minute ceiling. */
const NOW = "2026-09-20T04:04:00.000Z";

describe("watchersOf", () => {
  it("answers nothing for an empty register", () => {
    expect(watchersOf({ nowIso: NOW, rows: [] })).toEqual([]);
  });

  it("names an open watcher from a watching row with no watch-done after it", () => {
    const rows: ChecksReadRow[] = [read(), watching()];
    expect(watchersOf({ nowIso: NOW, rows })).toEqual([
      {
        lastRead: { atIso: "2026-09-20T04:00:00.000Z", headSha: "aaaaaaa", rollup: "PENDING" },
        number: 973,
        repo: REPO,
        watchers: [
          { headSha: "aaaaaaa", mode: "wait", session: "sess-a", sinceIso: "2026-09-20T04:00:00.000Z", stale: false },
        ],
      },
    ]);
  });

  it("closes a watcher on the same session's watch-done, keeping the last read", () => {
    const rows: ChecksReadRow[] = [read(), watching(), watchDone()];
    expect(watchersOf({ nowIso: "2026-09-20T04:06:00.000Z", rows })).toEqual([
      {
        lastRead: { atIso: "2026-09-20T04:00:00.000Z", headSha: "aaaaaaa", rollup: "PENDING" },
        number: 973,
        repo: REPO,
        watchers: [],
      },
    ]);
  });

  it("a watch-done from ANOTHER session closes nothing: two sessions are two watchers", () => {
    const rows: ChecksReadRow[] = [
      watching({ session: "sess-a" }),
      watching({ atIso: "2026-09-20T04:01:00.000Z", mode: "merge", session: "sess-b" }),
      watchDone({ session: "sess-b" }),
    ];
    const [entry] = watchersOf({ nowIso: NOW, rows });
    expect(entry!.watchers.map((watcher) => watcher.session)).toEqual(["sess-a"]);
  });

  it("reports a watcher STALE once the clock is past its own timeout ceiling with no watch-done", () => {
    const rows: ChecksReadRow[] = [watching({ timeoutSeconds: 60 })];
    const [entry] = watchersOf({ nowIso: "2026-09-20T04:01:01.000Z", rows });
    expect(entry!.watchers).toEqual([
      { headSha: "aaaaaaa", mode: "wait", session: "sess-a", sinceIso: "2026-09-20T04:00:00.000Z", stale: true },
    ]);
  });

  it("is exactly not stale at the ceiling itself", () => {
    const rows: ChecksReadRow[] = [watching({ timeoutSeconds: 60 })];
    const [entry] = watchersOf({ nowIso: "2026-09-20T04:01:00.000Z", rows });
    expect(entry!.watchers[0]!.stale).toBe(false);
  });

  it("keeps the LAST read per pull request and orders entries by first mention", () => {
    const rows: ChecksReadRow[] = [
      read({ number: 977, rollup: "FAILURE" }),
      read({ atIso: "2026-09-20T04:02:00.000Z", headSha: "bbbbbbb", rollup: "SUCCESS" }),
      read({ atIso: "2026-09-20T04:03:00.000Z", headSha: "ccccccc", number: 977, rollup: "SUCCESS" }),
    ];
    expect(watchersOf({ nowIso: NOW, rows })).toEqual([
      {
        lastRead: { atIso: "2026-09-20T04:03:00.000Z", headSha: "ccccccc", rollup: "SUCCESS" },
        number: 977,
        repo: REPO,
        watchers: [],
      },
      {
        lastRead: { atIso: "2026-09-20T04:02:00.000Z", headSha: "bbbbbbb", rollup: "SUCCESS" },
        number: 973,
        repo: REPO,
        watchers: [],
      },
    ]);
  });

  it("ignores raise rows entirely: a raise names no reader and no watcher", () => {
    expect(watchersOf({ nowIso: NOW, rows: [raise()] })).toEqual([]);
  });

  it("a watching row with no read yet still answers, with no last read", () => {
    const [entry] = watchersOf({ nowIso: NOW, rows: [watching()] });
    expect(entry!.lastRead).toBeUndefined();
    expect(entry!.watchers.length).toBe(1);
  });
});

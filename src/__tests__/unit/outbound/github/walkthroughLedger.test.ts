/**
 * The walkthrough-thread register: an absent file is an empty memory, rows round-trip in order, a corrupt line
 * is refused by number while a torn final write is skipped and trimmed, and the fold keeps one pull request's
 * threads in written order.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  appendWalkthroughLedger,
  readWalkthroughLedger,
  WalkthroughLedgerErrors,
  type WalkthroughLedgerRow,
  walkthroughMemory,
} from "../../../../outbound/github/walkthroughLedger.js";

const AT = "2026-09-28T05:00:00.000Z";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A scratch state home this suite owns and removes. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-walk-ledger-"));
  homes.push(home);
  return home;
}

/** One resolve row, on `acme/widget#9` unless a case says otherwise. */
function row(over: {
  threadId: string;
  kind?: "resolving" | "released";
  repo?: string;
  number?: number;
}): WalkthroughLedgerRow {
  return { atIso: AT, kind: "resolving", number: 9, repo: "acme/widget", ...over };
}

/** One `surfaced` row on `acme/widget#9`, over a thread of two comments. */
function surfacedRow({ threadId, replyAtIso }: { threadId: string; replyAtIso: string }): WalkthroughLedgerRow {
  return { atIso: AT, kind: "surfaced", number: 9, replyAtIso, replyCount: 2, repo: "acme/widget", threadId };
}

describe("walkthrough-thread register", () => {
  it("reads an install that never resolved a thread as an empty register", () => {
    expect(unwrap(readWalkthroughLedger({ home: scratchHome() }))).toEqual([]);
  });

  it("reads back every row appended, in order", () => {
    const home = scratchHome();
    const rows = [row({ threadId: "PRRT_a" }), surfacedRow({ replyAtIso: AT, threadId: "PRRT_a" })];

    unwrap(appendWalkthroughLedger({ home, nowIso: AT, rows: rows.slice(0, 1) }));
    unwrap(appendWalkthroughLedger({ home, nowIso: AT, rows: rows.slice(1) }));

    expect(unwrap(readWalkthroughLedger({ home }))).toEqual(rows);
  });

  it("refuses a corrupt line by its number rather than reading it as no memory", () => {
    const home = scratchHome();
    mkdirSync(join(home, "ledgers"), { recursive: true });
    writeFileSync(
      join(home, "ledgers", "walkthrough-threads.jsonl"),
      `${JSON.stringify(row({ threadId: "PRRT_a" }))}\n{"kind":"forgotten"}\n`,
    );

    expect(unwrapErr(readWalkthroughLedger({ home }))).toEqual(
      WalkthroughLedgerErrors.corruptRow({
        lineNumber: 2,
        why: "`kind` is none of `resolving`, `released`, `surfaced`",
      }),
    );
  });

  /** One torn append must not refuse every landing on every pull request after it. */
  it("skips a torn final write, and the next append trims it off before writing", () => {
    const home = scratchHome();
    const path = join(home, "ledgers", "walkthrough-threads.jsonl");
    const first = row({ threadId: "PRRT_a" });
    mkdirSync(join(home, "ledgers"), { recursive: true });
    writeFileSync(path, `${JSON.stringify(first)}\n{"kind":"resolv`);

    expect(unwrap(readWalkthroughLedger({ home }))).toEqual([first]);

    const second = row({ threadId: "PRRT_b" });
    unwrap(appendWalkthroughLedger({ home, nowIso: AT, rows: [second] }));

    expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(first)}\n${JSON.stringify(second)}\n`);
  });

  /**
   * Judging the tail apart from the streamed rows let a concurrent append drop a complete row
   * the reader had read. One that parses is kept, since every kind of row errs toward an extra reopen.
   */
  it("keeps a final row cut just before its newline, since it parses", () => {
    const home = scratchHome();
    const rows = [row({ threadId: "PRRT_a" }), row({ threadId: "PRRT_b" })];
    mkdirSync(join(home, "ledgers"), { recursive: true });
    writeFileSync(
      join(home, "ledgers", "walkthrough-threads.jsonl"),
      rows.map((one) => JSON.stringify(one)).join("\n"),
    );

    expect(unwrap(readWalkthroughLedger({ home }))).toEqual(rows);
  });

  it("refuses a `surfaced` row that does not say how many comments the thread held", () => {
    const home = scratchHome();
    const countless = { atIso: AT, kind: "surfaced", number: 9, replyAtIso: AT, repo: "acme/widget", threadId: "a" };
    mkdirSync(join(home, "ledgers"), { recursive: true });
    writeFileSync(join(home, "ledgers", "walkthrough-threads.jsonl"), `${JSON.stringify(countless)}\n`);

    expect(unwrapErr(readWalkthroughLedger({ home }))).toEqual(
      WalkthroughLedgerErrors.corruptRow({
        lineNumber: 1,
        why: "a `surfaced` row's `replyCount` is not a positive whole number",
      }),
    );
  });

  it("refuses a `surfaced` row that does not say which reply it reopened over", () => {
    const home = scratchHome();
    mkdirSync(join(home, "ledgers"), { recursive: true });
    writeFileSync(
      join(home, "ledgers", "walkthrough-threads.jsonl"),
      `${JSON.stringify({ ...row({ threadId: "PRRT_a" }), kind: "surfaced" })}\n`,
    );

    expect(unwrapErr(readWalkthroughLedger({ home }))).toEqual(
      WalkthroughLedgerErrors.corruptRow({ lineNumber: 1, why: "a `surfaced` row's `replyAtIso` is not an instant" }),
    );
  });

  it("trims a torn write that is the register's only content", () => {
    const home = scratchHome();
    const path = join(home, "ledgers", "walkthrough-threads.jsonl");
    const only = row({ threadId: "PRRT_a" });
    mkdirSync(join(home, "ledgers"), { recursive: true });
    writeFileSync(path, `{"kind":"resolv`);

    unwrap(appendWalkthroughLedger({ home, nowIso: AT, rows: [only] }));

    expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(only)}\n`);
  });

  it("still refuses a corrupt line that has a complete row after it", () => {
    const home = scratchHome();
    mkdirSync(join(home, "ledgers"), { recursive: true });
    writeFileSync(
      join(home, "ledgers", "walkthrough-threads.jsonl"),
      `{"kind":"resolv\n${JSON.stringify(row({ threadId: "PRRT_a" }))}`,
    );

    expect(unwrapErr(readWalkthroughLedger({ home })).code).toBe("CORRUPT_ROW");
  });
});

describe("walkthroughMemory", () => {
  it("keeps one pull request's threads, repository compared without case, each id once", () => {
    const rows = [
      row({ threadId: "PRRT_a" }),
      row({ threadId: "PRRT_a" }),
      row({ repo: "Acme/Widget", threadId: "PRRT_b" }),
      surfacedRow({ replyAtIso: "2026-09-28T04:00:00.000Z", threadId: "PRRT_a" }),
      surfacedRow({ replyAtIso: "2026-09-28T06:00:00.000Z", threadId: "PRRT_a" }),
      row({ number: 10, threadId: "PRRT_other_pr" }),
      row({ repo: "acme/other", threadId: "PRRT_other_repo" }),
    ];

    expect(walkthroughMemory({ number: 9, repo: "acme/widget", rows })).toEqual({
      resolved: ["PRRT_a", "PRRT_b"],
      surfaced: { PRRT_a: { replyAtIso: "2026-09-28T06:00:00.000Z", replyCount: 2 } },
    });
  });

  it("forgets a resolve a later release cancels, and remembers one written after that release", () => {
    const rows = [
      row({ threadId: "PRRT_a" }),
      row({ kind: "released", threadId: "PRRT_a" }),
      row({ threadId: "PRRT_b" }),
      row({ kind: "released", threadId: "PRRT_b" }),
      row({ threadId: "PRRT_b" }),
    ];

    expect(walkthroughMemory({ number: 9, repo: "acme/widget", rows })).toEqual({
      resolved: ["PRRT_b"],
      surfaced: {},
    });
  });
});

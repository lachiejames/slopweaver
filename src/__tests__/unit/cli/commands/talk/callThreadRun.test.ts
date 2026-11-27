/**
 * `talk call-thread` and `talk call-thread-append`'s shells: the parsers' refusals, the exits a missing journal or a
 * bad batch gives, and a page cut and printed from a real journal under a throwaway home. The append's write itself
 * takes the call lock, which asks `ps` about its holder, so the write is driven through the store with a fake
 * `startOf` (`src/__tests__/unit/talk/callThreadStore.test.ts`) and only its refusals, which come before the lock, here.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runTalkCallThreadAppend } from "../../../../../cli/commands/talk/callThreadAppendRun.js";
import { parseCallThreadAppendArgs, parseCallThreadArgs } from "../../../../../cli/commands/talk/callThreadArgs.js";
import { runTalkCallThread } from "../../../../../cli/commands/talk/callThreadRun.js";
import {
  TALK_CALL_THREAD_APPEND_USAGE,
  TALK_CALL_THREAD_USAGE,
} from "../../../../../cli/commands/talk/callThreadUsage.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { CallThreadWireEntry } from "../../../../../talk/callThreadEntry.js";
import { callThreadLines, callThreadPage } from "../../../../../talk/callThreadPage.js";
import { appendCallThreadEntries, readCallThreadEntries } from "../../../../../talk/callThreadStore.js";

const CALL = "a0000041-0000-4000-8000-000000000044";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-thread-run-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const wire = ({ n }: { n: number }): CallThreadWireEntry => ({
  callId: CALL,
  capture: {
    kind: "notification",
    method: "item/completed",
    params: {
      item: { id: `item-${String(n)}`, text: `said ${String(n)}`, type: "agentMessage" },
      threadId: "thr-1",
      turnId: "t-1",
    },
  },
  receivedAtIso: "2026-11-02T05:00:00.000Z",
  version: 1,
  writeId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
});

/** Seed this test's home with entries 1..count, as writer pid 101, the owner's unless an instance is named. */
function seed({ count, instance }: { count: number; instance?: "e2e" }): void {
  unwrap(
    appendCallThreadEntries({
      callId: CALL,
      denylist: [],
      entries: Array.from({ length: count }, (_, i) => wire({ n: i + 1 })),
      home,
      instance,
      pid: 101,
      startOf: () => ({ running: true, start: "t101" }),
    }),
  );
}

describe("parseCallThreadArgs", () => {
  it("defaults to one entry from the start", () => {
    expect(unwrap(parseCallThreadArgs({ rest: ["--call", CALL] }))).toEqual({
      callId: CALL,
      from: 0,
      home: undefined,
      json: false,
      limit: 1,
    });
  });

  it("refuses a missing call, a bad id, and a page past ten", () => {
    expect(unwrapErr(parseCallThreadArgs({ rest: [] })).code).toBe("CALL_THREAD_ARG_CALL");
    expect(unwrapErr(parseCallThreadArgs({ rest: ["--call", "x"] })).code).toBe("CALL_THREAD_ARG_CALL");
    expect(unwrapErr(parseCallThreadArgs({ rest: ["--call", CALL, "--limit", "11"] })).message).toContain(
      "--limit must be 1 to 10, got 11",
    );
  });
});

describe("the usage texts", () => {
  it("tell a reader the page bound and a writer what is altered before it lands", () => {
    expect(TALK_CALL_THREAD_USAGE).toContain("at most 10");
    expect(TALK_CALL_THREAD_APPEND_USAGE).toContain("--entries-file");
  });
});

describe("parseCallThreadAppendArgs", () => {
  it("needs the staged batch", () => {
    expect(unwrapErr(parseCallThreadAppendArgs({ rest: ["--call", CALL] })).message).toContain(
      "--entries-file <jsonl|-> is required",
    );
  });

  it("takes - as the batch on stdin", () => {
    expect(unwrap(parseCallThreadAppendArgs({ rest: ["--call", CALL, "--entries-file", "-"] })).entriesFile).toBe("-");
  });

  const originFlags = ["--console-root", "/w/main", "--console-port", "3000", "--console-default-port", "3000"];
  const parse = (...flags: string[]) =>
    parseCallThreadAppendArgs({ rest: ["--call", CALL, "--entries-file", "-", ...flags] });

  it("marks the console origin the desktop test instance's call wrote through, and leaves the owner's unmarked", () => {
    expect(unwrap(parse(...originFlags, "--console-instance", "e2e")).consoleOrigin).toEqual({
      checkoutRoot: "/w/main",
      defaultPort: 3000,
      instance: "e2e",
      port: 3000,
    });
    expect(unwrap(parse(...originFlags)).consoleOrigin).toEqual({
      checkoutRoot: "/w/main",
      defaultPort: 3000,
      port: 3000,
    });
  });

  it("refuses an instance other than e2e, and one passed without the console origin it qualifies", () => {
    expect(unwrapErr(parse(...originFlags, "--console-instance", "E2E")).message).toContain(
      "--console-instance must be e2e, not E2E",
    );
    expect(unwrapErr(parse("--console-instance", "e2e")).message).toContain(
      "--console-instance is passed only beside --console-root",
    );
  });
});

describe("runTalkCallThread", () => {
  const run = (...flags: string[]): number =>
    runTalkCallThread(["node", "slopweaver", "talk", "call-thread", "--call", CALL, "--home", home, ...flags]);

  it("exits as an error on a call with no journal, and as usage on a bad flag", () => {
    expect(run()).toBe(EXIT_ERROR);
    expect(run("--limit", "0")).toBe(EXIT_USAGE);
  });

  it("reads a journal page in text and JSON", () => {
    seed({ count: 3 });
    expect(run("--from", "1", "--limit", "2")).toBe(EXIT_OK);
    expect(run("--json")).toBe(EXIT_OK);
  });
});

describe("callThreadPage and callThreadLines", () => {
  it("cuts a page, points at the next one, and prints each entry's identifiers", () => {
    seed({ count: 3 });
    const read = unwrap(readCallThreadEntries({ callId: CALL, home }));
    const page = callThreadPage({ callId: CALL, entries: read.entries, from: 1, limit: 1, skipped: 0 });
    expect(page.entries.map((shown) => shown.index)).toEqual([1]);
    expect(page.nextFrom).toBe(2);
    const lines = callThreadLines({ page });
    expect(lines[0]).toBe(`talk call-thread: call ${CALL}, entries 1–1 of 3 — next page --from 2`);
    expect(lines[1]).toBe(
      "[1] 2026-11-02T05:00:00.000Z  notification  method=item/completed thread=thr-1 turn=t-1 item=agentMessage id=item-2",
    );
  });

  it("marks each of the desktop test instance's entries on its header, and carries the mark in the page", () => {
    seed({ count: 1, instance: "e2e" });
    unwrap(
      appendCallThreadEntries({
        callId: CALL,
        denylist: [],
        entries: [wire({ n: 2 })],
        home,
        instance: undefined,
        pid: 101,
        startOf: () => ({ running: true, start: "t101" }),
      }),
    );
    const read = unwrap(readCallThreadEntries({ callId: CALL, home }));
    const page = callThreadPage({ callId: CALL, entries: read.entries, from: 0, limit: 2, skipped: 0 });
    expect(page.entries.map((shown) => shown.entry.instance)).toEqual(["e2e", undefined]);
    const headers = callThreadLines({ page }).filter((line) => line.startsWith("["));
    expect(headers).toEqual([
      "[0] 2026-11-02T05:00:00.000Z  notification  instance=e2e method=item/completed thread=thr-1 turn=t-1 item=agentMessage id=item-1",
      "[1] 2026-11-02T05:00:00.000Z  notification  method=item/completed thread=thr-1 turn=t-1 item=agentMessage id=item-2",
    ]);
  });

  it("says the last page is the last, and a --from past the end says so", () => {
    seed({ count: 2 });
    const read = unwrap(readCallThreadEntries({ callId: CALL, home }));
    expect(callThreadPage({ callId: CALL, entries: read.entries, from: 1, limit: 5, skipped: 0 }).nextFrom).toBe(null);
    const past = callThreadPage({ callId: CALL, entries: read.entries, from: 9, limit: 1, skipped: 1 });
    expect(callThreadLines({ page: past })).toEqual([
      `talk call-thread: call ${CALL} has 2 entr(ies); --from is past the last; 1 line(s) unreadable`,
    ]);
  });
});

describe("runTalkCallThreadAppend", () => {
  const append = (...flags: string[]): Promise<number> =>
    runTalkCallThreadAppend([
      "node",
      "slopweaver",
      "talk",
      "call-thread-append",
      "--call",
      CALL,
      "--home",
      home,
      ...flags,
    ]);

  it("refuses a batch for good: a line that is no entry exits usage, so the console stops resending it", async () => {
    const path = join(home, "batch.jsonl");
    writeFileSync(path, `${JSON.stringify(wire({ n: 1 }))}\n{"not":"an entry"}\n`);
    expect(await append("--entries-file", path)).toBe(EXIT_USAGE);
    expect(unwrapErr(readCallThreadEntries({ callId: CALL, home })).code).toBe("CALL_THREAD_MISSING");
  });

  it("refuses for good a written writeId on a different capture, so the console names it instead of dropping it", async () => {
    seed({ count: 1 });
    const path = join(home, "batch.jsonl");
    writeFileSync(path, `${JSON.stringify({ ...wire({ n: 1 }), receivedAtIso: "2026-11-02T05:00:01.000Z" })}\n`);
    expect(await append("--entries-file", path)).toBe(EXIT_USAGE);
    expect(unwrap(readCallThreadEntries({ callId: CALL, home })).entries.map((e) => e.receivedAtIso)).toEqual([
      "2026-11-02T05:00:00.000Z",
    ]);
  });

  it("reads a batch it cannot open as worth retrying", async () => {
    expect(await append("--entries-file", join(home, "absent.jsonl"))).toBe(EXIT_ERROR);
  });
});

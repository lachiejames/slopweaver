/*
 * The call transcript on disk: a batch appends whole or not at all, the file is the owner's and nobody else's (0600 in a
 * 0700 directory), a torn last line is skipped and counted, and the path is only ever a call id's.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { parseCallBatch, readCallBatch } from "../../../talk/callBatch.js";
import { isCallId } from "../../../talk/callId.js";
import type { CallOrigin } from "../../../talk/callOrigin.js";
import type { CallEntry } from "../../../talk/callRecord.js";
import { appendCallEntries, callsDir, callWrittenSince, readCalls } from "../../../talk/callStore.js";
import { TalkErrors } from "../../../talk/errors.js";

const CALL = "a0000041-0000-4000-8000-000000000044";
const SAID: CallEntry = {
  atIso: "2026-09-25T02:21:00.000Z",
  final: true,
  id: "s-1",
  kind: "segment",
  text: "look at the staging pool",
  who: "owner",
};

const STEP: CallEntry = {
  atIso: "2026-09-25T02:22:00.000Z",
  event: { attempt: 1, delayMs: 0, kind: "scheduled", total: 5 },
  kind: "reconnect",
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-calls-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

type StartOf = NonNullable<Parameters<typeof appendCallEntries>[0]["startOf"]>;
/** The running processes, each pid started at the stamp `t<pid>`; every other pid is not running. */
const alive =
  (...pids: number[]): StartOf =>
  (pid) =>
    pids.includes(pid) ? { running: true, start: `t${String(pid)}` } : { running: false, start: undefined };

/** Append as writer pid 101, running, so no `ps` is spawned to ask. */
const append = (over: Partial<Parameters<typeof appendCallEntries>[0]>) =>
  appendCallEntries({ callId: CALL, entries: [SAID], home, pid: 101, startOf: alive(101), ...over });

/** Write a batch file the way the console route does: one JSON line per entry. */
const batch = ({ lines }: { lines: readonly string[] }): string => {
  const path = join(home, "batch.jsonl");
  writeFileSync(path, lines.map((line) => `${line}\n`).join(""));
  return path;
};

describe("isCallId", () => {
  it("takes a v4 UUID and nothing that could walk out of the directory", () => {
    expect(isCallId({ callId: CALL })).toBe(true);
    expect(isCallId({ callId: "../../etc/passwd" })).toBe(false);
    expect(isCallId({ callId: `${CALL}/x` })).toBe(false);
  });
});

describe("readCallBatch", () => {
  it("reads every line of a good batch", () => {
    expect(unwrap(readCallBatch({ path: batch({ lines: [JSON.stringify(SAID)] }) }))).toEqual([SAID]);
  });

  it("refuses the whole batch when one line is not a call line, naming it", () => {
    const refused = unwrapErr(readCallBatch({ path: batch({ lines: [JSON.stringify(SAID), '{"kind":"nope"}'] }) }));
    expect(refused.code).toBe("CALL_ENTRIES_INVALID");
    expect(refused.message).toContain("line(s) 2 are not call lines");
  });

  it("refuses a batch in which two lines carry the same write id, rather than drop either", () => {
    const writeId = "0f1e2d3c-4b5a-4968-8776-655443322110";
    const lines = [
      JSON.stringify({ ...SAID, writeId }),
      JSON.stringify({ ...SAID, id: "s-2", text: "other", writeId }),
    ];
    const refused = unwrapErr(readCallBatch({ path: batch({ lines }) }));
    expect(refused.code).toBe("CALL_ENTRIES_INVALID");
    expect(refused.message).toContain("two lines carry the same writeId");
  });

  it("refuses a batch past the bound", () => {
    const lines = Array.from({ length: 201 }, () => JSON.stringify(SAID));
    expect(unwrapErr(readCallBatch({ path: batch({ lines }) })).message).toContain(
      "more than the 200 one batch may carry",
    );
  });
});

describe("parseCallBatch", () => {
  it("parses a piped batch, skipping blank lines, under the same rules as a file", () => {
    expect(unwrap(parseCallBatch({ source: "stdin", text: `${JSON.stringify(SAID)}\n\n` }))).toEqual([SAID]);
  });

  it("refuses the whole piped batch when one line is not a call line, naming the source and the line", () => {
    const refused = unwrapErr(parseCallBatch({ source: "stdin", text: `${JSON.stringify(SAID)}\nnot json\n` }));
    expect([refused.code, refused.message]).toEqual([
      "CALL_ENTRIES_INVALID",
      TalkErrors.callEntriesInvalid({ path: "stdin", why: "line(s) 2 are not call lines" }).message,
    ]);
  });
});

/** A copy-tray landing as the page posts it, its write id minted once and kept on every retry. */
const OFFERED: CallEntry = {
  atIso: "2026-10-13T12:31:19.221Z",
  kind: "offered",
  offer: { belowFold: "• <@U01ARI> owns the rollback\n", id: "offer-3", made: "3", text: "*Staging* is back " },
  writeId: "6a1e2d3c-4b5a-4968-8776-655443322110",
};

describe("copy-tray offers on the call file", () => {
  it("refuses a whole batch carrying an offer past the list's bound, rather than cut the message", () => {
    const over = { ...OFFERED, offer: { id: "offer-4", made: "4", text: "🙂".repeat(8193) } };
    const lines = [JSON.stringify(SAID), JSON.stringify(over)];
    expect(unwrapErr(readCallBatch({ path: batch({ lines }) })).message).toContain("line(s) 2 are not call lines");
  });

  it("appends one landing once however often a batch that got no answer carries it, and reads it back byte for byte", () => {
    unwrap(append({ entries: [SAID, OFFERED] }));
    const retried = unwrap(append({ entries: [OFFERED] }));
    expect(retried.appended).toBe(0);
    const read = unwrap(readCalls({ home, keep: { limit: 5 } }));
    expect(read.calls.map((call) => call.offers)).toEqual([
      [
        {
          atIso: "2026-10-13T12:31:19.221Z",
          belowFold: "• <@U01ARI> owns the rollback\n",
          id: "offer-3",
          label: undefined,
          made: "3",
          text: "*Staging* is back ",
        },
      ],
    ]);
  });
});

/** A tool line carrying the exact answer the model was handed. */
const ANSWERED: CallEntry = {
  answer: '{"answer":"ABC-1 is \\"Done\\" — shipped\\n"}',
  atIso: "2026-11-01T02:10:00.000Z",
  detail: "read ABC-1",
  kind: "tool",
  name: "code_read",
  refused: false,
  writeId: "7b2f3e4d-5c6b-4a79-8887-766554433221",
};

describe("tool answers on the call file", () => {
  it("appends a tool line's answer to the 0600 file and reads it back byte for byte", () => {
    const written = unwrap(append({ entries: [SAID, ANSWERED] }));
    expect(statSync(written.path).mode & 0o777).toBe(0o600);
    const read = unwrap(readCalls({ home, keep: { limit: 5 } }));
    expect(read.calls.map((call) => call.notes)).toEqual([
      [
        {
          answer: '{"answer":"ABC-1 is \\"Done\\" — shipped\\n"}',
          atIso: "2026-11-01T02:10:00.000Z",
          detail: "read ABC-1",
          kind: "tool",
          name: "code_read",
          opened: undefined,
          refused: false,
        },
      ],
    ]);
  });
});

describe("appendCallEntries and readCalls", () => {
  it("appends to a 0600 file in a 0700 directory and folds it back", () => {
    const written = unwrap(append({}));
    unwrap(append({ entries: [{ ...SAID, id: "s-2", text: "on it", who: "voice" }] }));
    expect(written.appended).toBe(1);
    expect(statSync(written.path).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, "talk", "calls")).mode & 0o777).toBe(0o700);
    const read = unwrap(readCalls({ home, keep: { limit: 5 } }));
    expect(read.calls.map((call) => call.segments.map((segment) => segment.text))).toEqual([
      ["look at the staging pool", "on it"],
    ]);
    expect(read.unreadable).toEqual([]);
  });

  it("waits out a live writer's lock, however old, then refuses and writes nothing, rather than land inside its batch", () => {
    const { path } = unwrap(append({}));
    const before = readFileSync(path, "utf8");
    writeFileSync(`${path}.lock`, "4242 t4242\n");
    const hourAgo = new Date(Date.now() - 3_600_000);
    utimesSync(`${path}.lock`, hourAgo, hourAgo);

    const refused = unwrapErr(append({ lockWaitMs: 50, startOf: alive(101, 4242) }));

    expect(refused.code).toBe("PATH_UNREADABLE");
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("4242 t4242\n");
  });

  it.each([
    ["no longer running", "4242 t4242\n", alive(101)],
    ["whose pid another process now has", "4242 t1\n", alive(101, 4242)],
  ])("takes over a lock whose holder is %s, appends, and releases it", (_label, holder, startOf) => {
    const { path } = unwrap(append({}));
    writeFileSync(`${path}.lock`, holder);

    expect(unwrap(append({ startOf })).appended).toBe(1);
    expect(readFileSync(path, "utf8").split("\n").length).toBe(3);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it("never takes over a lock that names no holder, however old", () => {
    const { path } = unwrap(append({}));
    writeFileSync(`${path}.lock`, "");
    const hourAgo = new Date(Date.now() - 3_600_000);
    utimesSync(`${path}.lock`, hourAgo, hourAgo);

    expect(unwrapErr(append({ lockWaitMs: 50 })).code).toBe("PATH_UNREADABLE");
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("");
  });

  it("indexes a call once, before its first line, however many batches follow", () => {
    unwrap(append({}));
    unwrap(append({}));

    expect(readFileSync(join(home, "talk", "call-index.txt"), "utf8")).toBe(`${CALL}\n`);
  });

  it("refuses a call id that is not a UUID and writes nothing", () => {
    expect(unwrapErr(append({ callId: "../escape" })).code).toBe("CALL_INVALID");
    expect(unwrap(readCalls({ home, keep: { limit: 5 } })).calls).toEqual([]);
  });

  it("skips and counts a torn last line rather than losing the call", () => {
    const { path } = unwrap(append({}));
    appendFileSync(path, '{"atIso":"2026-09-25T02:22:00.000Z","kind":"segm');
    const [call] = unwrap(readCalls({ home, keep: { limit: 5 } })).calls;
    expect([call!.segments.length, call!.skipped]).toEqual([1, 1]);
  });

  it("names a call file none of whose lines parse as unread, never as no call", () => {
    const { path } = unwrap(append({}));
    writeFileSync(path, '{"atIso":"2026-09-25T02:22:00.000Z","kind":"segment"}\n');

    expect(unwrap(readCalls({ home, keep: { limit: 5 } }))).toEqual({
      calls: [],
      passedOver: 0,
      unreadable: [`${CALL}: none of its 1 line(s) parsed`],
    });
  });

  it("names a call file whose only parsed line is a reconnect as unread, never as no call", () => {
    const { path } = unwrap(append({}));
    const reconnect = {
      atIso: "2026-09-25T02:22:00.000Z",
      event: { attempt: 1, delayMs: 0, kind: "scheduled", total: 5 },
      kind: "reconnect",
    };
    writeFileSync(path, `{"atIso":"2026-09-25T02:22:00.000Z","kind":"segment"}\n${JSON.stringify(reconnect)}\n`);

    expect(unwrap(readCalls({ home, keep: { limit: 5 } }))).toEqual({
      calls: [],
      passedOver: 0,
      unreadable: [`${CALL}: only reconnect lines parsed, beside 1 line(s) that did not`],
    });
  });

  it("names a directory carrying a call's file name as unread, never skipping it", () => {
    mkdirSync(join(callsDir({ home }), `${CALL}.jsonl`), { recursive: true });

    expect(unwrap(readCalls({ home, keep: { limit: 5 } }))).toEqual({
      calls: [],
      passedOver: 0,
      unreadable: [`${CALL}.jsonl: named for a call but not a regular file`],
    });
  });

  it("starts the next batch on a line of its own after a torn one, so its first line is never lost", () => {
    const { path } = unwrap(append({}));
    appendFileSync(path, '{"atIso":"2026-09-25T02:22:00.000Z","kind":"segm');
    unwrap(append({ entries: [{ ...SAID, id: "s-2", text: "and the queue" }] }));
    const [call] = unwrap(readCalls({ home, keep: { limit: 5 } })).calls;
    expect([call!.segments.map((segment) => segment.text), call!.skipped]).toEqual([
      ["look at the staging pool", "and the queue"],
      1,
    ]);
  });

  // The route killed the verb on its bound after it had appended, answered 503, and the
  // page posted the same batch again — fourteen batches went in two or three times.
  it("appends a batch posted again after no answer once, by its lines' write ids, and says it appended none", () => {
    const first = { ...SAID, writeId: "0f1e2d3c-4b5a-4968-8776-655443322110" };
    const second = { ...SAID, id: "s-2", text: "and the queue", writeId: "1f1e2d3c-4b5a-4968-8776-655443322110" };
    const { path } = unwrap(append({ entries: [first, second] }));

    const again = unwrap(append({ entries: [first, second] }));

    expect(again.appended).toBe(0);
    expect(readFileSync(path, "utf8").trim().split("\n").length).toBe(2);
  });

  it("appends only the lines of a mixed batch the file does not hold", () => {
    const held = { ...SAID, writeId: "0f1e2d3c-4b5a-4968-8776-655443322110" };
    const fresh = { ...SAID, id: "s-2", text: "and the queue", writeId: "2f1e2d3c-4b5a-4968-8776-655443322110" };
    const { path } = unwrap(append({ entries: [held] }));

    const mixed = unwrap(append({ entries: [held, fresh] }));

    expect(mixed.appended).toBe(1);
    expect(
      readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .map((line) => (JSON.parse(line) as CallEntry).writeId),
    ).toEqual(["0f1e2d3c-4b5a-4968-8776-655443322110", "2f1e2d3c-4b5a-4968-8776-655443322110"]);
  });

  it("refuses, and writes nothing, when a batch handed straight to the append repeats a write id", () => {
    const writeId = "4f1e2d3c-4b5a-4968-8776-655443322110";
    const refused = unwrapErr(
      append({
        entries: [
          { ...SAID, writeId },
          { ...SAID, id: "s-2", text: "other", writeId },
        ],
      }),
    );
    expect([refused.code, existsSync(join(callsDir({ home }), `${CALL}.jsonl`))]).toEqual([
      "CALL_ENTRIES_INVALID",
      false,
    ]);
  });

  it("appends a line again whose earlier copy was torn, since a torn line has no id to read", () => {
    const line = { ...SAID, id: "s-2", text: "and the queue", writeId: "3f1e2d3c-4b5a-4968-8776-655443322110" };
    const { path } = unwrap(append({}));
    appendFileSync(path, JSON.stringify(line).slice(0, 40));

    expect(unwrap(append({ entries: [line] })).appended).toBe(1);
    const [call] = unwrap(readCalls({ home, keep: { limit: 5 } })).calls;
    expect([call!.segments.map((segment) => segment.text), call!.skipped]).toEqual([
      ["look at the staging pool", "and the queue"],
      1,
    ]);
  });

  it("appends a line with no write id every time, as a batch written before the ids always was", () => {
    const { path } = unwrap(append({}));

    expect(unwrap(append({})).appended).toBe(1);
    expect(readFileSync(path, "utf8").trim().split("\n").length).toBe(2);
  });

  // A reconnect step appended to an old call made its file the newest written.
  it("leaves the write time where the call's own lines put it when a batch is reconnect steps alone", () => {
    const old = "a0000076-0000-4000-8000-000000000083";
    const ranAt = Date.parse("2026-10-01T09:05:00.000Z") / 1000;
    const { path } = unwrap(
      append({
        callId: old,
        entries: [
          { ...SAID, atIso: "2026-10-01T09:00:00.000Z", text: "the old call" },
          { atIso: "2026-10-01T09:05:00.000Z", kind: "closed", why: "dropped" },
        ],
      }),
    );
    utimesSync(path, ranAt, ranAt);
    unwrap(append({ entries: [{ ...SAID, atIso: "2026-10-04T09:00:00.000Z", text: "the newer call" }] }));

    unwrap(append({ callId: old, entries: [{ ...STEP, atIso: "2026-10-05T09:00:00.000Z" }] }));

    expect(statSync(path).mtimeMs).toBe(ranAt * 1000);
    expect(readFileSync(path, "utf8").trim().split("\n").at(-1)).toContain('"kind":"reconnect"');
    expect(readdirSync(callsDir({ home })).filter((name) => name.endsWith(".stage"))).toEqual([]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(
      unwrap(readCalls({ home, keep: { limit: 1 } })).calls.map((call) => call.segments.map((segment) => segment.text)),
    ).toEqual([["the newer call"]]);
  });

  // A first write of steps alone made a newest file that folds to no call, hiding a real one.
  it("refuses steps alone for a call with no file, and writes neither the file nor its index line", () => {
    const old = "a0000076-0000-4000-8000-000000000083";
    unwrap(append({ callId: old, entries: [{ ...SAID, text: "the real call" }] }));

    const refused = unwrapErr(append({ entries: [STEP] }));

    expect(refused.code).toBe("CALL_ENTRIES_INVALID");
    expect(refused.message).toContain("a step goes after its call's close");
    expect(existsSync(join(callsDir({ home }), `${CALL}.jsonl`))).toBe(false);
    expect(
      unwrap(readCalls({ home, keep: { limit: 1 } })).calls.map((call) => call.segments.map((segment) => segment.text)),
    ).toEqual([["the real call"]]);
  });

  it("moves the write time when a batch carries a line of the call's own beside a step", () => {
    const ranAt = Date.parse("2026-10-01T09:05:00.000Z") / 1000;
    const { path } = unwrap(append({}));
    utimesSync(path, ranAt, ranAt);

    unwrap(append({ entries: [{ ...SAID, id: "s-2", text: "still here" }, STEP] }));

    expect(statSync(path).mtimeMs).toBeGreaterThan(ranAt * 1000);
  });

  // Twenty-one silent calls pushed the last thing said out of a twenty-call read.
  it("reads past every silent call back to the newest few anyone spoke on", () => {
    const spoke = "a0000076-0000-4000-8000-000000000083";
    const older = "2a2b3c4d-5e6f-4a7b-9c8d-7e6f5a4b3c2d";
    const silent = ["3a2b3c4d-5e6f-4a7b-9c8d-7e6f5a4b3c2d", "4a2b3c4d-5e6f-4a7b-9c8d-7e6f5a4b3c2d"];
    const files = [
      { callId: older, entries: [{ ...SAID, text: "the older call" }] },
      { callId: spoke, entries: [{ ...SAID, text: "night-night" }] },
      ...silent.map((callId) => ({ callId, entries: [{ ...SAID, text: "  " }] })),
    ];
    // Ten minutes apart, each call opening as its file is written: past the minute a sink can stamp ahead.
    files.forEach(({ callId, entries }, index) => {
      const atMs = Date.parse("2026-10-10T16:00:00.000Z") + index * 600_000;
      const atIso = new Date(atMs).toISOString();
      const { path } = unwrap(append({ callId, entries: entries.map((entry) => ({ ...entry, atIso })) }));
      utimesSync(path, atMs / 1000, atMs / 1000);
    });
    const texts = ({ keep }: { keep: Parameters<typeof readCalls>[0]["keep"] }) => {
      const read = unwrap(readCalls({ home, keep }));
      return [read.passedOver, read.calls.flatMap((call) => call.segments.map((segment) => segment.text))];
    };
    expect([texts({ keep: { limit: 2 } }), texts({ keep: { speaking: 1 } }), texts({ keep: { limit: 9 } })]).toEqual([
      [2, ["  ", "  "]],
      [1, ["  ", "  ", "night-night"]],
      [0, ["  ", "  ", "night-night", "the older call"]],
    ]);
  });

  // A late write to an older call made it newest-written, and the read stopped before the newest call.
  it("reads on past a speaking call written late to the call that opened after it", () => {
    const late = "a0000076-0000-4000-8000-000000000083";
    const newest = "2a2b3c4d-5e6f-4a7b-9c8d-7e6f5a4b3c2d";
    const files = [
      {
        callId: late,
        openedIso: "2026-10-10T16:00:00.000Z",
        text: "the older call",
        writtenIso: "2026-10-10T17:00:00.000Z",
      },
      {
        callId: newest,
        openedIso: "2026-10-10T16:30:00.000Z",
        text: "night-night",
        writtenIso: "2026-10-10T16:35:00.000Z",
      },
    ];
    for (const { callId, openedIso, text, writtenIso } of files) {
      const { path } = unwrap(append({ callId, entries: [{ ...SAID, atIso: openedIso, text }] }));
      const at = Date.parse(writtenIso) / 1000;
      utimesSync(path, at, at);
    }
    const read = unwrap(readCalls({ home, keep: { speaking: 1 } }));
    expect(read.calls.map((call) => call.callId).toSorted()).toEqual([newest, late]);
  });

  it("reads nothing, and no failure, from a home that never had a call", () => {
    expect(unwrap(readCalls({ home, keep: { sinceIso: "2026-09-20T00:00:00.000Z" } }))).toEqual({
      calls: [],
      passedOver: 0,
      unreadable: [],
    });
  });
});

// An earlier-indexed call is read only when its file was written after the late call's last line.
describe("callWrittenSince", () => {
  it("passes a call written at or after the instant, less the slack, and no call with no file", () => {
    unwrap(append({}));
    const writtenMs = Date.parse("2026-09-25T02:21:00.000Z");
    utimesSync(join(callsDir({ home }), `${CALL}.jsonl`), writtenMs / 1000, writtenMs / 1000);
    const since = ({ sinceMs, callId = CALL }: { sinceMs: number; callId?: string }): boolean =>
      callWrittenSince({ callId, home, sinceMs, slackMs: 1000 });
    expect([
      since({ sinceMs: writtenMs }),
      since({ sinceMs: writtenMs + 1000 }),
      since({ sinceMs: writtenMs + 1001 }),
      since({ callId: "a0000076-0000-4000-8000-000000000083", sinceMs: 0 }),
    ]).toEqual([true, true, false, false]);
  });
});

describe("appendCallEntries from a console that is not the owner's", () => {
  const SEAT: CallOrigin = { checkoutRoot: "/w/seat", defaultPort: 3000, mainWorktree: false, port: 3001 };
  const OWNER: CallOrigin = { checkoutRoot: "/w/main", defaultPort: 3000, mainWorktree: true, port: 3000 };
  const opened = ({ origin }: { origin: CallOrigin }): CallEntry => ({
    atIso: "2026-09-25T02:20:00.000Z",
    kind: "open",
    model: "m",
    origin,
    sessionId: "x",
    voice: "v",
  });
  const callFile = (): string => join(callsDir({ home }), `${CALL}.jsonl`);

  it("refuses a segment-only batch for a call with no file, writing neither the file nor its index entry", () => {
    expect(unwrapErr(append({ origin: SEAT }))).toEqual(TalkErrors.callOriginUnopened({ callId: CALL }));
    expect([existsSync(callFile()), readdirSync(callsDir({ home }))]).toEqual([false, []]);
  });

  it("judges the file as it stands at the append, so the owner's open landing after its own refuses it", () => {
    unwrap(append({ entries: [opened({ origin: SEAT })], origin: SEAT }));
    unwrap(append({ entries: [opened({ origin: OWNER })], origin: OWNER }));
    expect(unwrapErr(append({ origin: SEAT })).code).toBe("CALL_ORIGIN_UNOPENED");
    expect(readFileSync(callFile(), "utf8").split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("appends under an open it wrote, and holds neither the owner's console nor a write naming no console to it", () => {
    unwrap(append({ entries: [opened({ origin: SEAT })], origin: SEAT }));
    expect([
      unwrap(append({ origin: SEAT })).appended,
      unwrap(append({ entries: [{ ...SAID, id: "s-2" }], origin: OWNER })).appended,
      unwrap(append({ entries: [{ ...SAID, id: "s-3" }] })).appended,
    ]).toEqual([1, 1, 1]);
  });
});

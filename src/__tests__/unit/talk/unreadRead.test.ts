/**
 * The effectful half of `talk unread`, over a throwaway home: the cursor round-trips, a cursor or call file that
 * cannot be trusted is an error rather than a fresh start, and an unterminated last line refuses the read until it lands.
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { quarantineCall } from "../../../talk/callQuarantine.js";
import { callQuarantinePath } from "../../../talk/callQuarantineLedger.js";
import { CALL_TEXT_CHARS, type CallEntry } from "../../../talk/callRecord.js";
import { appendCallEntries, callIndexPath } from "../../../talk/callStore.js";
import { TalkErrors } from "../../../talk/errors.js";
import { readUnreadCursor, unreadCursorPath, writeUnreadCursor } from "../../../talk/unreadCursorStore.js";
import { UnreadErrors } from "../../../talk/unreadErrors.js";
import { readUnread, UNREAD_BOOTSTRAP_MS } from "../../../talk/unreadRead.js";
import { advancedCursor, selectUnreadWords } from "../../../talk/unreadWords.js";

const CALL = "a0000035-0000-4000-8000-000000000038";
const NOW = "2026-09-26T06:00:00.000Z";
const NAME = "supervisor";
/** The appending process, running, so no `ps` is spawned to ask. */
const WRITER = { pid: 101, startOf: () => ({ running: true, start: "t101" }) };

const segment = ({ id, text, atIso = "2026-09-26T05:00:00.000Z" }: { id: string; text: string; atIso?: string }) =>
  `${JSON.stringify({ atIso, final: true, id, kind: "segment", text, who: "owner" })}\n`;

let home = "";
let callFile = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "talk-unread-"));
  mkdirSync(join(home, "talk", "calls"), { recursive: true });
  callFile = join(home, "talk", "calls", `${CALL}.jsonl`);
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Read, then mark exactly what that read saw — the two halves `talk unread --mark` performs. */
const mark = (): void => {
  const read = unwrap(readUnread({ home, name: NAME, nowIso: NOW }));
  unwrap(writeUnreadCursor({ cursor: advancedCursor({ read, recordedAtIso: NOW }), home, name: NAME }));
};

const unreadTexts = (): readonly string[] =>
  selectUnreadWords({ read: unwrap(readUnread({ home, name: NAME, nowIso: NOW })) }).words.map((word) => word.text);

describe("the cursor store", () => {
  it("reads a reader that never marked as undefined, and round-trips a written cursor in a 0600 file", () => {
    expect(unwrap(readUnreadCursor({ home, name: NAME }))).toBe(undefined);
    const cursor = { calls: {}, recordedAtIso: NOW };
    const path = unwrap(writeUnreadCursor({ cursor, home, name: NAME }));

    expect(path).toBe(join(home, "talk", "unread-cursors", "supervisor.json"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(unwrap(readUnreadCursor({ home, name: NAME }))).toEqual(cursor);
  });

  it("refuses a cursor name that could escape its directory", () => {
    const path = unreadCursorPath({ home, name: "../escape" });
    expect(path._unsafeUnwrapErr()).toEqual(UnreadErrors.cursorNameInvalid({ name: "../escape" }));
  });

  it("refuses a malformed cursor rather than reading it as a first read", () => {
    unwrap(writeUnreadCursor({ cursor: { calls: {}, recordedAtIso: NOW }, home, name: NAME }));
    writeFileSync(unwrap(unreadCursorPath({ home, name: NAME })), '{"calls":{}}');

    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr().code).toBe("CURSOR_MALFORMED");
  });

  it.each([
    ["the cursor", { calls: {}, recordedAtIso: NOW, unexpected: true }],
    [
      "a frontier",
      { calls: { [CALL]: { offset: 0, prefixSha256: "sha256:x", unexpected: true } }, recordedAtIso: NOW },
    ],
  ])("refuses a field no mark writes on %s rather than strip it and rewrite the cursor canonical", (_label, cursor) => {
    unwrap(writeUnreadCursor({ cursor: { calls: {}, recordedAtIso: NOW }, home, name: NAME }));
    writeFileSync(unwrap(unreadCursorPath({ home, name: NAME })), JSON.stringify(cursor));

    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr().code).toBe("CURSOR_MALFORMED");
  });

  it("refuses a cursor whose instant parses but is not the canonical ISO a mark writes, however long", () => {
    const loose = `Sep 26 2026${" ".repeat(10_000)}`;
    unwrap(writeUnreadCursor({ cursor: { calls: {}, recordedAtIso: NOW }, home, name: NAME }));
    writeFileSync(unwrap(unreadCursorPath({ home, name: NAME })), JSON.stringify({ calls: {}, recordedAtIso: loose }));

    expect(Number.isNaN(Date.parse(loose))).toBe(false);
    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr().code).toBe("CURSOR_MALFORMED");
  });
});

describe("readUnread", () => {
  it("reads a home with no call file as nothing, with a bootstrap floor 24 hours back", () => {
    rmSync(join(home, "talk"), { force: true, recursive: true });
    const read = unwrap(readUnread({ home, name: NAME, nowIso: NOW }));

    expect(read).toEqual({
      bootstrapFloorIso: new Date(Date.parse(NOW) - UNREAD_BOOTSTRAP_MS).toISOString(),
      cursor: undefined,
      quarantined: [],
      tails: [],
    });
  });

  it("shows words once, and after a mark only what was appended since", () => {
    writeFileSync(callFile, segment({ id: "a", text: "first" }));
    expect(unreadTexts()).toEqual(["first"]);

    mark();
    expect(unreadTexts()).toEqual([]);

    appendFileSync(callFile, segment({ id: "b", text: "second" }));
    expect(unreadTexts()).toEqual(["second"]);
  });

  it("recovers a branch console's origin from the open line a mark passed, so its later speech stays set aside", () => {
    const origin = { checkoutRoot: "/w/seat", defaultPort: 3000, mainWorktree: false, port: 3001 };
    const open = { atIso: "2026-09-26T04:59:00.000Z", kind: "open", model: "m", origin, sessionId: "x", voice: "v" };
    writeFileSync(callFile, `${JSON.stringify(open)}\n`);
    mark();
    appendFileSync(callFile, segment({ id: "w", text: "synthetic" }));
    const read = unwrap(readUnread({ home, name: NAME, nowIso: NOW }));
    const selection = selectUnreadWords({ read });

    expect(read.tails.map((tail) => tail.originBefore)).toEqual([origin]);
    expect(selection.words).toEqual([]);
    expect(selection.foreign).toEqual([{ callId: CALL, origin, stretches: 1 }]);
  });

  it("keeps the owner's stretch theirs when a mark passed its start and a foreign open lands before its final", () => {
    const own = { checkoutRoot: "/w/main", defaultPort: 3000, mainWorktree: true, port: 3000 };
    const foreign = { checkoutRoot: "/w/seat", defaultPort: 3000, mainWorktree: false, port: 3001 };
    const open = ({ atIso, origin }: { atIso: string; origin: typeof own }) =>
      `${JSON.stringify({ atIso, kind: "open", model: "m", origin, sessionId: "x", voice: "v" })}\n`;
    const partial = {
      atIso: "2026-09-26T05:00:00.000Z",
      final: false,
      id: "s",
      kind: "segment",
      text: "merge",
      who: "owner",
    };
    writeFileSync(callFile, `${open({ atIso: "2026-09-26T04:59:00.000Z", origin: own })}${JSON.stringify(partial)}\n`);
    mark();
    appendFileSync(callFile, open({ atIso: "2026-09-26T05:00:30.000Z", origin: foreign }));
    appendFileSync(callFile, segment({ atIso: "2026-09-26T05:00:40.000Z", id: "s", text: "merge it tonight" }));

    expect(unreadTexts()).toEqual(["merge it tonight"]);
  });

  it("calls a stretch growing since read once a snapshot of it is behind the cursor, until its call ends", () => {
    const partial = ({ text }: { text: string }) =>
      `${JSON.stringify({ atIso: "2026-09-26T05:00:00.000Z", final: false, id: "s", kind: "segment", text, who: "owner" })}\n`;
    const growing = (): readonly boolean[] =>
      selectUnreadWords({ read: unwrap(readUnread({ home, name: NAME, nowIso: NOW })) }).words.map(
        (word) => word.growingSinceRead,
      );
    writeFileSync(callFile, partial({ text: "so I was" }));
    expect(growing()).toEqual([false]);

    mark();
    appendFileSync(callFile, partial({ text: "so I was looking at" }));
    expect(growing()).toEqual([true]);

    appendFileSync(callFile, `${JSON.stringify({ atIso: "2026-09-26T05:00:05.000Z", kind: "closed", why: null })}\n`);
    expect(growing()).toEqual([false]);

    mark();
    appendFileSync(callFile, partial({ text: "so I was looking at the screen" }));
    expect(growing()).toEqual([false]);
  });

  it("shows a line appended after a mark even when the page stamped it earlier than every word already read", () => {
    writeFileSync(callFile, segment({ atIso: "2026-09-26T05:30:00.000Z", id: "a", text: "read" }));
    mark();
    appendFileSync(callFile, segment({ atIso: "2026-09-26T05:10:00.000Z", id: "late", text: "late" }));

    expect(unreadTexts()).toEqual(["late"]);
  });

  it("refuses an unterminated last line rather than skip it, and reads it once its newline lands", () => {
    const torn = `{"atIso":"2026-09-26T05:01`;
    writeFileSync(callFile, `${segment({ id: "a", text: "whole" })}${torn}`);
    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr()).toEqual(
      UnreadErrors.tailUnterminated({ bytes: Buffer.byteLength(torn), path: callFile }),
    );

    appendFileSync(callFile, `:00.000Z","final":true,"id":"b","kind":"segment","text":"landed","who":"owner"}\n`);
    expect(unreadTexts()).toEqual(["whole", "landed"]);
  });

  it("refuses a whole segment still missing its newline, past a marked frontier too", () => {
    writeFileSync(callFile, segment({ id: "a", text: "read" }));
    mark();
    const unterminated = segment({ id: "b", text: "stop the deploy" }).slice(0, -1);
    appendFileSync(callFile, unterminated);

    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr()).toEqual(
      UnreadErrors.tailUnterminated({ bytes: Buffer.byteLength(unterminated), path: callFile }),
    );
  });

  it("hands back a whole line that is not a call line, rather than skipping it", () => {
    writeFileSync(callFile, `${segment({ id: "a", text: "ok" })}{not json}\n`);
    const selection = selectUnreadWords({ read: unwrap(readUnread({ home, name: NAME, nowIso: NOW })) });

    expect(selection.unparseable).toEqual([
      { byteOffset: Buffer.byteLength(segment({ id: "a", text: "ok" })), callId: CALL, text: "{not json}" },
    ]);
  });

  it("gives a line whose bytes are not UTF-8 as hex, a JSON segment included, never a replacement character", () => {
    const segmentBytes = Buffer.concat([
      Buffer.from('{"atIso":"2026-09-26T05:00:00.000Z","final":true,"id":"s","kind":"segment","text":"a'),
      Buffer.from([0xff]),
      Buffer.from('","who":"owner"}\n'),
    ]);
    writeFileSync(callFile, Buffer.concat([Buffer.from([0xff, 0x0a]), segmentBytes]));
    const selection = selectUnreadWords({ read: unwrap(readUnread({ home, name: NAME, nowIso: NOW })) });

    expect(selection.words).toEqual([]);
    expect(selection.unparseable).toEqual([
      { byteOffset: 0, callId: CALL, text: "not UTF-8, as hex: ff" },
      { byteOffset: 2, callId: CALL, text: `not UTF-8, as hex: ${segmentBytes.subarray(0, -1).toString("hex")}` },
    ]);
  });

  it("refuses a call file shorter than the offset already read", () => {
    writeFileSync(callFile, segment({ id: "a", text: "first" }) + segment({ id: "b", text: "second" }));
    mark();
    writeFileSync(callFile, segment({ id: "a", text: "first" }));

    const first = Buffer.byteLength(segment({ id: "a", text: "first" }));
    const both = first + Buffer.byteLength(segment({ id: "b", text: "second" }));
    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr()).toEqual(
      UnreadErrors.callPrefixChanged({
        callId: CALL,
        why: `it is ${String(first)} bytes, shorter than the ${String(both)} already read`,
      }),
    );
  });

  it("refuses a call file rewritten underneath the cursor at the same length", () => {
    writeFileSync(callFile, segment({ id: "a", text: "first" }));
    mark();
    writeFileSync(callFile, segment({ id: "a", text: "FIRST" }));

    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr().code).toBe("CALL_PREFIX_CHANGED");
  });

  it("refuses an EARLIER line rewritten to the same length while the last line read is unchanged", () => {
    writeFileSync(callFile, segment({ id: "a", text: "first" }) + segment({ id: "b", text: "second" }));
    mark();
    writeFileSync(callFile, segment({ id: "a", text: "FIRST" }) + segment({ id: "b", text: "second" }));

    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr()).toEqual(
      UnreadErrors.callPrefixChanged({
        callId: CALL,
        why: `a byte before offset ${String(statSync(callFile).size)} is not what was read`,
      }),
    );
  });

  it("hands back a whitespace-only line past the cursor as unparseable, never skips it", () => {
    writeFileSync(callFile, segment({ id: "a", text: "first" }));
    mark();
    appendFileSync(callFile, "   \n");
    const selection = selectUnreadWords({ read: unwrap(readUnread({ home, name: NAME, nowIso: NOW })) });

    expect(selection.unparseable).toEqual([
      { byteOffset: Buffer.byteLength(segment({ id: "a", text: "first" })), callId: CALL, text: "   " },
    ]);
  });

  it("hands back a long unparseable line whole, since a mark counts all of it read", () => {
    const long = `{"kind":"segment","atIso":"bad","text":"${"A".repeat(2100)}DO-NOT-DELETE"}`;
    writeFileSync(callFile, `${long}\n`);
    const selection = selectUnreadWords({ read: unwrap(readUnread({ home, name: NAME, nowIso: NOW })) });

    expect(selection.unparseable.map((line) => line.text)).toEqual([long]);
  });

  it("hands back a segment longer than the call store's cap whole, never as the cut text the schema keeps", () => {
    const over = segment({ id: "a", text: `${"A".repeat(CALL_TEXT_CHARS)}SECRET` });
    writeFileSync(callFile, over);
    const selection = selectUnreadWords({ read: unwrap(readUnread({ home, name: NAME, nowIso: NOW })) });

    expect(selection.words).toEqual([]);
    expect(selection.unparseable.map((line) => line.text)).toEqual([over.trimEnd()]);
  });

  it("hands back a segment whose text is a lone surrogate as its raw line, which prints exactly as stored", () => {
    const line = `{"atIso":"2026-09-26T05:00:00.000Z","final":true,"id":"s","kind":"segment","text":"\\ud800","who":"owner"}`;
    writeFileSync(callFile, `${line}\n`);
    const selection = selectUnreadWords({ read: unwrap(readUnread({ home, name: NAME, nowIso: NOW })) });

    expect(selection.words).toEqual([]);
    expect(selection.unparseable.map((unparsed) => unparsed.text)).toEqual([line]);
  });

  it("parses a segment exactly at the cap as a word", () => {
    writeFileSync(callFile, segment({ id: "a", text: "A".repeat(CALL_TEXT_CHARS) }));

    expect(unreadTexts()).toEqual(["A".repeat(CALL_TEXT_CHARS)]);
  });

  it("ignores a file that is not named for a call", () => {
    writeFileSync(join(home, "talk", "calls", "notes.jsonl"), segment({ id: "a", text: "not a call" }));

    expect(unwrap(readUnread({ home, name: NAME, nowIso: NOW })).tails).toEqual([]);
  });

  it("refuses a call the cursor has read whose file is gone, rather than reading it as nothing new", () => {
    writeFileSync(callFile, segment({ id: "a", text: "first" }));
    mark();
    rmSync(callFile);
    const read = readUnread({ home, name: NAME, nowIso: NOW });

    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr()).toEqual(UnreadErrors.callFileGone({ callId: CALL }));
  });

  it("refuses a call the index records whose file is gone before any reader saw it", () => {
    unwrap(
      appendCallEntries({
        callId: CALL,
        entries: [JSON.parse(segment({ id: "a", text: "never seen" }))],
        home,
        ...WRITER,
      }),
    );
    rmSync(callFile);

    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr()).toEqual(
      UnreadErrors.callFileGone({ callId: CALL }),
    );
  });

  it("indexes a call once, on its first line, and reads an indexed call whose file is there", () => {
    const entries = [JSON.parse(segment({ id: "a", text: "one" })), JSON.parse(segment({ id: "b", text: "two" }))];
    unwrap(appendCallEntries({ callId: CALL, entries: entries.slice(0, 1), home, ...WRITER }));
    unwrap(appendCallEntries({ callId: CALL, entries: entries.slice(1), home, ...WRITER }));

    expect(readFileSync(callIndexPath({ home }), "utf8")).toBe(`${CALL}\n`);
    expect(unreadTexts()).toEqual(["one", "two"]);
  });

  it("refuses the same when the whole calls directory is gone", () => {
    writeFileSync(callFile, segment({ id: "a", text: "first" }));
    mark();
    rmSync(join(home, "talk", "calls"), { force: true, recursive: true });

    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr().code).toBe("CALL_FILE_GONE");
  });
});

describe("a gone call whose loss is quarantined", () => {
  const OTHER = "a0000041-0000-4000-8000-000000000044";
  const otherFile = (): string => join(home, "talk", "calls", `${OTHER}.jsonl`);
  const REASON = "e2e test call removed by hand; synthetic";
  const accept = ({ callId }: { callId: string }): void => {
    unwrap(quarantineCall({ callId, home, lockWaitMs: 0, nowIso: NOW, reason: REASON, session: null, ...WRITER }));
  };

  it("is read past, named under `quarantined`, while the calls still there read as before", () => {
    writeFileSync(callFile, segment({ id: "a", text: "first" }));
    writeFileSync(otherFile(), segment({ id: "a", text: "gone" }));
    mark();
    rmSync(otherFile());
    accept({ callId: OTHER });
    appendFileSync(callFile, segment({ id: "b", text: "second" }));
    const read = unwrap(readUnread({ home, name: NAME, nowIso: NOW }));

    expect(read.quarantined).toEqual([{ atIso: NOW, callId: OTHER, reason: REASON, session: null }]);
    expect(selectUnreadWords({ read }).words.map((word) => word.text)).toEqual(["second"]);
  });

  it("still refuses a second gone call the ledger does not accept", () => {
    writeFileSync(callFile, segment({ id: "a", text: "one" }));
    writeFileSync(otherFile(), segment({ id: "a", text: "two" }));
    mark();
    rmSync(otherFile());
    accept({ callId: OTHER });
    rmSync(callFile);

    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr()).toEqual(
      UnreadErrors.callFileGone({ callId: CALL }),
    );
  });

  it("refuses every read past a gone call while the ledger is damaged", () => {
    writeFileSync(callFile, segment({ id: "a", text: "one" }));
    mark();
    rmSync(callFile);
    accept({ callId: CALL });
    appendFileSync(callQuarantinePath({ home }), "junk\n");

    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr().code).toBe("QUARANTINE_UNREADABLE");
  });

  it.each([
    ["a symlink to a real call file", () => symlinkSync(otherFile(), callFile)],
    ["a directory", () => mkdirSync(callFile)],
  ])("refuses again once its path holds %s, never reading past something that is there", (_label, place) => {
    writeFileSync(callFile, segment({ id: "a", text: "one" }));
    writeFileSync(otherFile(), segment({ id: "a", text: "two" }));
    mark();
    rmSync(callFile);
    accept({ callId: CALL });
    place();

    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr()).toEqual(
      UnreadErrors.callFileGone({ callId: CALL }),
    );
  });

  it("skips nothing a later append to a quarantined call writes: a read before it lands moves no frontier, so the next prints it", () => {
    unwrap(
      appendCallEntries({ callId: OTHER, entries: [JSON.parse(segment({ id: "a", text: "x" }))], home, ...WRITER }),
    );
    rmSync(otherFile());
    accept({ callId: OTHER });
    // The read in the window after the index line and before the file's first line: it goes past, and is marked.
    mark();
    writeFileSync(otherFile(), segment({ id: "b", text: "landed after" }));

    expect(unreadTexts()).toEqual(["landed after"]);
  });

  it("refuses rather than skip when a quarantined call the cursor had read reappears shorter than its frontier", () => {
    writeFileSync(otherFile(), segment({ id: "a", text: "read once, before it was removed" }));
    mark();
    rmSync(otherFile());
    accept({ callId: OTHER });
    mark();
    writeFileSync(otherFile(), segment({ id: "b", text: "new" }));

    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr().code).toBe("CALL_PREFIX_CHANGED");
  });

  it("refuses any append to a quarantined call, so no line can land there and be removed again unread", () => {
    const line = (): CallEntry[] => [JSON.parse(segment({ id: "b", text: "never written" }))];
    unwrap(
      appendCallEntries({ callId: OTHER, entries: [JSON.parse(segment({ id: "a", text: "x" }))], home, ...WRITER }),
    );
    rmSync(otherFile());
    accept({ callId: OTHER });
    mark();

    expect(appendCallEntries({ callId: OTHER, entries: line(), home, ...WRITER })._unsafeUnwrapErr()).toEqual(
      TalkErrors.callQuarantined({ callId: OTHER }),
    );
    expect(existsSync(otherFile())).toBe(false);
    expect(unwrap(readUnread({ home, name: NAME, nowIso: NOW })).quarantined.map((row) => row.callId)).toEqual([OTHER]);
  });

  it.each([
    ["is gone", () => rmSync(join(home, "talk", "calls"), { recursive: true })],
    [
      "is a dangling link",
      () => {
        rmSync(join(home, "talk", "calls"), { recursive: true });
        symlinkSync(join(home, "nowhere"), join(home, "talk", "calls"));
      },
    ],
  ])(
    "accepts no quarantine while the calls directory itself %s, since no absence in it is provable",
    (_label, swap) => {
      writeFileSync(callFile, segment({ id: "a", text: "one" }));
      mark();
      rmSync(callFile);
      accept({ callId: CALL });
      swap();

      expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr()).toEqual(
        UnreadErrors.callFileGone({ callId: CALL }),
      );
    },
  );

  it("names no quarantine whose call file is back, and reads that file", () => {
    writeFileSync(callFile, segment({ id: "a", text: "one" }));
    mark();
    rmSync(callFile);
    accept({ callId: CALL });
    writeFileSync(callFile, `${segment({ id: "a", text: "one" })}${segment({ id: "b", text: "restored" })}`);
    const read = unwrap(readUnread({ home, name: NAME, nowIso: NOW }));

    expect(read.quarantined).toEqual([]);
    expect(selectUnreadWords({ read }).words.map((word) => word.text)).toEqual(["restored"]);
  });
});

describe("a line read in parts", () => {
  const huge = `${"x".repeat(30_000)}\n`;
  const lineSha256 = `sha256:${createHash("sha256").update("x".repeat(30_000)).digest("hex")}`;
  const EMPTY = `sha256:${createHash("sha256").digest("hex")}`;

  it.each([
    ["as many parts as the line has", 6],
    ["more parts than the line has", 999],
  ])("refuses a cursor recording %s printed, rather than print only the last and mark the line", (_label, printed) => {
    writeFileSync(callFile, huge);
    const cursor = {
      calls: { [CALL]: { offset: 0, part: { lineSha256, printed }, prefixSha256: EMPTY } },
      recordedAtIso: NOW,
    };
    unwrap(writeUnreadCursor({ cursor, home, name: NAME }));

    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr()).toEqual(
      UnreadErrors.partBeyondLine({ callId: CALL, of: 6, printed }),
    );
  });

  it("reads a cursor recording one part fewer than the line has", () => {
    writeFileSync(callFile, huge);
    const cursor = {
      calls: { [CALL]: { offset: 0, part: { lineSha256, printed: 5 }, prefixSha256: EMPTY } },
      recordedAtIso: NOW,
    };
    unwrap(writeUnreadCursor({ cursor, home, name: NAME }));

    expect(unwrap(readUnread({ home, name: NAME, nowIso: NOW })).tails.map((one) => one.lines.length)).toEqual([1]);
  });

  describe("bound to a later snapshot of the stretch", () => {
    const first = segment({ id: "a", text: "go ahead" });
    const other = segment({ id: "b", text: "Cool" });
    // Two parts long, so a cursor recording one printed is one a mark writes.
    const later = segment({ id: "a", text: `go ahead and land it${" now".repeat(2000)}` });
    const shaOf = ({ line }: { line: string }): string =>
      `sha256:${createHash("sha256").update(line.slice(0, -1)).digest("hex")}`;
    const boundAt = ({ lineOffset, line }: { lineOffset: number; line: string }): void => {
      const part = { lineOffset, lineSha256: shaOf({ line }), printed: 1 };
      const cursor = { calls: { [CALL]: { offset: 0, part, prefixSha256: EMPTY } }, recordedAtIso: NOW };
      unwrap(writeUnreadCursor({ cursor, home, name: NAME }));
    };

    it("reads one whose every line before it is a snapshot it prints", () => {
      writeFileSync(callFile, `${first}${later}`);
      boundAt({ line: later, lineOffset: Buffer.byteLength(first) });

      expect(unwrap(readUnread({ home, name: NAME, nowIso: NOW })).tails.map((one) => one.lines.length)).toEqual([2]);
    });

    it("refuses one with another stretch of the owner's before it, which its parts never print", () => {
      writeFileSync(callFile, `${first}${other}${later}`);
      boundAt({ line: later, lineOffset: Buffer.byteLength(`${first}${other}`) });

      expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr()).toEqual(
        UnreadErrors.callPrefixChanged({
          callId: CALL,
          why: "a line between offset 0 and the line read in parts is not one that line prints",
        }),
      );
    });

    it("refuses one whose offset is not where a line begins", () => {
      writeFileSync(callFile, `${first}${later}`);
      boundAt({ line: later, lineOffset: 3 });

      expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr()).toEqual(
        UnreadErrors.callPrefixChanged({
          callId: CALL,
          why: "the line at offset 3, read in parts, is not the one its first parts were cut from",
        }),
      );
    });
  });
});

describe("a read's frontier per line", () => {
  it("records each whole line's frontier, so a mark through part of a read moves only past that part", () => {
    writeFileSync(callFile, segment({ id: "a", text: "one" }));
    mark();
    appendFileSync(callFile, ["b", "c", "d"].map((id) => segment({ id, text: id })).join(""));
    const read = unwrap(readUnread({ home, name: NAME, nowIso: NOW }));
    const [tail] = read.tails;
    const aEnd = Buffer.byteLength(segment({ id: "a", text: "one" }));
    const bEnd = aEnd + Buffer.byteLength(segment({ id: "b", text: "b" }));

    expect(tail!.start!.offset).toBe(aEnd);
    expect(tail!.lines.map((line) => line.after.offset)).toEqual([bEnd, bEnd * 2 - aEnd, bEnd * 3 - aEnd * 2]);

    const cut = { ...read, tails: [{ ...tail!, lines: tail!.lines.slice(0, 1) }] };
    unwrap(writeUnreadCursor({ cursor: advancedCursor({ read: cut, recordedAtIso: NOW }), home, name: NAME }));
    expect(unreadTexts()).toEqual(["c", "d"]);
  });
});

describe("finality across the frontier", () => {
  const partial = ({ id, text }: { id: string; text: string }): string =>
    `${JSON.stringify({ atIso: "2026-09-26T05:59:59.000Z", final: false, id, kind: "segment", text, who: "owner" })}\n`;

  it("reads a partial landing after a mark of its segment's final as finished, printing its own text", () => {
    writeFileSync(callFile, segment({ id: "a", text: "please do nothing" }));
    mark();
    appendFileSync(callFile, partial({ id: "a", text: "please do not" }));
    const words = selectUnreadWords({ read: unwrap(readUnread({ home, name: NAME, nowIso: NOW })) }).words;

    expect(words.map((word) => [word.text, word.final])).toEqual([["please do not", true]]);
  });

  it("keeps a stretch still being spoken live when only its partials were read", () => {
    writeFileSync(callFile, partial({ id: "a", text: "please" }));
    mark();
    appendFileSync(callFile, partial({ id: "a", text: "please wait" }));
    const words = selectUnreadWords({ read: unwrap(readUnread({ home, name: NAME, nowIso: NOW })) }).words;

    expect(words.map((word) => [word.text, word.final])).toEqual([["please wait", false]]);
  });
});

describe("the call index", () => {
  it.each([
    ["a line of junk", `${CALL}\njunk\n`, 2],
    ["a truncated id", `${CALL.slice(0, 20)}\n`, 1],
    ["a blank line between ids", `${CALL}\n\n${CALL}\n`, 2],
  ])("refuses %s rather than read it as naming fewer calls", (_label, index, lineNumber) => {
    writeFileSync(callFile, segment({ id: "a", text: "one" }));
    writeFileSync(callIndexPath({ home }), index);

    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr()).toEqual(
      UnreadErrors.callIndexMalformed({ lineNumber, path: callIndexPath({ home }) }),
    );
  });

  it.each([
    ["an empty index", ""],
    ["a duplicated id", `${CALL}\n${CALL}\n`],
  ])("reads %s", (_label, index) => {
    writeFileSync(callFile, segment({ id: "a", text: "one" }));
    writeFileSync(callIndexPath({ home }), index);

    expect(unreadTexts()).toEqual(["one"]);
  });

  it("refuses a last id whose newline has not landed rather than read the index as naming fewer calls", () => {
    writeFileSync(callFile, segment({ id: "a", text: "one" }));
    writeFileSync(callIndexPath({ home }), `${CALL}\n${CALL.slice(0, 9)}`);

    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr()).toEqual(
      UnreadErrors.tailUnterminated({ bytes: 9, path: callIndexPath({ home }) }),
    );
  });
});

describe("a frontier inside a line", () => {
  it("is refused, never read from mid-line with the bytes before it counted read unprinted", () => {
    writeFileSync(callFile, segment({ id: "s", text: "secret" }));
    const EMPTY = `sha256:${createHash("sha256").digest("hex")}`;
    unwrap(
      writeUnreadCursor({
        cursor: { calls: { [CALL]: { offset: 1, prefixSha256: EMPTY } }, recordedAtIso: NOW },
        home,
        name: NAME,
      }),
    );

    expect(readUnread({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr()).toEqual(
      UnreadErrors.callPrefixChanged({
        callId: CALL,
        why: "offset 1 is not the end of a line, which is all a mark records",
      }),
    );
  });
});

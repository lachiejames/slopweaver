/**
 * `talk cursor-retire` over a throwaway home: a cursor written by the real mark path, then call files rewritten under
 * it so the ordinary `talk unread` read refuses with CALL_PREFIX_CHANGED. Only that (or an unparseable cursor) is
 * retired; a healthy, absent or gone-file cursor is refused; an apply moves the unchanged file beside a receipt, and
 * nothing that scans the cursors directory reads the retired one as a cursor.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok, unwrap } from "../../../lib/result.js";
import { quarantineCall } from "../../../talk/callQuarantine.js";
import { CallQuarantineErrors } from "../../../talk/callQuarantineErrors.js";
import {
  cursorRetireApplyCommand,
  cursorRetireNextSteps,
  cursorRetireReceipt,
  retiredCursorDir,
  retireVerdict,
} from "../../../talk/cursorRetire.js";
import { CursorRetireErrors } from "../../../talk/cursorRetireErrors.js";
import { applyCursorRetire, assessCursorRetire } from "../../../talk/cursorRetireStore.js";
import { readUnreadCursor, unreadCursorPath, writeUnreadCursor } from "../../../talk/unreadCursorStore.js";
import { UnreadErrors } from "../../../talk/unreadErrors.js";
import { readUnread } from "../../../talk/unreadRead.js";
import { advancedCursor } from "../../../talk/unreadWords.js";

const CALL_A = "a0000006-0000-4000-8000-000000000007";
const CALL_B = "a0000008-0000-4000-8000-000000000009";
const CALL_C = "a0000011-0000-4000-8000-000000000012";
const NOW = "2026-09-26T06:00:00.000Z";
const NAME = "supervisor";
const REASON = "a carry sanitiser rewrote names inside the call files";

const segment = ({ id, text }: { id: string; text: string }): string =>
  `${JSON.stringify({ atIso: "2026-09-26T05:00:00.000Z", final: true, id, kind: "segment", text, who: "owner" })}\n`;

let home = "";

const callFile = ({ callId }: { callId: string }): string => join(home, "talk", "calls", `${callId}.jsonl`);

const cursorFile = (): string => unwrap(unreadCursorPath({ home, name: NAME }));

const sha256Of = ({ path }: { path: string }): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Read, then mark exactly what that read saw — the two halves `talk unread --mark` performs. */
const mark = (): void => {
  const read = unwrap(readUnread({ home, name: NAME, nowIso: NOW }));
  unwrap(writeUnreadCursor({ cursor: advancedCursor({ read, recordedAtIso: NOW }), home, name: NAME }));
};

/** Rewrite one call file's already-read line, as the carry sanitiser did. */
const rewrite = ({ callId }: { callId: string }): void => {
  writeFileSync(callFile({ callId }), segment({ id: "s-1", text: "FIXTURE rewritten words of another length" }));
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cursor-retire-"));
  mkdirSync(join(home, "talk", "calls"), { recursive: true });
  for (const callId of [CALL_A, CALL_B, CALL_C]) {
    writeFileSync(callFile({ callId }), segment({ id: "s-1", text: "first" }));
  }
  mark();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("retireVerdict", () => {
  it.each([
    ["CALL_PREFIX_CHANGED", UnreadErrors.callPrefixChanged({ callId: CALL_A, why: "rewritten" })],
    ["CURSOR_MALFORMED", UnreadErrors.cursorMalformed({ path: "/c.json", why: "bad" })],
  ] as const)("retires a cursor talk unread refuses with %s", (cause, error) => {
    expect(unwrap(retireVerdict({ path: "/c.json", read: err(error) }))).toEqual({ cause, why: error.message });
  });

  it("refuses a cursor talk unread reads", () => {
    const read = ok({ bootstrapFloorIso: undefined, cursor: undefined, quarantined: [], tails: [] });
    expect(retireVerdict({ path: "/c.json", read })._unsafeUnwrapErr()).toEqual(
      CursorRetireErrors.healthy({ path: "/c.json" }),
    );
  });

  it("refuses a gone call file, which is talk quarantine's", () => {
    const gone = UnreadErrors.callFileGone({ callId: CALL_A });
    expect(retireVerdict({ path: "/c.json", read: err(gone) })._unsafeUnwrapErr()).toEqual(
      CursorRetireErrors.notRetirable({ unreadCode: "CALL_FILE_GONE", why: gone.message }),
    );
  });
});

describe("the commands it prints", () => {
  it("names the supervisor cursor and the ambient home by omission", () => {
    expect(cursorRetireApplyCommand({ home: undefined, name: NAME, sourceSha256: "ab" })).toBe(
      'slopweaver talk cursor-retire --apply --source-sha256 ab --reason "<what rewrote the call files>"',
    );
    expect(cursorRetireNextSteps({ home: undefined, name: NAME })).toEqual([
      "slopweaver talk unread",
      "slopweaver talk unread --mark --adopt",
    ]);
  });

  it("repeats another reader and a given home, quoting a home with a space", () => {
    expect(cursorRetireNextSteps({ home: "/tmp/a home", name: "voice" })).toEqual([
      'slopweaver talk unread --cursor voice --home "/tmp/a home"',
      'slopweaver talk unread --cursor voice --home "/tmp/a home" --mark --adopt',
    ]);
  });
});

describe("assessCursorRetire", () => {
  it("refuses a healthy cursor", () => {
    expect(assessCursorRetire({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr()).toEqual(
      CursorRetireErrors.healthy({ path: cursorFile() }),
    );
  });

  it("refuses when there is no cursor", () => {
    expect(assessCursorRetire({ home, name: "voice", nowIso: NOW })._unsafeUnwrapErr()).toEqual(
      CursorRetireErrors.absent({ path: unwrap(unreadCursorPath({ home, name: "voice" })) }),
    );
  });

  it("refuses a cursor whose call file is gone, leaving it to talk quarantine", () => {
    rmSync(callFile({ callId: CALL_B }));
    expect(assessCursorRetire({ home, name: NAME, nowIso: NOW })._unsafeUnwrapErr().code).toBe(
      "CURSOR_RETIRE_NOT_RETIRABLE",
    );
  });

  it("counts every call that fails its prefix proof, not only the first, and hashes the cursor file", () => {
    rewrite({ callId: CALL_A });
    rewrite({ callId: CALL_C });
    const assessment = unwrap(assessCursorRetire({ home, name: NAME, nowIso: NOW }));

    expect(assessment.cause).toBe("CALL_PREFIX_CHANGED");
    expect(assessment.cursorCallCount).toBe(3);
    expect(assessment.failingCallIds).toEqual([CALL_A, CALL_C]);
    expect(assessment.sourceSha256).toBe(sha256Of({ path: cursorFile() }));
  });

  it("retires a cursor that will not parse, counting no calls", () => {
    writeFileSync(cursorFile(), '{"calls":{}}');
    const assessment = unwrap(assessCursorRetire({ home, name: NAME, nowIso: NOW }));

    expect(assessment.cause).toBe("CURSOR_MALFORMED");
    expect(assessment.cursorCallCount).toBe(null);
    expect(assessment.failingCallIds).toEqual([]);
  });
});

describe("applyCursorRetire", () => {
  it("moves the unchanged cursor beside a receipt in owner-only modes, and talk unread then reads as a first read", () => {
    rewrite({ callId: CALL_A });
    const before = readFileSync(cursorFile(), "utf8");
    const assessment = unwrap(assessCursorRetire({ home, name: NAME, nowIso: NOW }));
    const applied = unwrap(
      applyCursorRetire({
        home,
        name: NAME,
        nowIso: NOW,
        reason: REASON,
        session: "session-1",
        sourceSha256: assessment.sourceSha256,
      }),
    );
    const dir = join(home, "talk", "unread-cursors", "retired", "20260926T060000000Z-supervisor");

    expect(retiredCursorDir({ home, name: NAME, nowIso: NOW })).toBe(dir);
    expect(applied.retiredPath).toBe(join(dir, "cursor.json"));
    expect(applied.receiptPath).toBe(join(dir, "receipt.json"));
    expect(existsSync(cursorFile())).toBe(false);
    expect(readFileSync(applied.retiredPath, "utf8")).toBe(before);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(applied.retiredPath).mode & 0o777).toBe(0o600);
    expect(statSync(applied.receiptPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(applied.receiptPath, "utf8"))).toEqual({
      cause: "CALL_PREFIX_CHANGED",
      cursorCallCount: 3,
      failingCallCount: 1,
      from: cursorFile(),
      name: NAME,
      reason: REASON,
      retiredAtIso: NOW,
      session: "session-1",
      sourceSha256: assessment.sourceSha256,
    });
    expect(applied.receipt).toEqual(
      cursorRetireReceipt({ assessment, nowIso: NOW, reason: REASON, session: "session-1" }),
    );
    const read = unwrap(readUnread({ home, name: NAME, nowIso: NOW }));
    expect(read.cursor).toBe(undefined);
    expect(read.tails.map((tail) => tail.callId)).toEqual([CALL_A, CALL_B, CALL_C]);
  });

  it("refuses a digest that is not the cursor's, and moves nothing", () => {
    rewrite({ callId: CALL_A });
    const actual = sha256Of({ path: cursorFile() });
    const stale = "0".repeat(64);
    const refused = applyCursorRetire({
      home,
      name: NAME,
      nowIso: NOW,
      reason: REASON,
      session: null,
      sourceSha256: stale,
    });

    expect(refused._unsafeUnwrapErr()).toEqual(CursorRetireErrors.sourceMoved({ actual, expected: stale }));
    expect(sha256Of({ path: cursorFile() })).toBe(actual);
    expect(existsSync(join(home, "talk", "unread-cursors", "retired"))).toBe(false);
  });

  it("refuses a healthy cursor even with its own digest", () => {
    const own = sha256Of({ path: cursorFile() });
    const refused = applyCursorRetire({
      home,
      name: NAME,
      nowIso: NOW,
      reason: REASON,
      session: null,
      sourceSha256: own,
    });

    expect(refused._unsafeUnwrapErr()).toEqual(CursorRetireErrors.healthy({ path: cursorFile() }));
    expect(existsSync(cursorFile())).toBe(true);
  });

  it("leaves the retired cursor unread by the quarantine's cursor scan", () => {
    rewrite({ callId: CALL_A });
    const assessment = unwrap(assessCursorRetire({ home, name: NAME, nowIso: NOW }));
    const applied = unwrap(
      applyCursorRetire({
        home,
        name: NAME,
        nowIso: NOW,
        reason: REASON,
        session: null,
        sourceSha256: assessment.sourceSha256,
      }),
    );
    rmSync(callFile({ callId: CALL_B }));
    // The retired cursor still names the gone call, so only a scan that read it would know the call.
    expect(Object.keys(JSON.parse(readFileSync(applied.retiredPath, "utf8")).calls)).toContain(CALL_B);
    expect(unwrap(readUnreadCursor({ home, name: NAME }))).toBe(undefined);

    const quarantined = quarantineCall({ callId: CALL_B, home, nowIso: NOW, reason: "gone", session: null });
    expect(quarantined._unsafeUnwrapErr()).toEqual(CallQuarantineErrors.callUnknown({ callId: CALL_B }));
  });
});

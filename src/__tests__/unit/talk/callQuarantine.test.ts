/**
 * `talk quarantine`'s store, over a throwaway home: only a call a read would refuse, whose path holds nothing at all,
 * is accepted — once, in a 0600 ledger that is read strictly — and nothing is written on any refusal.
 */
import {
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
import { CallQuarantineErrors } from "../../../talk/callQuarantineErrors.js";
import { callQuarantinePath, readCallQuarantine } from "../../../talk/callQuarantineLedger.js";
import { appendCallEntries } from "../../../talk/callStore.js";
import { TalkErrors } from "../../../talk/errors.js";
import { writeUnreadCursor } from "../../../talk/unreadCursorStore.js";

const CALL = "a0000035-0000-4000-8000-000000000038";
/** A second call, which a damaged ledger naming only `CALL` does not close. */
const OTHER_CALL = "a0000041-0000-4000-8000-000000000044";
const NOW = "2026-10-26T08:00:00.000Z";
const REASON = "e2e test call removed by hand; synthetic, not the owner's words";
/** The locking process, running, so no `ps` is spawned to ask. */
const WRITER = { pid: 101, startOf: () => ({ running: true, start: "t101" }) };

let home = "";
let callFile = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "talk-quarantine-"));
  callFile = join(home, "talk", "calls", `${CALL}.jsonl`);
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A call the index records, its file then removed — the shape of a call whose file is gone. */
const indexedThenRemoved = (): void => {
  const entry = {
    atIso: "2026-10-26T07:00:00.000Z",
    final: true,
    id: "a",
    kind: "segment",
    text: "x",
    who: "owner",
  } as const;
  unwrap(appendCallEntries({ callId: CALL, entries: [entry], home, ...WRITER }));
  rmSync(callFile);
};

const quarantine = ({ callId = CALL, reason = REASON }: { callId?: string; reason?: string } = {}) =>
  quarantineCall({ callId, home, lockWaitMs: 0, nowIso: NOW, reason, session: "s-1", ...WRITER });

describe("quarantineCall", () => {
  it("accepts an indexed call whose file is gone, writing exactly one row to a 0600 ledger", () => {
    indexedThenRemoved();
    const written = unwrap(quarantine());
    const row = { atIso: NOW, callId: CALL, reason: REASON, session: "s-1" };

    expect(written).toEqual({ path: callQuarantinePath({ home }), row });
    expect(written.path).toBe(join(home, "talk", "call-quarantine.jsonl"));
    expect(readFileSync(written.path, "utf8")).toBe(`${JSON.stringify(row)}\n`);
    expect(statSync(written.path).mode & 0o777).toBe(0o600);
    expect(unwrap(readCallQuarantine({ home }))).toEqual([row]);
  });

  it("accepts a call only a reader's cursor names", () => {
    const frontier = { offset: 0, prefixSha256: "sha256:x" };
    unwrap(
      writeUnreadCursor({ cursor: { calls: { [CALL]: frontier }, recordedAtIso: NOW }, home, name: "supervisor" }),
    );

    expect(unwrap(quarantine()).row.callId).toBe(CALL);
  });

  it("refuses a row its own reader would refuse — a reason or session of U+0085 only — and writes no ledger", () => {
    indexedThenRemoved();
    const nel = "\u0085";
    const withSession = quarantineCall({
      callId: CALL,
      home,
      lockWaitMs: 0,
      nowIso: NOW,
      reason: REASON,
      session: nel,
      ...WRITER,
    });

    expect([quarantine({ reason: nel })._unsafeUnwrapErr(), withSession._unsafeUnwrapErr()]).toEqual([
      CallQuarantineErrors.reasonEmpty(),
      CallQuarantineErrors.rowInvalid({ why: "session is blank" }),
    ]);
    expect(existsSync(callQuarantinePath({ home }))).toBe(false);
  });

  it("records any session id grantSessionId resolves, however it is spelled, and reads it back", () => {
    indexedThenRemoved();
    const session = "abc/def thread";
    const written = unwrap(
      quarantineCall({ callId: CALL, home, lockWaitMs: 0, nowIso: NOW, reason: REASON, session, ...WRITER }),
    );

    expect(written.row.session).toBe(session);
    expect(unwrap(readCallQuarantine({ home }))).toEqual([{ atIso: NOW, callId: CALL, reason: REASON, session }]);
  });

  it("refuses a call nothing names, and writes no ledger", () => {
    expect(quarantine()._unsafeUnwrapErr()).toEqual(CallQuarantineErrors.callUnknown({ callId: CALL }));
    expect(existsSync(callQuarantinePath({ home }))).toBe(false);
  });

  it.each([
    ["a file, however damaged", () => writeFileSync(callFile, "{torn")],
    ["a directory", () => mkdirSync(callFile)],
    ["a dangling symlink", () => symlinkSync(join(home, "nowhere"), callFile)],
  ])("refuses a path holding %s, and writes no ledger", (_label, place) => {
    indexedThenRemoved();
    place();

    expect(quarantine()._unsafeUnwrapErr()).toEqual(CallQuarantineErrors.callPresent({ callId: CALL, path: callFile }));
    expect(existsSync(callQuarantinePath({ home }))).toBe(false);
  });

  it("refuses a second quarantine of the same call, leaving the first row the only witness", () => {
    indexedThenRemoved();
    unwrap(quarantine());

    expect(quarantine({ reason: "another story" })._unsafeUnwrapErr()).toEqual(
      CallQuarantineErrors.already({ atIso: NOW, callId: CALL }),
    );
    expect(unwrap(readCallQuarantine({ home })).map((row) => row.reason)).toEqual([REASON]);
  });

  it("refuses an id that is not a call id, and a blank reason", () => {
    expect(quarantine({ callId: "../x" })._unsafeUnwrapErr()).toEqual(
      CallQuarantineErrors.callIdInvalid({ callId: "../x" }),
    );
    expect(quarantine({ reason: "  " })._unsafeUnwrapErr()).toEqual(CallQuarantineErrors.reasonEmpty());
  });

  it("refuses when the ledger it would append to is damaged", () => {
    indexedThenRemoved();
    writeFileSync(callQuarantinePath({ home }), "junk\n");

    expect(quarantine()._unsafeUnwrapErr().code).toBe("QUARANTINE_LEDGER_MALFORMED");
    expect(readFileSync(callQuarantinePath({ home }), "utf8")).toBe("junk\n");
  });
});

describe("readCallQuarantine", () => {
  const row = `${JSON.stringify({ atIso: NOW, callId: CALL, reason: REASON, session: null })}\n`;

  beforeEach(() => {
    mkdirSync(join(home, "talk"), { recursive: true });
  });

  it("reads no ledger as accepting nothing", () => {
    expect(unwrap(readCallQuarantine({ home }))).toEqual([]);
  });

  it("reads an empty ledger as accepting nothing", () => {
    writeFileSync(callQuarantinePath({ home }), "");
    expect(unwrap(readCallQuarantine({ home }))).toEqual([]);
  });

  it("reads a row with no session named", () => {
    writeFileSync(callQuarantinePath({ home }), row);
    expect(unwrap(readCallQuarantine({ home }))).toEqual([{ atIso: NOW, callId: CALL, reason: REASON, session: null }]);
  });

  it("keeps a call a damaged ledger still names closed to appends, and leaves every other call writing", () => {
    writeFileSync(callQuarantinePath({ home }), `${row}junk\n`);
    const said = [{ atIso: NOW, final: true, id: "a", kind: "segment", text: "one", who: "owner" }] as const;

    expect(readCallQuarantine({ home })._unsafeUnwrapErr().code).toBe("QUARANTINE_LEDGER_MALFORMED");
    expect(appendCallEntries({ callId: CALL, entries: said, home, ...WRITER })._unsafeUnwrapErr()).toEqual(
      TalkErrors.callQuarantined({ callId: CALL }),
    );
    expect(existsSync(callFile)).toBe(false);
    expect(unwrap(appendCallEntries({ callId: OTHER_CALL, entries: said, home, ...WRITER })).appended).toBe(1);
  });

  it("refuses a gone indexed call while the ledger cannot be read at all, and lets a new or present call write", () => {
    const said = [{ atIso: NOW, final: true, id: "a", kind: "segment", text: "one", who: "owner" }] as const;
    const third = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    unwrap(appendCallEntries({ callId: CALL, entries: said, home, ...WRITER }));
    unwrap(appendCallEntries({ callId: third, entries: said, home, ...WRITER }));
    rmSync(callFile);
    mkdirSync(callQuarantinePath({ home }));
    const later = [{ ...said[0], id: "b" }];

    expect(appendCallEntries({ callId: CALL, entries: later, home, ...WRITER })._unsafeUnwrapErr()).toEqual(
      TalkErrors.callQuarantined({ callId: CALL }),
    );
    expect(existsSync(callFile)).toBe(false);
    expect([
      unwrap(appendCallEntries({ callId: OTHER_CALL, entries: later, home, ...WRITER })).appended,
      unwrap(appendCallEntries({ callId: third, entries: later, home, ...WRITER })).appended,
    ]).toEqual([1, 1]);
  });

  it("answers an empty batch, and one repeating a writeId, for a closed call as closed", () => {
    writeFileSync(callQuarantinePath({ home }), row);
    const said = {
      atIso: NOW,
      final: true,
      id: "a",
      kind: "segment",
      text: "one",
      who: "owner",
      writeId: "w",
    } as const;

    expect([
      appendCallEntries({ callId: CALL, entries: [], home, ...WRITER })._unsafeUnwrapErr(),
      appendCallEntries({ callId: CALL, entries: [said, { ...said, id: "b" }], home, ...WRITER })._unsafeUnwrapErr(),
    ]).toEqual([TalkErrors.callQuarantined({ callId: CALL }), TalkErrors.callQuarantined({ callId: CALL })]);
  });

  it.each([
    ["a lone newline", "\n", "line 1 is blank"],
    ["a blank line between rows", `${row}\n${row}`, "line 2 is blank"],
    ["a last row with no newline", row.slice(0, -1), "its last line has no newline"],
    ["a line that is not JSON", "nope\n", "line 1: not JSON"],
    ["a field the verb never writes", `${JSON.stringify({ ...JSON.parse(row), extra: 1 })}\n`, "line 1: "],
    ["a loose instant", `${JSON.stringify({ ...JSON.parse(row), atIso: "Oct 26 2026" })}\n`, "line 1: atIso"],
    ["a blank reason", `${JSON.stringify({ ...JSON.parse(row), reason: " " })}\n`, "line 1: reason is empty"],
    ["a padded session", `${JSON.stringify({ ...JSON.parse(row), session: " " })}\n`, "line 1: session is blank"],
    ["a U+0085 session", `${JSON.stringify({ ...JSON.parse(row), session: "\u0085" })}\n`, "line 1: session is blank"],
    ["a U+0085 reason", `${JSON.stringify({ ...JSON.parse(row), reason: "\u0085" })}\n`, "line 1: reason is empty"],
    ["a second row for the same call", `${row}${row}`, `line 2 quarantines ${CALL} again`],
    [
      "a callId member given twice",
      `{"atIso":"${NOW}","callId":"${OTHER_CALL}","callId":"${CALL}","reason":"${REASON}","session":null}\n`,
      "line 1 is not the line talk quarantine writes",
    ],
    [
      "a row re-spaced",
      `${JSON.stringify({ atIso: NOW, callId: CALL, reason: REASON, session: null }, null, 1).replaceAll("\n", "")}\n`,
      "line 1 is not the line talk quarantine writes",
    ],
  ])("refuses %s rather than read it as accepting fewer calls", (_label, text, why) => {
    writeFileSync(callQuarantinePath({ home }), text);
    const refused = readCallQuarantine({ home })._unsafeUnwrapErr();

    expect(refused.code).toBe("QUARANTINE_LEDGER_MALFORMED");
    expect(refused.message).toContain(why);
  });
});

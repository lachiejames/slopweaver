/**
 * What `talk cursor-retire` prints and exits with: a preview naming the count, the digest and the exact apply
 * command; an apply naming where the cursor went and the first-read steps; exit codes by refusal kind.
 */
import { describe, expect, it } from "vitest";

import {
  cursorRetireAppliedLines,
  cursorRetireExit,
  cursorRetirePreviewLines,
} from "../../../../../cli/commands/talk/cursorRetireRun.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../../../../cli/exitCodes.js";
import type { CursorRetireAssessment } from "../../../../../talk/cursorRetire.js";
import { CursorRetireErrors } from "../../../../../talk/cursorRetireErrors.js";

const DIGEST = "ab".repeat(32);
const CALLS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"];

const assessment: CursorRetireAssessment = {
  cause: "CALL_PREFIX_CHANGED",
  cursorCallCount: 129,
  failingCallIds: CALLS,
  name: "supervisor",
  path: "/h/talk/unread-cursors/supervisor.json",
  sourceSha256: DIGEST,
  why: "call c1's file no longer holds what was read",
};

describe("cursorRetirePreviewLines", () => {
  it("names five failing calls, counts the rest, and prints the digest and the exact apply command", () => {
    expect(cursorRetirePreviewLines({ assessment, home: undefined })).toEqual([
      "talk cursor-retire: cursor supervisor (/h/talk/unread-cursors/supervisor.json) is refused by talk unread with " +
        "CALL_PREFIX_CHANGED — call c1's file no longer holds what was read",
      "  7 of the 129 calls it names fail their prefix proof: c1, c2, c3, c4, c5 and 2 more",
      `  sourceSha256: ${DIGEST}`,
      "  nothing was written; to move it, unchanged, into talk/unread-cursors/retired/ beside a receipt:",
      `  slopweaver talk cursor-retire --apply --source-sha256 ${DIGEST} --reason "<what rewrote the call files>"`,
      "  then slopweaver talk unread, and slopweaver talk unread --mark --adopt to adopt what an earlier chair already read",
    ]);
  });

  it("says a cursor that does not parse names no countable call", () => {
    const malformed = { ...assessment, cause: "CURSOR_MALFORMED" as const, cursorCallCount: null, failingCallIds: [] };
    expect(cursorRetirePreviewLines({ assessment: malformed, home: undefined })[1]).toBe(
      "  it does not parse, so no call it names can be counted",
    );
  });
});

describe("cursorRetireAppliedLines", () => {
  it("names where the cursor and receipt went and the first-read steps for the same home", () => {
    const applied = {
      receipt: {
        cause: "CALL_PREFIX_CHANGED" as const,
        cursorCallCount: 129,
        failingCallCount: 7,
        from: assessment.path,
        name: "supervisor",
        reason: "rewritten",
        retiredAtIso: "2026-11-17T00:00:00.000Z",
        session: null,
        sourceSha256: DIGEST,
      },
      receiptPath: "/r/receipt.json",
      retiredPath: "/r/cursor.json",
    };
    expect(cursorRetireAppliedLines({ applied, home: "/h" })).toEqual([
      "talk cursor-retire: cursor supervisor retired to /r/cursor.json (receipt /r/receipt.json); " +
        "talk unread now reads as a first read",
      "  next: slopweaver talk unread --home /h, then slopweaver talk unread --home /h --mark --adopt to adopt what an " +
        "earlier chair already read",
    ]);
  });
});

describe("cursorRetireExit", () => {
  it.each([
    ["nothing to retire", CursorRetireErrors.absent({ path: "/c" }), EXIT_EXPECTED_EMPTY],
    ["a healthy cursor", CursorRetireErrors.healthy({ path: "/c" }), EXIT_EXPECTED_EMPTY],
    ["a held lock", CursorRetireErrors.lockHeld({ why: "held" }), EXIT_DEFERRED],
    ["a moved cursor", CursorRetireErrors.sourceMoved({ actual: "a", expected: "b" }), EXIT_ERROR],
    ["a gone call file", CursorRetireErrors.notRetirable({ unreadCode: "CALL_FILE_GONE", why: "gone" }), EXIT_ERROR],
  ])("exits for %s", (_label, error, code) => {
    expect(cursorRetireExit({ error })).toBe(code);
  });
});

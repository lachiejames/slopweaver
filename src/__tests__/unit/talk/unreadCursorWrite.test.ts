/**
 * A `talk unread --mark` write over a throwaway home: it lands only over the cursor its read was taken from, and is
 * refused while another writer holds the cursor lock.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import { unwrap } from "../../../lib/result.js";
import {
  readUnreadCursor,
  sameUnreadCursor,
  UNREAD_CURSOR_LOCK_KEY,
  unreadCursorPath,
  writeUnreadCursor,
  writeUnreadCursorIfUnmoved,
} from "../../../talk/unreadCursorStore.js";
import { UnreadErrors } from "../../../talk/unreadErrors.js";

const CALL = "a0000035-0000-4000-8000-000000000038";
const NOW = "2026-09-26T06:00:00.000Z";
const NAME = "supervisor";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "talk-unread-write-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("a mark's write", () => {
  it("writes a mark only over the cursor its read was taken from, refusing one that moved or is locked", () => {
    const read = { calls: {}, recordedAtIso: NOW };
    const moved = { calls: { [CALL]: { offset: 0, prefixSha256: "sha256:moved" } }, recordedAtIso: NOW };
    const next = { calls: { [CALL]: { offset: 0, prefixSha256: "sha256:next" } }, recordedAtIso: NOW };
    const path = unwrap(unreadCursorPath({ home, name: NAME }));

    expect(sameUnreadCursor({ current: undefined, read: undefined })).toBe(true);
    expect(sameUnreadCursor({ current: read, read: undefined })).toBe(false);
    expect(unwrap(writeUnreadCursorIfUnmoved({ cursor: read, home, name: NAME, nowIso: NOW, read: undefined }))).toBe(
      path,
    );
    unwrap(writeUnreadCursor({ cursor: moved, home, name: NAME }));
    expect(
      writeUnreadCursorIfUnmoved({ cursor: next, home, name: NAME, nowIso: NOW, read })._unsafeUnwrapErr(),
    ).toEqual(UnreadErrors.cursorMoved({ path, why: "it moved since this read was taken" }));
    expect(unwrap(readUnreadCursor({ home, name: NAME }))).toEqual(moved);

    const lock = unwrap(acquireOperationLock({ home, key: UNREAD_CURSOR_LOCK_KEY, nowIso: NOW }));
    const locked = writeUnreadCursorIfUnmoved({ cursor: next, home, name: NAME, nowIso: NOW, read: moved });
    lock.release();
    expect(locked._unsafeUnwrapErr().code).toBe("CURSOR_MOVED");
    expect(unwrap(writeUnreadCursorIfUnmoved({ cursor: next, home, name: NAME, nowIso: NOW, read: moved }))).toBe(path);
    expect(unwrap(readUnreadCursor({ home, name: NAME }))).toEqual(next);
  });
});

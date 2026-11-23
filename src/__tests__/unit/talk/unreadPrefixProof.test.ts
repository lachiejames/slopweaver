/**
 * The kept prefix proof, over a throwaway home and the real read: a second pass over an unchanged file reads the same
 * from the proof, a same-length rewrite with its mtime put back is still refused, and no tail handed out shares a
 * mutable object with the proof kept for the next pass.
 */
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { readUnreadCursor, writeUnreadCursor } from "../../../talk/unreadCursorStore.js";
import { UnreadErrors } from "../../../talk/unreadErrors.js";
import { trustStillHolds, verifiedPrefix } from "../../../talk/unreadPrefixProof.js";
import { readUnread } from "../../../talk/unreadRead.js";
import { advancedCursor } from "../../../talk/unreadWords.js";

const CALL = "5b0e8f8e-4a77-4c1a-9a4e-2f3d6c0b9e11";
const NOW = "2026-09-26T06:00:00.000Z";
const NAME = "supervisor";

const segment = ({ id, text }: { id: string; text: string }): string =>
  `${JSON.stringify({ atIso: "2026-09-26T05:00:00.000Z", final: true, id, kind: "segment", text, who: "owner" })}\n`;

let home = "";
let callFile = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "talk-prefix-proof-"));
  mkdirSync(join(home, "talk", "calls"), { recursive: true });
  callFile = join(home, "talk", "calls", `${CALL}.jsonl`);
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const read = () => readUnread({ home, name: NAME, nowIso: NOW });

/** Read, then mark exactly what that read saw. */
const mark = (): void => {
  unwrap(writeUnreadCursor({ cursor: advancedCursor({ read: unwrap(read()), recordedAtIso: NOW }), home, name: NAME }));
};

describe("the kept prefix proof", () => {
  it("reads an unchanged file the same on a second pass, from the proof the first one kept", () => {
    writeFileSync(callFile, segment({ id: "a", text: "first" }));
    mark();
    appendFileSync(callFile, segment({ id: "b", text: "second" }));

    const first = unwrap(read());
    const second = unwrap(read());

    expect(second).toEqual(first);
    expect(second.tails[0]!.finalBefore).toEqual(["a"]);
    expect(second.tails[0]!.lines.length).toBe(1);
  });

  it("still refuses a same-length rewrite under a proof already kept, its mtime put back", () => {
    writeFileSync(callFile, segment({ id: "a", text: "first" }) + segment({ id: "b", text: "second" }));
    mark();
    unwrap(read());
    const before = statSync(callFile);
    writeFileSync(callFile, segment({ id: "a", text: "FIRST" }) + segment({ id: "b", text: "second" }));
    utimesSync(callFile, before.atime, before.mtime);

    expect(read()._unsafeUnwrapErr()).toEqual(
      UnreadErrors.callPrefixChanged({
        callId: CALL,
        why: `a byte before offset ${String(statSync(callFile).size)} is not what was read`,
      }),
    );
  });

  it("hands each pass its own prefix facts, so a caller mutating one tail cannot reach the next", () => {
    writeFileSync(callFile, segment({ id: "a", text: "first" }));
    mark();
    const first = unwrap(read());
    (first.tails[0]!.finalBefore as string[]).push("bogus");

    expect(unwrap(read()).tails[0]!.finalBefore).toEqual(["a"]);
  });

  it("hands each pass its own origin object too, so mutating one tail's origin cannot reach the next", () => {
    const origin = { checkoutRoot: "/w/seat", defaultPort: 3000, mainWorktree: false, port: 3001 };
    const open = { atIso: "2026-09-26T04:59:00.000Z", kind: "open", model: "m", origin, sessionId: "x", voice: "v" };
    writeFileSync(callFile, `${JSON.stringify(open)}\n`);
    mark();
    const first = unwrap(read());
    (first.tails[0]!.originBefore as { checkoutRoot: string }).checkoutRoot = "/poisoned";

    expect(unwrap(read()).tails[0]!.originBefore).toEqual(origin);
  });
});

describe("verifiedPrefix and trustStillHolds, through one descriptor", () => {
  it("trusts the kept proof on a second look, then drops it when the file moves before the pass ends", () => {
    writeFileSync(callFile, segment({ id: "a", text: "first" }));
    mark();
    const frontier = unwrap(readUnreadCursor({ home, name: NAME }))!.calls[CALL]!;
    const fd = openSync(callFile, "r");
    try {
      const look = () => unwrap(verifiedPrefix({ callId: CALL, fd, frontier, path: callFile }));
      look();
      const trusted = look().trustedOn!;
      writeFileSync(callFile, segment({ id: "a", text: "FIRST" }));

      expect(trustStillHolds({ fd, path: callFile, trustedOn: trusted })).toBe(false);
      expect(verifiedPrefix({ callId: CALL, fd, frontier, path: callFile })._unsafeUnwrapErr().code).toBe(
        "CALL_PREFIX_CHANGED",
      );
    } finally {
      closeSync(fd);
    }
  });

  it("keeps trusting while nothing moved", () => {
    writeFileSync(callFile, segment({ id: "a", text: "first" }));
    mark();
    const frontier = unwrap(readUnreadCursor({ home, name: NAME }))!.calls[CALL]!;
    const fd = openSync(callFile, "r");
    try {
      unwrap(verifiedPrefix({ callId: CALL, fd, frontier, path: callFile }));
      const trusted = unwrap(verifiedPrefix({ callId: CALL, fd, frontier, path: callFile })).trustedOn!;

      expect(trustStillHolds({ fd, path: callFile, trustedOn: trusted })).toBe(true);
    } finally {
      closeSync(fd);
    }
  });
});

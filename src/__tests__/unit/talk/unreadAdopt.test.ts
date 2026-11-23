/**
 * `talk unread-adopt`'s plan and apply over a throwaway home: what one cutoff adopts from each call file, what a line
 * the call schema refused does to it, what the digest binds, and that an applied plan leaves the next read exactly
 * the lines at or after the cutoff.
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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runTalkUnreadAdopt } from "../../../cli/commands/talk/unreadAdoptRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../cli/exitCodes.js";
import { unwrap } from "../../../lib/result.js";
import { isAdoptDigest, planUnreadAdopt } from "../../../talk/unreadAdopt.js";
import { adoptReceiptOf, adoptReceiptsPath, appendAdoptReceipt } from "../../../talk/unreadAdoptReceipts.js";
import { writeUnreadCursorBehindRecord, writeUnreadCursorIfUnmoved } from "../../../talk/unreadCursorStore.js";
import { readUnread } from "../../../talk/unreadRead.js";
import { selectUnreadWords } from "../../../talk/unreadWords.js";

const CALL = "a0000035-0000-4000-8000-000000000038";
const OTHER = "9b1f2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const NAME = "supervisor";
const NOW = "2026-11-17T08:00:00.000Z";
const BEFORE = "2026-11-17T06:00:00.000Z";
const WHY = "read on another machine";

const segment = ({ id, text, atIso }: { id: string; text: string; atIso: string }): string =>
  `${JSON.stringify({ atIso, final: true, id, kind: "segment", text, who: "owner" })}\n`;

/** A card-move line whose card key carries a space, so the call schema refuses it while it still carries an instant. */
const refusedCardMove = ({ atIso }: { atIso: string }): string =>
  `${JSON.stringify({ atIso, disposition: "moved-on", kind: "card-move", toCardKey: "ask:a b" })}\n`;

let home = "";

const callPath = ({ callId }: { callId: string }): string => join(home, "talk", "calls", `${callId}.jsonl`);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "talk-adopt-"));
  mkdirSync(join(home, "talk", "calls"), { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const plan = ({ why = WHY, name = NAME, before = BEFORE, recordedAtIso = NOW } = {}) =>
  planUnreadAdopt({
    beforeIso: before,
    name,
    read: unwrap(readUnread({ all: true, home, name: NAME, nowIso: NOW })),
    recordedAtIso,
    why,
  });

/** Apply a plan the way the verb does: the cursor through the swap, installed only behind its stored receipt. */
const apply = (): void => {
  const read = unwrap(readUnread({ all: true, home, name: NAME, nowIso: NOW }));
  const adopted = planUnreadAdopt({ beforeIso: BEFORE, name: NAME, read, recordedAtIso: NOW, why: WHY });
  unwrap(
    writeUnreadCursorBehindRecord({
      cursor: adopted.cursor,
      home,
      name: NAME,
      nowIso: NOW,
      read: read.cursor,
      record: () => appendAdoptReceipt({ home, receipt: adoptReceiptOf({ cursor: NAME, plan: adopted, why: WHY }) }),
    }),
  );
};

const cursorFile = (): string => join(home, "talk", "unread-cursors", `${NAME}.json`);

const unreadTexts = (): readonly string[] =>
  selectUnreadWords({ read: unwrap(readUnread({ all: true, home, name: NAME, nowIso: NOW })) }).words.map(
    (word) => word.text,
  );

describe("planUnreadAdopt", () => {
  it("adopts every line stamped strictly before the cutoff and leaves the line AT it unread", () => {
    writeFileSync(
      callPath({ callId: CALL }),
      segment({ atIso: "2026-11-02T01:00:00.000Z", id: "a", text: "old" }) +
        segment({ atIso: BEFORE, id: "b", text: "at the cutoff" }) +
        segment({ atIso: "2026-11-17T07:00:00.000Z", id: "c", text: "new" }),
    );
    const adopted = plan();

    expect(adopted.stretches).toBe(1);
    expect(adopted.stretchesLeft).toBe(2);
    expect(adopted.calls.map((call) => [call.callId, call.lines, call.linesLeft, call.from])).toEqual([
      [CALL, 1, 2, undefined],
    ]);
    expect(adopted.calls[0]!.firstAtIso).toBe("2026-11-02T01:00:00.000Z");
  });

  it("plans nothing when no unread line is before the cutoff", () => {
    writeFileSync(callPath({ callId: CALL }), segment({ atIso: "2026-11-17T07:00:00.000Z", id: "c", text: "new" }));

    expect(plan().calls).toEqual([]);
  });

  it("stops at the first line at or after the cutoff, leaving an older stamp behind it unread", () => {
    writeFileSync(
      callPath({ callId: CALL }),
      segment({ atIso: "2026-11-02T01:00:00.000Z", id: "a", text: "old" }) +
        segment({ atIso: "2026-11-17T07:00:00.000Z", id: "b", text: "new" }) +
        segment({ atIso: "2026-11-02T01:05:00.000Z", id: "c", text: "landed late" }),
    );
    apply();

    expect(unreadTexts()).toEqual(["landed late", "new"]);
  });

  it("adopts a refused line that still carries an earlier instant, and names it so it is printed", () => {
    writeFileSync(
      callPath({ callId: CALL }),
      segment({ atIso: "2026-11-02T01:00:00.000Z", id: "a", text: "old" }) +
        refusedCardMove({ atIso: "2026-11-02T01:01:00.000Z" }) +
        segment({ atIso: "2026-11-02T01:02:00.000Z", id: "b", text: "after the refused line" }),
    );
    const adopted = plan();

    expect(adopted.stretches).toBe(2);
    expect(adopted.unparseablePassed.map((line) => line.text)).toEqual([
      refusedCardMove({ atIso: "2026-11-02T01:01:00.000Z" }).trim(),
    ]);
    expect(adopted.unparseableLeft).toBe(0);
  });

  it("stops at a line carrying no readable instant — it may be the owner's words", () => {
    writeFileSync(
      callPath({ callId: CALL }),
      segment({ atIso: "2026-11-02T01:00:00.000Z", id: "a", text: "old" }) +
        "not json at all\n" +
        segment({ atIso: "2026-11-02T01:02:00.000Z", id: "b", text: "behind the barrier" }),
    );
    apply();

    expect(plan().calls).toEqual([]);
    expect(unreadTexts()).toEqual(["behind the barrier"]);
  });

  it("moves only the calls with something to adopt, and starts a call already part-read from its frontier", () => {
    writeFileSync(callPath({ callId: CALL }), segment({ atIso: "2026-11-02T01:00:00.000Z", id: "a", text: "one" }));
    writeFileSync(callPath({ callId: OTHER }), segment({ atIso: "2026-11-17T07:00:00.000Z", id: "z", text: "later" }));
    apply();
    appendFileSync(callPath({ callId: CALL }), segment({ atIso: "2026-11-02T02:00:00.000Z", id: "b", text: "two" }));
    const second = plan();

    expect(second.calls.map((call) => [call.callId, call.lines, call.from?.offset])).toEqual([
      [CALL, 1, Buffer.byteLength(segment({ atIso: "2026-11-02T01:00:00.000Z", id: "a", text: "one" }))],
    ]);
    expect(Object.keys(second.cursor.calls).toSorted()).toEqual([CALL]);
  });
});

describe("the adopt digest", () => {
  beforeEach(() => {
    writeFileSync(callPath({ callId: CALL }), segment({ atIso: "2026-11-02T01:00:00.000Z", id: "a", text: "old" }));
  });

  it("is shaped as an approval accepts, and does not move with the clock", () => {
    const first = plan();

    expect(isAdoptDigest({ approve: first.digest })).toBe(true);
    expect(plan({ recordedAtIso: "2026-11-17T08:30:00.000Z" }).digest).toBe(first.digest);
  });

  it.each([
    ["the reason", { why: "another reason" }],
    ["the reader", { name: "someone-else" }],
    ["the cutoff", { before: "2026-11-17T05:00:00.000Z" }],
  ])("changes with %s", (_label, change) => {
    expect(plan(change).digest).not.toBe(plan().digest);
  });

  it("changes when a line before the cutoff lands between preview and apply", () => {
    const before = plan().digest;
    appendFileSync(callPath({ callId: CALL }), segment({ atIso: "2026-11-02T01:30:00.000Z", id: "b", text: "late" }));

    expect(plan().digest).not.toBe(before);
  });

  it("does not change when only lines at or after the cutoff land", () => {
    const before = plan().digest;
    appendFileSync(callPath({ callId: CALL }), segment({ atIso: "2026-11-17T07:00:00.000Z", id: "b", text: "new" }));

    expect(plan().digest).toBe(before);
  });
});

describe("the verb's apply", () => {
  /** Run the real verb shell against the throwaway home, approving the digest a fresh plan computes. */
  const runApply = (): number =>
    runTalkUnreadAdopt([
      "node",
      "slopweaver",
      "talk",
      "unread-adopt",
      "--before",
      BEFORE,
      "--why",
      WHY,
      "--now",
      NOW,
      "--home",
      home,
      "--approve",
      plan().digest,
    ]);

  beforeEach(() => {
    writeFileSync(callPath({ callId: CALL }), segment({ atIso: "2026-11-02T01:00:00.000Z", id: "a", text: "old" }));
  });

  it("writes the cursor and one receipt when the approved digest matches", () => {
    expect(runApply()).toBe(EXIT_OK);
    expect(unreadTexts()).toEqual([]);
    expect(readFileSync(adoptReceiptsPath({ home }), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("refuses BEFORE the cursor moves when the receipts path cannot take a receipt", () => {
    mkdirSync(adoptReceiptsPath({ home }));

    expect(runApply()).toBe(EXIT_ERROR);
    expect(existsSync(join(home, "talk", "unread-cursors", "supervisor.json"))).toBe(false);
    expect(unreadTexts()).toEqual(["old"]);
  });

  it("writes nothing on a digest a fresh read does not compute", () => {
    const exit = runTalkUnreadAdopt([
      "node",
      "slopweaver",
      "talk",
      "unread-adopt",
      "--before",
      BEFORE,
      "--why",
      WHY,
      "--now",
      NOW,
      "--home",
      home,
      "--approve",
      "adopt-0123456789abcdef",
    ]);

    expect(exit).toBe(EXIT_ERROR);
    expect(existsSync(adoptReceiptsPath({ home }))).toBe(false);
    expect(unreadTexts()).toEqual(["old"]);
  });
});

describe("an applied adopt", () => {
  it("leaves the next read exactly the words at or after the cutoff, and one owner-only receipt", () => {
    writeFileSync(
      callPath({ callId: CALL }),
      segment({ atIso: "2026-11-02T01:00:00.000Z", id: "a", text: "old" }) +
        segment({ atIso: "2026-11-17T07:00:00.000Z", id: "b", text: "new" }),
    );
    apply();
    const path = adoptReceiptsPath({ home });
    const receipt = JSON.parse(readFileSync(path, "utf8").trim()) as { stretches: number; why: string; cursor: string };

    expect(unreadTexts()).toEqual(["new"]);
    expect(path).toBe(join(home, "talk", "unread-adopt-receipts.jsonl"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect([receipt.cursor, receipt.stretches, receipt.why]).toEqual([NAME, 1, WHY]);
  });

  it("refuses a second apply computed from the cursor the first one moved", () => {
    writeFileSync(callPath({ callId: CALL }), segment({ atIso: "2026-11-02T01:00:00.000Z", id: "a", text: "old" }));
    const read = unwrap(readUnread({ all: true, home, name: NAME, nowIso: NOW }));
    const stale = planUnreadAdopt({ beforeIso: BEFORE, name: NAME, read, recordedAtIso: NOW, why: WHY });
    apply();
    const second = writeUnreadCursorIfUnmoved({
      cursor: stale.cursor,
      home,
      name: NAME,
      nowIso: NOW,
      read: read.cursor,
    });

    expect(second._unsafeUnwrapErr().code).toBe("CURSOR_MOVED");
  });
});

describe("a cursor written behind its receipt", () => {
  beforeEach(() => {
    writeFileSync(callPath({ callId: CALL }), segment({ atIso: "2026-11-02T01:00:00.000Z", id: "a", text: "old" }));
  });

  /**
   * Write the adopt's cursor behind its receipt, from a fresh read; `meanwhile` runs inside the write, after the swap's
   * checks passed and the cursor is staged, just before the receipt is appended.
   */
  const writeBehind = ({ meanwhile }: { meanwhile: () => void }) => {
    const read = unwrap(readUnread({ all: true, home, name: NAME, nowIso: NOW }));
    const adopted = planUnreadAdopt({ beforeIso: BEFORE, name: NAME, read, recordedAtIso: NOW, why: WHY });
    const receipt = adoptReceiptOf({ cursor: NAME, plan: adopted, why: WHY });
    return {
      receipt,
      written: writeUnreadCursorBehindRecord({
        cursor: adopted.cursor,
        home,
        name: NAME,
        nowIso: NOW,
        read: read.cursor,
        record: () => {
          meanwhile();
          return appendAdoptReceipt({ home, receipt });
        },
      }),
    };
  };

  // The race a receipt-after-cursor order loses: the receipts path turns into a directory AFTER the swap's checks
  // passed and before the append, by which point that order had already moved the cursor.
  it("leaves the cursor unmoved, and no staged file behind, when the receipt fails after the checks passed", () => {
    const { written } = writeBehind({
      meanwhile: () => {
        mkdirSync(adoptReceiptsPath({ home }));
      },
    });

    expect(written._unsafeUnwrapErr().code).toBe("UNREAD_PATH_FAILED");
    expect(existsSync(cursorFile())).toBe(false);
    expect(readdirSync(join(home, "talk", "unread-cursors"))).toEqual([]);
    expect(unreadTexts()).toEqual(["old"]);
  });

  it("never stores the receipt when the cursor moved since the read", () => {
    const read = unwrap(readUnread({ all: true, home, name: NAME, nowIso: NOW }));
    const adopted = planUnreadAdopt({ beforeIso: BEFORE, name: NAME, read, recordedAtIso: NOW, why: WHY });
    apply();
    rmSync(adoptReceiptsPath({ home }));
    const second = writeUnreadCursorBehindRecord({
      cursor: adopted.cursor,
      home,
      name: NAME,
      nowIso: NOW,
      read: read.cursor,
      record: () => appendAdoptReceipt({ home, receipt: adoptReceiptOf({ cursor: NAME, plan: adopted, why: WHY }) }),
    });

    expect(second._unsafeUnwrapErr().code).toBe("CURSOR_MOVED");
    expect(existsSync(adoptReceiptsPath({ home }))).toBe(false);
  });

  it("names the stored receipt when the staged cursor then fails to install, and the cursor stays unmoved", () => {
    const { written, receipt } = writeBehind({
      meanwhile: () => {
        // A non-empty directory at the cursor's path: the rename over it fails once the receipt is stored.
        mkdirSync(join(cursorFile(), "occupied"), { recursive: true });
      },
    });

    expect(written._unsafeUnwrapErr()).toMatchObject({
      code: "CURSOR_INSTALL_FAILED",
      path: cursorFile(),
      recordPath: adoptReceiptsPath({ home }),
    });
    expect(JSON.parse(readFileSync(adoptReceiptsPath({ home }), "utf8").trim()).digest).toBe(receipt.digest);
    expect(readdirSync(cursorFile())).toEqual(["occupied"]);
  });

  it("answers both paths when the receipt stored and the cursor installed", () => {
    const { written, receipt } = writeBehind({
      meanwhile: () => {
        // Nothing interferes: the ordinary apply.
      },
    });

    expect(unwrap(written)).toEqual({ cursorPath: cursorFile(), recordPath: adoptReceiptsPath({ home }) });
    expect(JSON.parse(readFileSync(adoptReceiptsPath({ home }), "utf8").trim()).digest).toBe(receipt.digest);
    expect(unreadTexts()).toEqual([]);
  });
});

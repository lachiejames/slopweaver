/** The owner's hold on automatic chair hand-off, round-tripped through a real journal under a mkdtemp home. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  ChairHandOffHoldErrors,
  chairHandOffHoldPath,
  readChairHandOffHold,
  recordChairHandOffHold,
} from "../../../supervisor/chairHandOffHold.js";

describe("the chair hand-off hold journal", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hold-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads no hold on an install that never held one", () => {
    const read = readChairHandOffHold({ home });

    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toBeUndefined();
  });

  it("round-trips a hold: the reason and instant written are the hold read back", () => {
    const written = recordChairHandOffHold({
      home,
      kind: "hold",
      nowIso: "2026-11-27T11:00:00.000Z",
      reason: "  mid-demo, keep this chair  ",
    });

    expect(unwrap(written)).toStrictEqual({
      atIso: "2026-11-27T11:00:00.000Z",
      kind: "hold",
      reason: "mid-demo, keep this chair",
    });
    expect(unwrap(readChairHandOffHold({ home }))).toStrictEqual({
      reason: "mid-demo, keep this chair",
      sinceIso: "2026-11-27T11:00:00.000Z",
    });
    expect(readFileSync(chairHandOffHoldPath({ home }), "utf8")).toBe(
      '{"atIso":"2026-11-27T11:00:00.000Z","kind":"hold","reason":"mid-demo, keep this chair"}\n',
    );
  });

  it("writes no account address into the journal, even one the owner typed in the reason", () => {
    unwrap(
      recordChairHandOffHold({
        home,
        kind: "hold",
        nowIso: "2026-11-27T11:00:00.000Z",
        reason: "pause seat-1@example.test",
      }),
    );

    expect(readFileSync(chairHandOffHoldPath({ home }), "utf8")).toBe(
      '{"atIso":"2026-11-27T11:00:00.000Z","kind":"hold","reason":"pause <account>"}\n',
    );
  });

  it("clears the hold on a release, the latest line deciding", () => {
    unwrap(recordChairHandOffHold({ home, kind: "hold", nowIso: "2026-11-27T11:00:00.000Z", reason: "demo" }));
    unwrap(recordChairHandOffHold({ home, kind: "release", nowIso: "2026-11-27T12:00:00.000Z", reason: "done" }));

    expect(unwrap(readChairHandOffHold({ home }))).toBeUndefined();
  });

  it("holds again after a release when a later hold lands", () => {
    unwrap(recordChairHandOffHold({ home, kind: "hold", nowIso: "2026-11-27T11:00:00.000Z", reason: "demo" }));
    unwrap(recordChairHandOffHold({ home, kind: "release", nowIso: "2026-11-27T12:00:00.000Z", reason: "done" }));
    unwrap(recordChairHandOffHold({ home, kind: "hold", nowIso: "2026-11-27T13:00:00.000Z", reason: "again" }));

    expect(unwrap(readChairHandOffHold({ home }))).toStrictEqual({
      reason: "again",
      sinceIso: "2026-11-27T13:00:00.000Z",
    });
  });

  it("refuses a blank reason and writes nothing", () => {
    const written = recordChairHandOffHold({ home, kind: "hold", nowIso: "2026-11-27T11:00:00.000Z", reason: "   " });

    expect(written.isErr()).toBe(true);
    expect(unwrapErr(written)).toStrictEqual(ChairHandOffHoldErrors.reasonEmpty());
    expect(unwrap(readChairHandOffHold({ home }))).toBeUndefined();
  });

  it("names a malformed line by its number rather than skipping it — a skipped hold would read as unheld", () => {
    const path = chairHandOffHoldPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{"atIso":"2026-11-27T11:00:00.000Z","kind":"hold","reason":"demo"}\n{"kind":"hold"\n');

    const read = readChairHandOffHold({ home });

    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read)).toStrictEqual(
      ChairHandOffHoldErrors.lineMalformed({ lineNumber: 2, path, why: "it is not JSON" }),
    );
    // The input carries the home in the error's path field, so the message's silence about it is evidence.
    expect(path.startsWith(home)).toBe(true);
    expect(unwrapErr(read).message).not.toContain(home);
  });

  it("refuses a line of the wrong shape, naming what is wrong with it", () => {
    const path = chairHandOffHoldPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{"atIso":"2026-11-27T11:00:00.000Z","kind":"pause","reason":"demo"}\n');

    const read = readChairHandOffHold({ home });

    expect(unwrapErr(read).code).toBe("HOLD_LINE_MALFORMED");
    expect(unwrapErr(read).message).toContain("the hand-off hold journal's line 1 is not a hold or release line");
  });
});

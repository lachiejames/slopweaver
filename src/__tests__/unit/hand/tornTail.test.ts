/**
 * How a cut-short register end is found, over real files in a temp directory: the thing under test IS the bytes on
 * disk, the sanctioned fixture exception in `.claude/rules/testing.md`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findTailMend } from "../../../hand/tornTail.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const WHOLE =
  '{"kind":"settled","id":"iso-drafts","did":"superseded by iso-reply","settledIso":"2026-09-27T09:00:00.000Z","bySession":"workspace:129"}';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "torn-tail-"));
  path = join(dir, "steps.jsonl");
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("findTailMend", () => {
  it("needs no mend for an absent register", () => {
    expect(unwrap(findTailMend({ path }))).toBeUndefined();
  });

  it("needs no mend for a register ending a whole line", () => {
    writeFileSync(path, `${WHOLE}\n${WHOLE}\n`);
    expect(unwrap(findTailMend({ path }))).toBeUndefined();
  });

  it("drops a torn last line back to the end of the last whole one", () => {
    writeFileSync(path, `${WHOLE}\n${WHOLE.slice(0, 40)}`);
    expect(unwrap(findTailMend({ path }))).toEqual({ droppedBytes: 40, keepBytes: WHOLE.length + 1, kind: "torn" });
  });

  it("finds a torn last line longer than any one read, back to the last whole line", () => {
    const torn = `{"kind":"posted","step":{"cites":["https://x/?${"\\\\".repeat(700_000)}`;
    writeFileSync(path, `${WHOLE}\n${torn}`);
    expect(unwrap(findTailMend({ path }))).toEqual({
      droppedBytes: Buffer.byteLength(torn),
      keepBytes: WHOLE.length + 1,
      kind: "torn",
    });
  });

  it("drops a torn first line to nothing, since it starts the file", () => {
    writeFileSync(path, WHOLE.slice(0, 12));
    expect(unwrap(findTailMend({ path }))).toEqual({ droppedBytes: 12, keepBytes: 0, kind: "torn" });
  });

  it("terminates a whole last row missing only its newline", () => {
    writeFileSync(path, `${WHOLE}\n${WHOLE}`);
    expect(unwrap(findTailMend({ path }))).toEqual({ kind: "unterminated" });
  });

  it("terminates a blank last line rather than calling it torn, since the reader skips it rather than counting it unread", () => {
    writeFileSync(path, "not-json\n   ");
    expect(unwrap(findTailMend({ path }))).toEqual({ kind: "unterminated" });
  });

  it("names the register when it cannot be read", () => {
    expect(unwrapErr(findTailMend({ path: dir })).code).toBe("STORE_UNREADABLE");
  });
});

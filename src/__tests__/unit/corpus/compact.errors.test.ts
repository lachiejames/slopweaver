/**
 * Bronze compaction's four failures, built through their factory: a corrupt line named by its file and its
 * 1-based line number, a read and a write failure that carry the underlying io message unchanged, and an
 * unlink failure that joins every per-path message and keeps every path.
 */
import { describe, expect, it } from "vitest";

import { CompactErrors } from "../../../corpus/compact.errors.js";

describe("CompactErrors", () => {
  it("corruptLine is CORRUPT_LINE, naming the file, the 1-based line and the reason", () => {
    expect(
      CompactErrors.corruptLine({ line: 3, path: "/h/bronze/slack/2026-09.jsonl", reason: "not valid JSON" }),
    ).toEqual({
      code: "CORRUPT_LINE",
      line: 3,
      message: "/h/bronze/slack/2026-09.jsonl:3: not valid JSON — refusing to compact this source",
      path: "/h/bronze/slack/2026-09.jsonl",
    });
  });

  it("readFailed is COMPACT_READ_FAILED, carrying the io message unchanged", () => {
    expect(CompactErrors.readFailed({ message: "EACCES: permission denied", path: "/h/bronze/a.jsonl" })).toEqual({
      code: "COMPACT_READ_FAILED",
      message: "EACCES: permission denied",
      path: "/h/bronze/a.jsonl",
    });
  });

  it("writeFailed is COMPACT_WRITE_FAILED, carrying the io message unchanged", () => {
    expect(CompactErrors.writeFailed({ message: "ENOSPC: no space left", path: "/h/bronze/canon.jsonl" })).toEqual({
      code: "COMPACT_WRITE_FAILED",
      message: "ENOSPC: no space left",
      path: "/h/bronze/canon.jsonl",
    });
  });

  it("unlinkFailed is COMPACT_UNLINK_FAILED, joining every failure with a semicolon and keeping every path", () => {
    expect(
      CompactErrors.unlinkFailed({
        failures: ["/h/a.jsonl: EBUSY", "/h/b.jsonl: EPERM"],
        paths: ["/h/a.jsonl", "/h/b.jsonl"],
      }),
    ).toEqual({
      code: "COMPACT_UNLINK_FAILED",
      message: "/h/a.jsonl: EBUSY; /h/b.jsonl: EPERM",
      paths: ["/h/a.jsonl", "/h/b.jsonl"],
    });
  });
});

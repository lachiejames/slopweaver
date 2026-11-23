/**
 * The door import's file stamp: an unchanged file passes, a line appended after the stamp is refused, and a file
 * gone missing is refused rather than read as unchanged.
 */
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { changedFileRefusals, fileStamp } from "../../../../../cli/commands/store/doorFileStamp.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A temp ledger holding one line. */
function ledger(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-door-stamp-"));
  dirs.push(dir);
  const path = join(dir, "door.jsonl");
  writeFileSync(path, '{"a":1}\n', "utf8");
  return path;
}

describe("fileStamp", () => {
  it("stamps a file by its size first", () => {
    const path = ledger();
    expect(unwrap(fileStamp({ path })).split(":")[0]).toBe("8");
  });

  it("answers the leg's write failure, carrying the stat's own message, for a missing file", () => {
    const failed = unwrapErr(fileStamp({ path: join(tmpdir(), "sw-door-stamp-absent", "door.jsonl") }));
    expect(failed.code).toBe("LEG_WRITE_FAILED");
    expect(failed.message).toContain("ENOENT");
  });
});

describe("changedFileRefusals", () => {
  it("refuses nothing for an unchanged file", () => {
    const path = ledger();
    const before = unwrap(fileStamp({ path }));
    expect(changedFileRefusals({ before, path, verifying: false })).toStrictEqual([]);
  });

  it("refuses an import whose file grew after the stamp, naming the pass it interrupted", () => {
    const path = ledger();
    const before = unwrap(fileStamp({ path }));
    appendFileSync(path, '{"b":2}\n', "utf8");
    const refused = changedFileRefusals({ before, path, verifying: false });
    expect(refused.map((refusal) => refusal.code)).toStrictEqual(["LEG_WRITE_FAILED"]);
    expect(refused[0]!.message).toContain("the file changed while it was being imported");
  });

  it("names a verify, and refuses a file that is gone", () => {
    const path = ledger();
    const before = unwrap(fileStamp({ path }));
    rmSync(path);
    const refused = changedFileRefusals({ before, path, verifying: true });
    expect(refused[0]!.message).toContain("the file changed while it was being verified");
  });
});

/**
 * Whether a held export still is the export taken in: the one content hash the import and every later check share,
 * the cheap shape check run on every listing, and the full re-hash run before an export is relied on.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkHeldShape, hashMembers, verifyHeldContent } from "../../../../corpus/chatgpt/exportIntegrity.js";
import { unwrapErr } from "../../../../lib/result.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A held export of two members, in a directory named for their hash. */
function heldPair(): { directory: string; files: readonly string[]; contentHash: string } {
  const scratch = mkdtempSync(join(tmpdir(), "chatgpt-integrity-"));
  dirs.push(scratch);
  const names = ["conversations-000.json", "conversations-001.json"];
  const staging = join(scratch, "staging");
  mkdirSync(staging);
  writeFileSync(join(staging, names[0]!), "[1]");
  writeFileSync(join(staging, names[1]!), "[22]");
  const { contentHash } = hashMembers({ directory: staging, names });
  const directory = join(scratch, contentHash);
  mkdirSync(directory);
  for (const name of names) {
    writeFileSync(join(directory, name), name === names[0] ? "[1]" : "[22]");
  }
  return { contentHash, directory, files: names.map((name) => join(directory, name)) };
}

describe("hashMembers", () => {
  it("binds each name to its bytes, so moving bytes between members changes the hash", () => {
    const scratch = mkdtempSync(join(tmpdir(), "chatgpt-integrity-"));
    dirs.push(scratch);
    writeFileSync(join(scratch, "a.json"), "[1]");
    writeFileSync(join(scratch, "b.json"), "[22]");
    const forward = hashMembers({ directory: scratch, names: ["a.json", "b.json"] });
    writeFileSync(join(scratch, "a.json"), "[1][");
    writeFileSync(join(scratch, "b.json"), "22]");
    const shifted = hashMembers({ directory: scratch, names: ["a.json", "b.json"] });
    expect(forward.bytes).toEqual([3, 4]);
    expect(shifted.contentHash).not.toBe(forward.contentHash);
  });
});

describe("checkHeldShape", () => {
  it("accepts a directory named for its hash whose members are their declared sizes", () => {
    const { contentHash, directory } = heldPair();
    const members = [
      { bytes: 3, name: "conversations-000.json" },
      { bytes: 4, name: "conversations-001.json" },
    ];
    expect(checkHeldShape({ contentHash, directory, members }).isOk()).toBe(true);
  });

  it("refuses a manifest whose hash is not the directory's name", () => {
    const { directory } = heldPair();
    const refused = unwrapErr(
      checkHeldShape({
        contentHash: "0".repeat(64),
        directory,
        members: [{ bytes: 3, name: "conversations-000.json" }],
      }),
    );
    expect(refused.code).toBe("HELD_EXPORT_DAMAGED");
    expect(refused.message).toContain(`its manifest names the hash ${"0".repeat(64)}`);
  });

  it("refuses a member whose size is not the one declared", () => {
    const { contentHash, directory } = heldPair();
    const refused = unwrapErr(
      checkHeldShape({ contentHash, directory, members: [{ bytes: 9, name: "conversations-000.json" }] }),
    );
    expect(refused.message).toContain("conversations-000.json is 3 bytes, and the manifest declares 9");
  });
});

describe("verifyHeldContent", () => {
  it("accepts members that still hash to the directory's name", () => {
    const { directory, files } = heldPair();
    expect(verifyHeldContent({ directory, files }).isOk()).toBe(true);
  });

  it("refuses members rewritten under the same size", () => {
    const { directory, files } = heldPair();
    writeFileSync(files[1]!, "[33]");
    const refused = unwrapErr(verifyHeldContent({ directory, files }));
    expect(refused.code).toBe("HELD_EXPORT_DAMAGED");
    expect(refused.message).toContain("its members no longer hash to its name");
  });

  it("refuses a member that is gone, naming that it cannot be read", () => {
    const { directory, files } = heldPair();
    rmSync(files[0]!);
    expect(unwrapErr(verifyHeldContent({ directory, files })).message).toContain("a member cannot be read");
  });
});

/**
 * The proof block in a checkout's own `info/exclude`: appended once, refreshed in place, never touching
 * another writer's lines, and a no-op when current.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { PROOF_GITIGNORE_LINES } from "../../../proofPath/criterion.js";
import {
  ensureProofExclude,
  PROOF_EXCLUDE_BEGIN,
  PROOF_EXCLUDE_END,
  proofExcludeEdit,
  replaceIfUnchanged,
} from "../../../proofPath/localExclude.js";

const BLOCK = [PROOF_EXCLUDE_BEGIN, ...PROOF_GITIGNORE_LINES, PROOF_EXCLUDE_END].join("\n");

/** acme-admin's real foreign lines, which the block must never disturb. */
const FOREIGN = "# work-console per-worktree in-use marker\n.wc-inuse\napps/test/.auth/\n";

describe("proofExcludeEdit", () => {
  it("appends the block alone to an empty file", () => {
    expect(unwrap(proofExcludeEdit({ content: "" }))).toEqual({ kind: "append", text: `${BLOCK}\n` });
  });

  it("appends after the foreign lines, separated by one blank line", () => {
    expect(unwrap(proofExcludeEdit({ content: FOREIGN }))).toEqual({ kind: "append", text: `\n${BLOCK}\n` });
  });

  it("leaves an unterminated last foreign line for the append to terminate, adding only the blank line", () => {
    expect(unwrap(proofExcludeEdit({ content: ".wc-inuse" }))).toEqual({ kind: "append", text: `\n${BLOCK}\n` });
  });

  it("is a no-op once the block is current", () => {
    expect(unwrap(proofExcludeEdit({ content: `${FOREIGN}\n${BLOCK}\n` }))).toBe(undefined);
  });

  it("replaces a stale block in place and keeps the lines on both sides", () => {
    const stale = `${FOREIGN}${PROOF_EXCLUDE_BEGIN}\n**/proof/**\n${PROOF_EXCLUDE_END}\nafter.log\n`;
    expect(unwrap(proofExcludeEdit({ content: stale }))).toEqual({
      content: `${FOREIGN}${BLOCK}\nafter.log\n`,
      kind: "replace",
    });
  });

  it("refuses a block whose closing line is gone rather than guess where it ended", () => {
    const result = proofExcludeEdit({ content: `${PROOF_EXCLUDE_BEGIN}\n**/proof/**\n.wc-inuse\n` });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("with no");
  });
});

describe("ensureProofExclude", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /** A throwaway common git directory, optionally with an `info/exclude` already in it. */
  function commonDir({ exclude }: { exclude: string | undefined }): string {
    const dir = mkdtempSync(join(tmpdir(), "proof-exclude-"));
    dirs.push(dir);
    if (exclude !== undefined) {
      mkdirSync(join(dir, "info"));
      writeFileSync(join(dir, "info", "exclude"), exclude);
    }
    return dir;
  }

  it("creates info/exclude when the directory has none", () => {
    const dir = commonDir({ exclude: undefined });
    expect(unwrap(ensureProofExclude({ commonGitDir: dir }))).toBe("appended");
    expect(readFileSync(join(dir, "info", "exclude"), "utf8")).toBe(`${BLOCK}\n`);
  });

  it("appends once, then reports the block current", () => {
    const dir = commonDir({ exclude: FOREIGN });
    expect(unwrap(ensureProofExclude({ commonGitDir: dir }))).toBe("appended");
    expect(unwrap(ensureProofExclude({ commonGitDir: dir }))).toBe("current");
    expect(readFileSync(join(dir, "info", "exclude"), "utf8")).toBe(`${FOREIGN}\n${BLOCK}\n`);
  });

  it("terminates a last foreign line that had no newline before the blank line and the block", () => {
    const dir = commonDir({ exclude: ".wc-inuse" });
    expect(unwrap(ensureProofExclude({ commonGitDir: dir }))).toBe("appended");
    expect(readFileSync(join(dir, "info", "exclude"), "utf8")).toBe(`.wc-inuse\n\n${BLOCK}\n`);
  });

  it("refreshes a stale block without moving the foreign lines", () => {
    const dir = commonDir({ exclude: `${PROOF_EXCLUDE_BEGIN}\n**/proof/**\n${PROOF_EXCLUDE_END}\n${FOREIGN}` });
    expect(unwrap(ensureProofExclude({ commonGitDir: dir }))).toBe("refreshed");
    expect(readFileSync(join(dir, "info", "exclude"), "utf8")).toBe(`${BLOCK}\n${FOREIGN}`);
  });

  it("never renames over a file another writer changed after it was read, and leaves no staged file", () => {
    const dir = commonDir({ exclude: `${FOREIGN}.wc-inuse-2\n` });
    const path = join(dir, "info", "exclude");
    expect(replaceIfUnchanged({ expected: FOREIGN, next: BLOCK, path })).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(`${FOREIGN}.wc-inuse-2\n`);
    expect(readdirSync(join(dir, "info"))).toEqual(["exclude"]);
  });

  it("renames over a file that still reads what it was computed from", () => {
    const dir = commonDir({ exclude: FOREIGN });
    const path = join(dir, "info", "exclude");
    expect(replaceIfUnchanged({ expected: FOREIGN, next: BLOCK, path })).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(BLOCK);
    expect(readdirSync(join(dir, "info"))).toEqual(["exclude"]);
  });

  it("names the file when the block is malformed, and leaves it untouched", () => {
    const broken = `${PROOF_EXCLUDE_BEGIN}\n.wc-inuse\n`;
    const dir = commonDir({ exclude: broken });
    const result = ensureProofExclude({ commonGitDir: dir });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain(join(dir, "info", "exclude"));
    expect(readFileSync(join(dir, "info", "exclude"), "utf8")).toBe(broken);
  });
});

/**
 * `readOwnerOnlyFile` — each refusal is its own typed variant naming the file, never its contents.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OwnerOnlyFileErrors, readOwnerOnlyFile } from "../../../lib/ownerOnlyFile.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "owner-only-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Write `content` at `name` under the fixture directory with `mode`, and return its path. */
function fixture({ content, mode, name }: { content: string; mode: number; name: string }): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  chmodSync(path, mode);
  return path;
}

describe("readOwnerOnlyFile", () => {
  it("returns the trimmed value of an owner-only file", () => {
    const path = fixture({ content: "  token-value\n", mode: 0o600, name: "token" });

    expect(readOwnerOnlyFile({ label: "secrets/token", path })._unsafeUnwrap()).toBe("token-value");
  });

  it("refuses a file group or other can read", () => {
    const path = fixture({ content: "token-value", mode: 0o644, name: "token" });
    const error = readOwnerOnlyFile({ label: "secrets/token", path })._unsafeUnwrapErr();

    expect(error).toEqual(OwnerOnlyFileErrors.modeTooOpen({ label: "secrets/token", path }));
    expect(error.message).toBe(`secrets/token must be owner-only (mode 0600 or stricter): ${path}`);
  });

  it("refuses an empty file", () => {
    const path = fixture({ content: "  \n", mode: 0o600, name: "token" });
    const error = readOwnerOnlyFile({ label: "secrets/token", path })._unsafeUnwrapErr();

    expect(error).toEqual(OwnerOnlyFileErrors.emptyFile({ label: "secrets/token", path }));
    expect(error.message).toBe(`secrets/token is empty: ${path}`);
  });

  it("refuses a path that is not a regular file", () => {
    const path = join(dir, "a-directory");
    mkdirSync(path);
    const error = readOwnerOnlyFile({ label: "secrets/token", path })._unsafeUnwrapErr();

    expect(error).toEqual(OwnerOnlyFileErrors.notRegularFile({ label: "secrets/token", path }));
    expect(error.message).toBe(`secrets/token does not name a regular file: ${path}`);
  });

  it("names the file and the cause when it cannot be opened at all", () => {
    const path = join(dir, "absent");
    const error = readOwnerOnlyFile({ label: "secrets/token", path })._unsafeUnwrapErr();

    expect(error.code).toBe("READ_FAILED");
    expect(error.message).toBe(
      `could not read secrets/token at ${path}: ENOENT: no such file or directory, open '${path}'`,
    );
  });
});

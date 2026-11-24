/**
 * The staging directory an export is copied into before it is published: made private under the root, and never
 * opened through a root that is a symbolic link.
 */
import { mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openStaging } from "../../../../corpus/chatgpt/exportStaging.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway directory, removed after each test. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "export-staging-"));
  dirs.push(dir);
  return dir;
}

describe("openStaging", () => {
  it("creates an absent root private and opens a staging directory inside it", () => {
    const root = join(scratch(), "exports");
    const staging = unwrap(openStaging({ root }));
    expect(dirname(staging)).toBe(root);
    expect(staging.startsWith(join(root, ".staging-"))).toBe(true);
    expect(statSync(root).mode & 0o777).toBe(0o700);
  });

  it("refuses a root that is a symbolic link, naming the root", () => {
    const base = scratch();
    const real = join(base, "real");
    const root = join(base, "exports");
    unwrap(openStaging({ root: real }));
    symlinkSync(real, root);
    const refused = unwrapErr(openStaging({ root }));
    expect(refused.code).toBe("EXPORT_STORE_FAILED");
    expect(refused.message).toContain(`could not store the export at ${root}`);
    expect(refused.message).toContain("symbolic link");
  });
});

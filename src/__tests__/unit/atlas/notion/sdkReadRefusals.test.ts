/**
 * The refusals the Notion SDK read authors when the installed package's own `package.json` cannot name a
 * version.
 *
 * `readNotionSdkSurface` resolves the REAL installed package and has no seam, so these drive the version
 * reader it composes over a throwaway package root instead, and assert the whole array the CLI prints.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { packageVersion } from "../../../../atlas/notion/sdkRead.js";
import { unwrapErr } from "../../../../lib/result.js";

const roots: string[] = [];

/** A throwaway package root, removed in `afterEach`. */
function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-notion-sdk-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("packageVersion", () => {
  it("names the package and the read failure when there is no package.json", () => {
    const root = scratchRoot();
    expect(unwrapErr(packageVersion({ root }))).toEqual([
      `could not read @notionhq/client's package.json: ENOENT: no such file or directory, open '${root}/package.json'`,
    ]);
  });

  it("refuses a package.json that declares no version", () => {
    const root = scratchRoot();
    writeFileSync(join(root, "package.json"), "{}");
    expect(unwrapErr(packageVersion({ root }))).toEqual([
      "@notionhq/client's package.json declares no version, so a stored generation could not name one",
    ]);
  });
});

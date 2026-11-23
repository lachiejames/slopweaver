/**
 * The refusals the Xero SDK read authors when the installed package is not laid out the way it reads it.
 *
 * `readXeroSdkSurface` resolves the REAL installed package and has no seam, so these drive the three readers
 * it composes over a throwaway package root instead. Each asserts the whole array, because the CLI prints one
 * line per element and the second line is the correction a reader acts on.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { packageVersion, readModelFields, readOperations } from "../../../../atlas/xero/sdkRead.js";
import { unwrapErr } from "../../../../lib/result.js";

const roots: string[] = [];

/** A throwaway package root, removed in `afterEach`. */
function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-xero-sdk-"));
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
      `could not read xero-node's package.json: ENOENT: no such file or directory, open '${root}/package.json'`,
    ]);
  });

  it("refuses a package.json that declares no version", () => {
    const root = scratchRoot();
    writeFileSync(join(root, "package.json"), '{"name":"x"}');
    expect(unwrapErr(packageVersion({ root }))).toEqual([
      "xero-node's package.json declares no version, so a stored generation could not name one",
    ]);
  });
});

describe("readOperations", () => {
  it("names the API subpath and says the layout moved when the API classes cannot be listed", () => {
    const root = scratchRoot();
    expect(unwrapErr(readOperations({ root }))).toEqual([
      `could not list xero-node's generated API classes at dist/gen/api: ENOENT: no such file or directory, scandir '${root}/dist/gen/api'`,
      "the package's layout has moved; this atlas's API surface is read from those files and cannot be inferred",
    ]);
  });

  it("stops at the first API class it cannot read, naming the file", () => {
    const root = scratchRoot();
    mkdirSync(join(root, "dist", "gen", "api", "BrokenApi.js"), { recursive: true });
    expect(unwrapErr(readOperations({ root }))).toEqual([
      "could not read xero-node's BrokenApi.js: EISDIR: illegal operation on a directory, read",
    ]);
  });
});

describe("readModelFields", () => {
  it("names the MODEL subpath, never the API one, when the model tree cannot be listed", () => {
    const root = scratchRoot();
    expect(unwrapErr(readModelFields({ root }))).toEqual([
      `could not list xero-node's generated models at dist/gen/model: ENOENT: no such file or directory, scandir '${root}/dist/gen/model'`,
      "the response-field half of this atlas's API surface is read from those files and cannot be inferred",
    ]);
  });
});

/*
 * `store pages-import` stops before the store on a dry run and on any refusal: neither opens a connection, so both
 * answer in a home with no store configured at all. A real temporary home under the per-file sandbox.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runPagesImport } from "../../../../cli/commands/store/pagesImportRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pages-import-run-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * The verb's argv as the router hands it over.
 *
 * @param rest the arguments after the verb
 * @returns the full argv
 */
function argvOf({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "store", "pages-import", ...rest];
}

describe("runPagesImport", () => {
  it("dry-runs a home with a page and no store, opening no connection", async () => {
    mkdirSync(join(home, "pages", "acme-page"), { recursive: true });
    writeFileSync(join(home, "pages", "acme-page", "index.html"), "<p>acme</p>");
    expect(await runPagesImport(argvOf({ rest: ["--home", home, "--dry-run", "--json"] }))).toBe(EXIT_OK);
  });

  it("refuses a link without a dry run and still opens no connection", async () => {
    mkdirSync(join(home, "pages"), { recursive: true });
    symlinkSync(join(home, "elsewhere"), join(home, "pages", "acme-link"));
    expect(await runPagesImport(argvOf({ rest: ["--home", home] }))).toBe(EXIT_ERROR);
  });

  it("refuses an unknown flag as a usage error before reading anything", async () => {
    expect(await runPagesImport(argvOf({ rest: ["--home", home, "--force"] }))).toBe(EXIT_USAGE);
  });
});

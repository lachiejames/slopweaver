import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { publishableFragment } from "../../../../../cli/commands/page/publishFragment.js";

describe("publishableFragment", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-publish-fragment-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Lint one fragment written into the temp home, capturing what it printed. */
  function lint({ fragment, assetsRoot }: { fragment: string; assetsRoot: string | undefined }): {
    readonly linked: string | undefined;
    readonly diagnostics: readonly string[];
  } {
    const fragmentPath = join(home, "acme.html");
    writeFileSync(fragmentPath, fragment);
    const diagnostics: string[] = [];
    const linked = publishableFragment({
      assetsRoot,
      fragmentPath,
      home,
      lintWaived: false,
      writeDiagnostic: (line) => diagnostics.push(line),
    });
    return { diagnostics, linked };
  }

  it("answers a clean fragment's bytes unchanged and prints nothing", () => {
    expect(lint({ assetsRoot: undefined, fragment: "<p>acme ships the report</p>" })).toEqual({
      diagnostics: [],
      linked: "<p>acme ships the report</p>",
    });
  });

  it("passes a relative image the --assets-from directory holds", () => {
    const assets = join(home, "assets");
    mkdirSync(join(assets, "charts"), { recursive: true });
    writeFileSync(join(assets, "charts", "load.png"), "png");

    expect(lint({ assetsRoot: assets, fragment: '<img src="charts/load.png" alt="load">' })).toEqual({
      diagnostics: [],
      linked: '<img src="charts/load.png" alt="load">',
    });
  });

  it("refuses a relative image when no --assets-from was named, and says so", () => {
    const ran = lint({ assetsRoot: undefined, fragment: '<img src="charts/load.png" alt="load">' });

    expect(ran.linked).toBeUndefined();
    expect(ran.diagnostics[0]).toBe(
      '<img src="charts/load.png"> names a file the page\'s assets do not hold, so it shows as a broken image — put ' +
        "it under the directory --assets-from names before publishing",
    );
    expect(ran.diagnostics[1]).toContain("1 finding(s) above, with no --assets-from named");
  });

  it("answers nothing and prints the read refusal for a fragment that is not there", () => {
    const diagnostics: string[] = [];
    const linked = publishableFragment({
      assetsRoot: undefined,
      fragmentPath: join(home, "absent.html"),
      home,
      lintWaived: false,
      writeDiagnostic: (line) => diagnostics.push(line),
    });
    expect(linked).toBeUndefined();
    expect(diagnostics[0]).toContain("absent.html");
  });
});

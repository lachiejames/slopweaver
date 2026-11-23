/**
 * The two checks ahead of the courier's in-place exec, over real fixture trees: the launcher must be an executable
 * regular `#!` script, and main's launcher must not pick a built CLI its own staleness guard would refuse.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { launcherExecutable, mainBuiltCliRefusal } from "../../../../../cli/commands/talk/courierExecChecks.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("launcherExecutable", () => {
  /** A fresh directory holding a `slopweaver` path made by `make`. */
  function launcherAt({ make }: { make: (options: { readonly file: string }) => void }): string {
    const root = mkdtempSync(join(tmpdir(), "slopweaver-courier-launcher-"));
    dirs.push(root);
    const file = join(root, "slopweaver");
    make({ file });
    return file;
  }

  it("passes an executable regular file", () => {
    const file = launcherAt({
      make: ({ file: path }) => {
        writeFileSync(path, "#!/bin/sh\n");
        chmodSync(path, 0o755);
      },
    });
    expect(launcherExecutable({ file })).toBe(undefined);
  });

  it("refuses a searchable directory, which X_OK alone would pass", () => {
    const file = launcherAt({
      make: ({ file: path }) => {
        mkdirSync(path, { mode: 0o755 });
      },
    });
    expect(() => launcherExecutable({ file })).toThrow("it is not a regular file");
  });

  it("refuses a regular file without the executable bit", () => {
    const file = launcherAt({
      make: ({ file: path }) => {
        writeFileSync(path, "#!/bin/sh\n");
        chmodSync(path, 0o644);
      },
    });
    expect(() => launcherExecutable({ file })).toThrow("EACCES");
  });

  it("refuses an executable script with no #! line, which a shell runs but a direct exec cannot", () => {
    const file = launcherAt({
      make: ({ file: path }) => {
        writeFileSync(path, "exec node index.js\n");
        chmodSync(path, 0o755);
      },
    });
    expect(() => launcherExecutable({ file })).toThrow("it has no #! line, which a direct exec needs");
  });

  it("refuses a launcher that is not there", () => {
    const file = launcherAt({ make: () => undefined });
    expect(() => launcherExecutable({ file })).toThrow("ENOENT");
  });
});

describe("mainBuiltCliRefusal", () => {
  /** A main checkout with the given `dist-cli` files written, each with the given contents. */
  function mainWith({ files }: { files: Record<string, string> }): string {
    const root = mkdtempSync(join(tmpdir(), "slopweaver-courier-main-"));
    dirs.push(root);
    for (const [relative, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(root, relative)), { recursive: true });
      writeFileSync(join(root, relative), contents);
    }
    return root;
  }

  it("says nothing for a main that never built, which its launcher runs from source", () => {
    expect(mainBuiltCliRefusal({ env: {}, mainRoot: mainWith({ files: { "src/cli/index.ts": "" } }) })).toBe(undefined);
  });

  it("says nothing for a manifest with no entry, which its launcher also runs from source", () => {
    const mainRoot = mainWith({ files: { "dist-cli/.slopweaver-build.json": "not a manifest" } });
    expect(mainBuiltCliRefusal({ env: {}, mainRoot })).toBe(undefined);
  });

  it("names the refusal of a build its guard cannot place, which its launcher would run and the guard refuse", () => {
    const mainRoot = mainWith({ files: { "dist-cli/.slopweaver-build.json": "{}", "dist-cli/cli/index.js": "" } });
    expect(mainBuiltCliRefusal({ env: {}, mainRoot })).toContain("is not a build manifest");
  });

  it("refuses a manifest that is not even JSON rather than throwing out of the follower", () => {
    const mainRoot = mainWith({
      files: { "dist-cli/.slopweaver-build.json": "not a manifest", "dist-cli/cli/index.js": "" },
    });
    expect(mainBuiltCliRefusal({ env: {}, mainRoot })).toContain("is not a build manifest");
  });

  it("says nothing when the environment the exec passes on opens the stale-build hatch", () => {
    const mainRoot = mainWith({ files: { "dist-cli/.slopweaver-build.json": "{}", "dist-cli/cli/index.js": "" } });
    expect(mainBuiltCliRefusal({ env: { SLOPWEAVER_ALLOW_STALE_BUILD: "1" }, mainRoot })).toBe(undefined);
  });
});

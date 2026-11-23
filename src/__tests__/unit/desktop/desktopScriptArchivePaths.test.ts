/**
 * Which repository files outside `desktop/` an export must carry, read off the desktop manifest's scripts. The first
 * case reads the real committed manifest: before the fix the export held `desktop/` alone and the build died on
 * `../scripts/tsc-owner.sh` (exit 127), so this list is the update's own precondition.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { desktopScriptArchivePaths } from "../../../desktop/desktopScriptArchivePaths.js";
import { DesktopScriptArchiveErrors } from "../../../desktop/errors.js";

/** A manifest text holding exactly these scripts. */
function manifest({ scripts }: { scripts: Readonly<Record<string, unknown>> }): string {
  return JSON.stringify({ name: "slopweaver-desktop", scripts });
}

describe("desktopScriptArchivePaths", () => {
  it("names the compiler owner the real desktop manifest's build reaches", () => {
    const text = readFileSync(join(import.meta.dirname, "../../../..", "desktop/package.json"), "utf8");
    expect(unwrap(desktopScriptArchivePaths({ text }))).toEqual(["scripts/tsc-owner.sh"]);
  });

  it("reads every script, not only the build, naming each path once in manifest order", () => {
    const text = manifest({
      scripts: {
        build: "bash ../scripts/tsc-owner.sh -- tsc",
        lint: "node ../tools/lint.js && bash ../scripts/tsc-owner.sh -- tsc --noEmit",
        start: "electron .",
        watch: "sleep 1 & bash ../scripts/watch.sh ; node ../tools/lint.js | cat",
      },
    });
    expect(unwrap(desktopScriptArchivePaths({ text }))).toEqual([
      "scripts/tsc-owner.sh",
      "tools/lint.js",
      "scripts/watch.sh",
    ]);
  });

  it("names nothing when no script leaves desktop/, or one leaves and comes straight back", () => {
    const text = manifest({ scripts: { back: "node ../desktop/build/x.js", start: "electron ." } });
    expect(unwrap(desktopScriptArchivePaths({ text }))).toEqual([]);
  });

  it("refuses text that is not JSON", () => {
    expect(unwrapErr(desktopScriptArchivePaths({ text: "{" }))).toEqual(DesktopScriptArchiveErrors.manifestNotJson());
  });

  it("refuses a manifest with no scripts object", () => {
    const text = JSON.stringify({ scripts: ["build"] });
    expect(unwrapErr(desktopScriptArchivePaths({ text }))).toEqual(DesktopScriptArchiveErrors.noScripts());
  });

  it("refuses a script that is not a string", () => {
    const text = manifest({ scripts: { build: 1 } });
    expect(unwrapErr(desktopScriptArchivePaths({ text }))).toEqual(
      DesktopScriptArchiveErrors.scriptNotString({ script: "build" }),
    );
  });

  it("names a path reached through a flag's or an assignment's value, and a filename carrying , or = whole", () => {
    const text = manifest({
      scripts: {
        assigned: "ROOT=../tools node build/x.js",
        flag: "electron-builder --config.directories.output=../dist/app",
        named: "bash ../scripts/build,desktop.sh && bash ../scripts/a=b.sh",
      },
    });
    expect(unwrap(desktopScriptArchivePaths({ text }))).toEqual([
      "tools",
      "dist/app",
      "scripts/build,desktop.sh",
      "scripts/a=b.sh",
    ]);
  });

  it("refuses a `..` that is not exactly one path in the repository", () => {
    const words = ["a:../x", "../a=../b", "/../etc/x", "../tools/../config.json"];
    const refusals = words.map((word) =>
      unwrapErr(desktopScriptArchivePaths({ text: manifest({ scripts: { build: `cat ${word}` } }) })),
    );
    expect(refusals).toEqual([
      DesktopScriptArchiveErrors.notOnePath({ script: "build", word: "a:../x" }),
      DesktopScriptArchiveErrors.notOnePath({ script: "build", word: "../a=../b" }),
      DesktopScriptArchiveErrors.outsideRepo({ script: "build", word: "/../etc/x" }),
      DesktopScriptArchiveErrors.climbsBack({ script: "build", word: "../tools/../config.json" }),
    ]);
  });

  it("refuses any word carrying shell syntax, every way it can spell `..` without writing it included", () => {
    const words = [
      '"../scripts/tsc-owner.sh"',
      ".\\./scripts/tsc-owner.sh",
      "{.,}{.,}/scripts/tsc-owner.sh",
      "../scripts/*.sh",
      "$ROOT/scripts/tsc-owner.sh",
      "`git",
      "~/x",
      ">../log",
    ];
    const refusals = words.map((word) =>
      unwrapErr(desktopScriptArchivePaths({ text: manifest({ scripts: { build: `bash ${word}` } }) })),
    );
    expect(refusals).toEqual(words.map((word) => DesktopScriptArchiveErrors.shellSyntax({ script: "build", word })));
  });

  it("says which script and word carried the shell syntax, in the line the update failure shows", () => {
    const text = manifest({ scripts: { build: "bash $ROOT/scripts/tsc-owner.sh" } });
    expect(unwrapErr(desktopScriptArchivePaths({ text })).message).toBe(
      'desktop/package.json script "build" carries shell syntax in "$ROOT/scripts/tsc-owner.sh", so what it reaches is unread',
    );
  });

  it("refuses a path that is the whole repository or leaves it", () => {
    const root = manifest({ scripts: { build: "tar -c ../" } });
    const outside = manifest({ scripts: { build: "cat ../../secrets/token" } });
    expect([root, outside].map((text) => unwrapErr(desktopScriptArchivePaths({ text })))).toEqual([
      DesktopScriptArchiveErrors.outsideRepo({ script: "build", word: "../" }),
      DesktopScriptArchiveErrors.outsideRepo({ script: "build", word: "../../secrets/token" }),
    ]);
  });
});

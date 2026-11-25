import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { codexPluginHomes, homeOverlappingExport, pathWithin } from "../../../codexPlugin/homes.js";

describe("codexPluginHomes", () => {
  it("keeps every registered home in register order, then the ambient one", () => {
    const homes = codexPluginHomes({
      ambientCodexHome: "/u/.codex",
      destinations: [
        { alias: "codex-2", codexHome: "/s/two" },
        { alias: "codex-1", codexHome: "/s/one" },
      ],
    });
    expect(homes).toEqual([
      { codexHome: "/s/two", registered: true },
      { codexHome: "/s/one", registered: true },
      { codexHome: "/u/.codex", registered: false },
    ]);
  });

  it("keeps a home named twice once, by its first spelling, and an ambient home the register names as registered", () => {
    const homes = codexPluginHomes({
      ambientCodexHome: "/s/one/",
      destinations: [
        { alias: "codex-1", codexHome: "/s/one" },
        { alias: "codex-2", codexHome: "/s/x/../one" },
      ],
    });
    expect(homes).toEqual([{ codexHome: "/s/one", registered: true }]);
  });

  it("is the ambient home alone for an empty register", () => {
    expect(codexPluginHomes({ ambientCodexHome: "/u/.codex", destinations: [] })).toEqual([
      { codexHome: "/u/.codex", registered: false },
    ]);
  });
});

describe("pathWithin", () => {
  it("holds for the path itself and anything beneath it, never for a sibling sharing a prefix", () => {
    expect([
      pathWithin({ inner: "/c/plugin/", outer: "/c/plugin" }),
      pathWithin({ inner: "/c/plugin/x", outer: "/c/plugin" }),
      pathWithin({ inner: "/c/plugin-2", outer: "/c/plugin" }),
      pathWithin({ inner: "/c", outer: "/c/plugin" }),
    ]).toEqual([true, true, false, false]);
  });
});

describe("homeOverlappingExport", () => {
  const apart = { codexHome: "/u/.codex", registered: false };

  it("names a home that is the export root, holds it, or sits inside it", () => {
    const exportRoot = "/c/codex-plugin";
    const overlaps = [
      { codexHome: "/c/codex-plugin", registered: true },
      { codexHome: "/c", registered: true },
      { codexHome: "/c/codex-plugin/home", registered: true },
    ].map((home) => homeOverlappingExport({ exportRoot, homes: [apart, home] }));
    expect(overlaps).toEqual([
      { codexHome: "/c/codex-plugin", registered: true },
      { codexHome: "/c", registered: true },
      { codexHome: "/c/codex-plugin/home", registered: true },
    ]);
  });

  it("names a home that is a dangling link to the export root, which a lexical comparison misses", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-homes-")));
    const exportRoot = join(root, "cache", "codex-plugin");
    const linked = { codexHome: join(root, "home"), registered: true };
    symlinkSync(exportRoot, linked.codexHome);
    const found = homeOverlappingExport({ exportRoot, homes: [apart, linked] });
    rmSync(root, { force: true, recursive: true });
    expect(found).toEqual(linked);
  });

  it("is undefined when every home is apart from the export, a sibling sharing its prefix included", () => {
    const sibling = { codexHome: "/c/codex-plugin-2", registered: true };
    expect(homeOverlappingExport({ exportRoot: "/c/codex-plugin", homes: [apart, sibling] })).toBe(undefined);
  });
});

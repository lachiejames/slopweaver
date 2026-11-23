/**
 * The cache-root contract: which directory each platform and override resolves to, and the paths under it. Pure —
 * every input is injected, so no case reads this machine's own environment.
 */
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CACHE_HOME_VAR, cachePaths, slopweaverCacheRoot, slopweaverCacheRootOf } from "../../cacheHome.js";

describe("slopweaverCacheRootOf", () => {
  it("uses ~/Library/Caches/slopweaver on darwin with no override", () => {
    expect(slopweaverCacheRootOf({ env: {}, platform: "darwin", userHome: "/Users/someone" })).toBe(
      "/Users/someone/Library/Caches/slopweaver",
    );
  });

  it("ignores XDG_CACHE_HOME on darwin", () => {
    expect(
      slopweaverCacheRootOf({ env: { XDG_CACHE_HOME: "/x" }, platform: "darwin", userHome: "/Users/someone" }),
    ).toBe("/Users/someone/Library/Caches/slopweaver");
  });

  it("uses $XDG_CACHE_HOME/slopweaver off darwin when it is set", () => {
    expect(slopweaverCacheRootOf({ env: { XDG_CACHE_HOME: "/var/cache/me" }, platform: "linux", userHome: "/h" })).toBe(
      "/var/cache/me/slopweaver",
    );
  });

  it("falls to ~/.cache/slopweaver off darwin when XDG_CACHE_HOME is blank", () => {
    expect(slopweaverCacheRootOf({ env: { XDG_CACHE_HOME: "  " }, platform: "linux", userHome: "/h" })).toBe(
      "/h/.cache/slopweaver",
    );
  });

  it("lets a non-blank override win on every platform, stripped of a trailing slash", () => {
    expect(slopweaverCacheRootOf({ env: { [CACHE_HOME_VAR]: "/c/" }, platform: "darwin", userHome: "/h" })).toBe("/c");
    expect(slopweaverCacheRootOf({ env: { [CACHE_HOME_VAR]: "/c" }, platform: "linux", userHome: "/h" })).toBe("/c");
  });

  it("resolves a relative override against the working directory", () => {
    expect(slopweaverCacheRootOf({ env: { [CACHE_HOME_VAR]: "rel" }, platform: "darwin", userHome: "/h" })).toBe(
      resolve("rel"),
    );
  });

  it("refuses a user home that is not absolute when no override names the root", () => {
    expect(() => slopweaverCacheRootOf({ env: {}, platform: "linux", userHome: "" })).toThrow(
      `cache root: the user's home directory "" is not absolute; set ${CACHE_HOME_VAR}`,
    );
    expect(slopweaverCacheRootOf({ env: { [CACHE_HOME_VAR]: "/c" }, platform: "darwin", userHome: "" })).toBe("/c");
  });

  it("refuses an override or XDG cache home carrying a control character", () => {
    expect(() =>
      slopweaverCacheRootOf({ env: { [CACHE_HOME_VAR]: "/c\n" }, platform: "darwin", userHome: "/h" }),
    ).toThrow(`cache root: ${CACHE_HOME_VAR} carries a control character; set it to a plain directory path`);
    expect(() => slopweaverCacheRootOf({ env: { XDG_CACHE_HOME: "/x\t" }, platform: "linux", userHome: "/h" })).toThrow(
      "cache root: XDG_CACHE_HOME carries a control character; set it to a plain directory path",
    );
  });

  it("counts only ASCII whitespace as blank, so an override of a Unicode space is set", () => {
    expect(slopweaverCacheRootOf({ env: { [CACHE_HOME_VAR]: "﻿" }, platform: "darwin", userHome: "/h" })).toBe(
      resolve("﻿"),
    );
    expect(
      slopweaverCacheRootOf({ env: { [CACHE_HOME_VAR]: " \t\n\v\f\r" }, platform: "darwin", userHome: "/h" }),
    ).toBe("/h/Library/Caches/slopweaver");
  });

  it("treats a blank override as unset", () => {
    expect(slopweaverCacheRootOf({ env: { [CACHE_HOME_VAR]: " " }, platform: "darwin", userHome: "/h" })).toBe(
      "/h/Library/Caches/slopweaver",
    );
  });
});

describe("cachePaths", () => {
  it("lays every entry out under the root it is given", () => {
    expect(cachePaths({ root: "/c" })).toEqual({
      codexPlugin: "/c/codex-plugin",
      consoleSavedReadings: "/c/console/saved-readings",
      desktopLastUpdateJson: "/c/desktop/last-update.json",
      docsSite: "/c/docs-site",
      execStore: "/c/exec-store",
      lapTrees: "/c/lap-trees.noindex",
      root: "/c",
    });
  });

  it("defaults to this process's root, which every test lane sandboxes inside its own temp root", () => {
    expect(cachePaths().root).toBe(slopweaverCacheRoot());
    expect(slopweaverCacheRoot().startsWith(join(tmpdir(), ""))).toBe(true);
  });
});

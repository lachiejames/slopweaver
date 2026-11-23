/**
 * `installedTreeRoot` — the tree THIS BUILD lives in, found by walking up from a module's own file to the
 * nearest plugin manifest.
 *
 * Filesystem-only (a temp tree, no network, no shared service), which `.claude/rules/testing.md` permits
 * for a genuine round trip. Real directories rather than an injected seam, because the whole claim is about
 * what is actually on disk above a file.
 */
import { accessSync, constants, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  bundledLauncherPath,
  installedTreeRoot,
  isPluginCheckout,
  LAUNCHER_RELATIVE_PATH,
  PLUGIN_MANIFEST_RELATIVE_PATH,
} from "../../../lib/pluginRoot.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A tree with a plugin manifest at its root and a nested source file, exactly as an install lays one out. */
function pluginTree(): { readonly root: string; readonly moduleUrl: string } {
  const root = mkdtempSync(join(tmpdir(), "installed-tree-"));
  fixtureDirs.push(root);
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, PLUGIN_MANIFEST_RELATIVE_PATH), "{}", "utf8");
  const nested = join(root, "src", "live", "turn");
  mkdirSync(nested, { recursive: true });
  return { moduleUrl: pathToFileURL(join(nested, "posterAnswer.ts")).href, root };
}

describe("isPluginCheckout", () => {
  it("recognises a directory carrying the manifest", () => {
    expect(isPluginCheckout({ root: pluginTree().root })).toBe(true);
  });

  it("rejects a directory with no manifest", () => {
    const bare = mkdtempSync(join(tmpdir(), "installed-tree-bare-"));
    fixtureDirs.push(bare);
    expect(isPluginCheckout({ root: bare })).toBe(false);
  });
});

describe("installedTreeRoot", () => {
  /**
   * The load-bearing case. A marketplace mirror has no `.git` at any level, so this walk is the ONLY way to
   * name the tree the running code came out of — and it has to work from several directories deep.
   */
  it("walks up from a nested module to the tree's own manifest, with no git anywhere in it", () => {
    const tree = pluginTree();
    expect(installedTreeRoot({ cwd: "/somewhere/else", importMetaUrl: tree.moduleUrl })).toBe(tree.root);
  });

  it("ignores cwd entirely when a manifest is found, so standing in another repo cannot redirect it", () => {
    const tree = pluginTree();
    const other = pluginTree();
    expect(installedTreeRoot({ cwd: other.root, importMetaUrl: tree.moduleUrl })).toBe(tree.root);
  });

  it("answers the manifest directory itself for a module sitting directly in it", () => {
    const tree = pluginTree();
    const url = pathToFileURL(join(tree.root, "index.ts")).href;
    expect(installedTreeRoot({ cwd: "/somewhere/else", importMetaUrl: url })).toBe(tree.root);
  });

  it("falls back to cwd rather than throwing when no ancestor carries a manifest", () => {
    const bare = mkdtempSync(join(tmpdir(), "installed-tree-nomanifest-"));
    fixtureDirs.push(bare);
    const url = pathToFileURL(join(bare, "deep", "thing.ts")).href;
    expect(installedTreeRoot({ cwd: "/a/fallback", importMetaUrl: url })).toBe("/a/fallback");
  });
});

describe("bundledLauncherPath", () => {
  it("names the launcher inside the tree the anchoring module lives in, from several directories deep", () => {
    const tree = pluginTree();
    expect(bundledLauncherPath({ importMetaUrl: tree.moduleUrl })).toBe(join(tree.root, "bin", "slopweaver"));
  });

  it("is depth-independent, so a module directly in the tree root resolves the same launcher", () => {
    const tree = pluginTree();
    const shallow = pathToFileURL(join(tree.root, "index.ts")).href;
    const deep = pathToFileURL(join(tree.root, "src", "a", "b", "c", "d", "e.ts")).href;
    expect(bundledLauncherPath({ importMetaUrl: shallow })).toBe(bundledLauncherPath({ importMetaUrl: deep }));
  });

  /**
   * The witness that actually closes finding `688-s-ticker-remedy-line-embeds-claude-plugin`. The old
   * printed form was not merely ugly — with `CLAUDE_PLUGIN_ROOT` empty it named `/bin/slopweaver`, a path
   * that is not on disk. RUNNABILITY is the property, so it is asserted against this checkout's real tree
   * rather than a fixture: a fixture can only ever prove the string was joined.
   */
  it("resolves this checkout's own launcher, which exists on disk and is executable", () => {
    const launcher = bundledLauncherPath({ importMetaUrl: import.meta.url });
    expect(launcher.endsWith(LAUNCHER_RELATIVE_PATH)).toBe(true);
    expect(statSync(launcher).isFile()).toBe(true);
    // `accessSync` throws rather than answering, so reaching the next line IS the assertion; the explicit
    // `toBe(true)` keeps the case from passing on an empty body if the call is ever removed.
    accessSync(launcher, constants.X_OK);
    expect(launcher.startsWith("/bin/")).toBe(false);
  });
});

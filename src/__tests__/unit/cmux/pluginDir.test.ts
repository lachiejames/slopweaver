/**
 * How a spawned session loads Slopweaver — the pure route decision, plus real filesystem round trips for the
 * manifest probe and for the marketplace install record.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  installedPluginNames,
  pluginDirForSpawn,
  pluginDirForSpawnTarget,
  slopweaverPluginInstalled,
  spawnLoadRouteRefusal,
} from "../../../cmux/pluginDir.js";
import { isPluginCheckout, PLUGIN_MANIFEST_RELATIVE_PATH } from "../../../lib/pluginRoot.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A temp directory, optionally carrying a plugin manifest. */
function checkout({ withManifest }: { withManifest: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), "plugin-dir-"));
  fixtureDirs.push(root);
  if (withManifest) {
    const manifest = join(root, PLUGIN_MANIFEST_RELATIVE_PATH);
    mkdirSync(dirname(manifest), { recursive: true });
    writeFileSync(manifest, "{}\n");
  }
  return root;
}

/** A temp `~/.claude` carrying the given `installed_plugins.json` text, or none at all. */
function claudeDir({ installedPlugins }: { installedPlugins: string | undefined }): string {
  const root = mkdtempSync(join(tmpdir(), "claude-dir-"));
  fixtureDirs.push(root);
  if (installedPlugins !== undefined) {
    mkdirSync(join(root, "plugins"), { recursive: true });
    writeFileSync(join(root, "plugins", "installed_plugins.json"), installedPlugins);
  }
  return root;
}

describe("isPluginCheckout", () => {
  it("is true for a directory carrying the manifest", () => {
    expect(isPluginCheckout({ root: checkout({ withManifest: true }) })).toBe(true);
  });

  it("is false for one that does not", () => {
    expect(isPluginCheckout({ root: checkout({ withManifest: false }) })).toBe(false);
  });

  it("is false for a directory that does not exist at all", () => {
    expect(isPluginCheckout({ root: join(tmpdir(), "definitely-not-here-9f2a") })).toBe(false);
  });
});

describe("pluginDirForSpawn", () => {
  it("points a session at its OWN worktree when the target repo is a plugin checkout", () => {
    expect(pluginDirForSpawn({ cwd: "/wt/successor", targetRepoIsPluginCheckout: true })).toBe("/wt/successor");
  });

  it("takes the marketplace route when the target repo is not a plugin checkout", () => {
    expect(pluginDirForSpawn({ cwd: "/other-repo/wt/x", targetRepoIsPluginCheckout: false })).toBeUndefined();
  });
});

describe("pluginDirForSpawnTarget", () => {
  it("pins the plugin-dir to the doc's own worktree when its repo carries a manifest", () => {
    expect(pluginDirForSpawnTarget({ cwd: "/worktrees/some-doc", repoRoot: checkout({ withManifest: true }) })).toBe(
      "/worktrees/some-doc",
    );
  });

  it("takes the marketplace route when the target repo carries no manifest", () => {
    expect(
      pluginDirForSpawnTarget({ cwd: "/worktrees/some-doc", repoRoot: checkout({ withManifest: false }) }),
    ).toBeUndefined();
  });

  it("takes the marketplace route when the target repo does not exist at all", () => {
    expect(
      pluginDirForSpawnTarget({ cwd: "/worktrees/some-doc", repoRoot: join(tmpdir(), "no-such-repo-4c1e") }),
    ).toBeUndefined();
  });
});

describe("installedPluginNames", () => {
  it("strips the marketplace suffix from every key", () => {
    const document = { plugins: { "slack@claude-plugins-official": [], "slopweaver@slopweaver-dev": [] } };
    expect(installedPluginNames({ document })).toStrictEqual(["slack", "slopweaver"]);
  });

  it("keeps a key that carries no marketplace suffix", () => {
    expect(installedPluginNames({ document: { plugins: { bare: [] } } })).toStrictEqual(["bare"]);
  });

  it("keeps an empty name for a key that is empty or opens on the suffix", () => {
    expect(installedPluginNames({ document: { plugins: { "": [], "@market": [] } } })).toStrictEqual(["", ""]);
  });

  it("is empty for a document with no plugins key", () => {
    expect(installedPluginNames({ document: { version: 2 } })).toStrictEqual([]);
  });

  it("is empty for a plugins value that is not an object", () => {
    expect(installedPluginNames({ document: { plugins: "slopweaver" } })).toStrictEqual([]);
  });

  it("is empty for a document that is not an object", () => {
    expect(installedPluginNames({ document: null })).toStrictEqual([]);
  });
});

describe("slopweaverPluginInstalled", () => {
  it("is true when the record names slopweaver", () => {
    const dir = claudeDir({ installedPlugins: '{"version":2,"plugins":{"slopweaver@slopweaver-dev":[]}}' });
    expect(slopweaverPluginInstalled({ claudeDir: dir })).toBe(true);
  });

  it("is false when the record names only other plugins", () => {
    const dir = claudeDir({ installedPlugins: '{"version":2,"plugins":{"slack@claude-plugins-official":[]}}' });
    expect(slopweaverPluginInstalled({ claudeDir: dir })).toBe(false);
  });

  it("is false when the record is not there at all", () => {
    expect(slopweaverPluginInstalled({ claudeDir: claudeDir({ installedPlugins: undefined }) })).toBe(false);
  });

  it("is false for a record that is not valid JSON, rather than throwing", () => {
    expect(slopweaverPluginInstalled({ claudeDir: claudeDir({ installedPlugins: "{not json" }) })).toBe(false);
  });
});

describe("spawnLoadRouteRefusal", () => {
  it("refuses a marketplace-route spawn on a machine with no install, naming the repo and the command", () => {
    const refusal = spawnLoadRouteRefusal({ installed: false, pluginDir: undefined, repoRoot: "/repos/acme-admin" });
    expect(refusal).toBe(
      "/repos/acme-admin is not a Slopweaver checkout, so this session would load the marketplace install, and " +
        "no plugin named slopweaver is installed on this machine. Install it with " +
        "`claude plugin install slopweaver@slopweaver-dev` and spawn again",
    );
  });

  it("allows a marketplace-route spawn once the install is there", () => {
    expect(
      spawnLoadRouteRefusal({ installed: true, pluginDir: undefined, repoRoot: "/repos/acme-admin" }),
    ).toBeUndefined();
  });

  it("allows a dogfooding spawn with no install at all, because the flag is its route", () => {
    expect(
      spawnLoadRouteRefusal({ installed: false, pluginDir: "/wt/some-doc", repoRoot: "/repos/slopweaver" }),
    ).toBeUndefined();
  });
});

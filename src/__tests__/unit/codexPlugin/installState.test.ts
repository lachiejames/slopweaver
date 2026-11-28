import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pluginCacheDir, pluginInstallState } from "../../../codexPlugin/installState.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { loopInstallPath } from "./fleetFixture.js";

let codexHome: string;

beforeEach(() => {
  codexHome = mkdtempSync(join(tmpdir(), "codex-install-state-"));
});

afterEach(() => {
  rmSync(codexHome, { force: true, recursive: true });
});

/** Write the stamp file's raw text into the `personal` cache of {@link codexHome}. */
function writeStamp({ raw }: { raw: string }): string {
  const dir = join(pluginCacheDir({ codexHome, marketplace: "personal" }), ".codex-plugin");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "source.json"), raw);
  return join(dir, "source.json");
}

/** The message `JSON.parse` gives for `raw`, which an invalid stamp carries as its reason. */
function parseFailure({ raw }: { raw: string }): string {
  try {
    JSON.parse(raw);
  } catch (error: unknown) {
    return errorMessage({ error });
  }
  throw new Error(`expected ${raw} not to parse`);
}

describe("pluginInstallState", () => {
  it("places the cache under the home, the marketplace and the unversioned key", () => {
    expect(pluginCacheDir({ codexHome: "/c", marketplace: "personal" })).toBe(
      "/c/plugins/cache/personal/slopweaver/local",
    );
  });

  it("is absent with no stamp", () => {
    const stampPath = join(pluginCacheDir({ codexHome, marketplace: "personal" }), ".codex-plugin", "source.json");
    expect(pluginInstallState({ codexHome, marketplace: "personal" })).toEqual({ kind: "absent", stampPath });
  });

  it("is absent when a directory above the stamp is a file, which a lookup reads as ENOTDIR", () => {
    const marketplaceDir = join(codexHome, "plugins", "cache", "personal");
    mkdirSync(marketplaceDir, { recursive: true });
    writeFileSync(join(marketplaceDir, "slopweaver"), "not a directory");
    const stampPath = join(pluginCacheDir({ codexHome, marketplace: "personal" }), ".codex-plugin", "source.json");

    expect(pluginInstallState({ codexHome, marketplace: "personal" })).toEqual({ kind: "absent", stampPath });
  });

  it("is unreadable, never absent, when the stamp's path cannot be looked up", () => {
    const stampPath = loopInstallPath({ codexHome });

    const state = pluginInstallState({ codexHome, marketplace: "personal" });

    expect(state.kind).toBe("unreadable");
    expect(state.stampPath).toBe(stampPath);
    expect(state).toHaveProperty("why", expect.stringContaining("ELOOP"));
  });

  it("is installed on the stamp's full commit", () => {
    const stampPath = writeStamp({ raw: JSON.stringify({ commit: "c".repeat(40) }) });
    expect(pluginInstallState({ codexHome, marketplace: "personal" })).toEqual({
      commit: "c".repeat(40),
      kind: "installed",
      stampPath,
    });
  });

  it("names an unparseable stamp and an abbreviated commit as invalid, never as absent", () => {
    const unparseablePath = writeStamp({ raw: "{" });
    expect(pluginInstallState({ codexHome, marketplace: "personal" })).toEqual({
      kind: "invalid",
      stampPath: unparseablePath,
      why: parseFailure({ raw: "{" }),
    });
    const stampPath = writeStamp({ raw: JSON.stringify({ commit: "abc123" }) });
    expect(pluginInstallState({ codexHome, marketplace: "personal" })).toEqual({
      kind: "invalid",
      stampPath,
      why: "it names no full commit",
    });
  });
});

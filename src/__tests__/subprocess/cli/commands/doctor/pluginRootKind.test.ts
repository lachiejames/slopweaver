import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { observePluginRoot, pluginVersion } from "../../../../../cli/commands/doctor/pluginReport.js";
import { doctorJsonReport, doctorReport } from "../../../../../cli/commands/doctor/run.js";
import { hookMirrorRoot } from "../../../../pluginRootFixture.js";

/** The release version `pluginVersion` falls back to, read from the same package.json it reads. */
const packageVersion = (
  JSON.parse(readFileSync(new URL("../../../../../../package.json", import.meta.url), "utf8")) as { version: string }
).version;

/** Injected rather than the real home, so these assertions never depend on this machine. */
const CODEX_PATHS = { authPath: "/nope/.codex/auth.json", configPath: "/nope/.codex/config.toml" };

const PLUGINS_DIR = "/synthetic/.claude/plugins";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-doctor-root-kind-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("doctor's observed plugin root kind", () => {
  it("reads a blank root as no root, so the release version answers rather than a directory named by spaces", () => {
    expect(pluginVersion({ host: "claude-code", pluginRoot: " " })).toBe(packageVersion);
  });

  it("says UNCONFIRMED on every line for a blank root, never MISSING", () => {
    const plugin = {
      insideAgentHost: true,
      pluginRoot: " ",
      pluginsDir: PLUGINS_DIR,
      rootKind: observePluginRoot({ host: "claude-code", pluginRoot: " " }),
    };
    const lines = doctorReport({ codex: CODEX_PATHS, envHome: home, home, plugin, version: "9.9.9" });
    const report = doctorJsonReport({ codex: CODEX_PATHS, envHome: home, home, plugin, version: "9.9.9" });

    expect(lines[1]).toContain("plugin: load route UNCONFIRMED");
    expect(lines[2]).toContain("Codex continuity skills UNCONFIRMED (no plugin root)");
    expect(report.pluginRoot).toBe(null);
    expect(report.statuses["pluginRootKind"]).toBe("none");
  });

  it("reports the hook mirror's launcher as the mirror, its skills not applicable, from one observation", () => {
    const root = hookMirrorRoot({ data: join(home, "plugin-data") });
    const plugin = {
      insideAgentHost: true,
      pluginRoot: root,
      pluginsDir: home,
      rootKind: observePluginRoot({ host: "claude-code", pluginRoot: root }),
    };
    const lines = doctorReport({ codex: CODEX_PATHS, envHome: home, home, plugin, version: "9.9.9" });
    const report = doctorJsonReport({ codex: CODEX_PATHS, envHome: home, home, plugin, version: "9.9.9" });

    expect(lines[1]).toContain(`plugin: load route UNCONFIRMED — ${root} is the hook mirror`);
    expect(lines[2]).toContain("Codex continuity skills NOT APPLICABLE");
    expect(report.statuses["pluginLoad"]).toBe("hook-mirror");
    expect(report.statuses["pluginRootKind"]).toBe("hook-mirror");
    // The booleans stay the files' truth; a JSON reader tells the mirror apart by the two statuses above.
    expect(report.codexContinuitySkills).toEqual({ handover: false, orchestrate: false, pickup: false });
  });
});

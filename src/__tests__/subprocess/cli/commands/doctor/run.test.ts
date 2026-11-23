import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginLoadEvidence, PluginRootKind } from "../../../../../cli/commands/doctor/pluginReport.js";
import {
  classifyPluginLoad,
  hostPluginRoot,
  pluginLoadLine,
  pluginSurface,
  pluginVersion,
} from "../../../../../cli/commands/doctor/pluginReport.js";
import { doctorJsonReport, doctorReport } from "../../../../../cli/commands/doctor/run.js";
import { withSourceCommit } from "../../../../../codexPlugin/stamp.js";
import type { EnvironmentProbe } from "../../../../../environment/facts.js";
import { runInit } from "../../../../../init/stateInit.js";
import { err, ok } from "../../../../../lib/result.js";
import { reserveSelfReviewRound } from "../../../../../outbound/github/selfReviewLedger.js";
import { IdentityRosterErrors } from "../../../../../silver/identityRosterErrors.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { pluginRootWith } from "../../../../pluginRootFixture.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

/** The release version `pluginVersion` falls back to, read from the same package.json it reads. */
const packageVersion = (
  JSON.parse(readFileSync(new URL("../../../../../../package.json", import.meta.url), "utf8")) as { version: string }
).version;

/** A real repo's main checkout, in a fresh temp dir, still on its default branch. */
function realMainCheckout(): string {
  const main = mkdtempSync(join(tmpdir(), "slop-doctor-main-checkout-"));
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: main });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: main });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: main });
  writeFileSync(join(main, "package.json"), JSON.stringify({ name: "slopweaver" }));
  gitInTemp({ args: ["add", "package.json"], cwd: main });
  gitInTemp({ args: ["commit", "-q", "-m", "root"], cwd: main });
  return main;
}

/** Injected rather than the real home, so these assertions never depend on this machine. */
const CODEX_PATHS = { authPath: "/nope/.codex/auth.json", configPath: "/nope/.codex/config.toml" };

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-doctor-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const PLUGINS_DIR = "/synthetic/.claude/plugins";
const noPlugin = { insideAgentHost: false, pluginRoot: undefined, pluginsDir: PLUGINS_DIR, rootKind: "none" } as const;

describe("doctorReport", () => {
  it("reports an initialised home: version, corpus roots, valid seeds", () => {
    runInit({ home });
    const lines = doctorReport({ codex: CODEX_PATHS, envHome: home, home, plugin: noPlugin, version: "9.9.9" });
    expect(lines[0]).toBe("slopweaver v9.9.9");
    expect(lines).toContain(`SLOPWEAVER_HOME: ${home}`);
    expect(lines).toContain("home version: 1");
    expect(lines).toContain(
      "corpus: bronze exists (empty) · silver exists (empty) · gold exists (empty) · history exists (empty)",
    );
    expect(lines).toContain(
      "identity roster: in the store, not checked (--deep peeks it) — no retired identity.json in the home",
    );
    expect(lines).toContain("profile.json: present (valid)");
    expect(lines).toContain("hygiene-denylist.txt: present");
    expect(lines[lines.length - 1]).toBe("ok");
  });

  it("reports an uninitialised home as not-initialised, pointing at init", () => {
    const lines = doctorReport({ codex: CODEX_PATHS, envHome: undefined, home, plugin: noPlugin, version: "9.9.9" });
    expect(lines).toContain("home version: not initialised — run `slopweaver init`");
    expect(lines).toContain("corpus: bronze missing · silver missing · gold missing · history missing");
    expect(lines).toContain("profile.json: missing — run `slopweaver init`");
    expect(lines).toContain(`SLOPWEAVER_HOME: unset — using default ${home}`);
  });

  it("is read-only — reporting creates nothing", () => {
    doctorReport({ codex: CODEX_PATHS, envHome: home, home, plugin: noPlugin, version: "9.9.9" });
    expect(readdirSync(home)).toEqual([]);
  });

  it("names the cache root apart from the home, in the report and the JSON", () => {
    const cacheRoot = join(home, "elsewhere-cache");
    const lines = doctorReport({ cacheRoot, codex: CODEX_PATHS, envHome: home, home, plugin: noPlugin, version: "9" });
    const report = doctorJsonReport({
      cacheRoot,
      codex: CODEX_PATHS,
      envHome: home,
      home,
      plugin: noPlugin,
      version: "9",
    });
    expect(lines).toContain(`cache (rebuildable, outside the home): ${cacheRoot}`);
    expect(report.cacheRoot).toBe(cacheRoot);
    expect(readdirSync(home)).toEqual([]);
  });

  it("omits the main-checkout line when no cwd is given", () => {
    const lines = doctorReport({ codex: CODEX_PATHS, envHome: home, home, plugin: noPlugin, version: "9.9.9" });
    expect(lines.some((line) => line.startsWith("main checkout:"))).toBe(false);
  });

  it("reports a clean real main checkout", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const cwd = realMainCheckout();
    const lines = doctorReport({ codex: CODEX_PATHS, cwd, envHome: home, home, plugin: noPlugin, version: "9.9.9" });
    expect(lines).toContain("main checkout: clean");
  });

  it(
    "reports a dirty real main checkout with the change count, before the final ok",
    {
      timeout: REAL_GIT_TIMEOUT_MS,
    },
    () => {
      const cwd = realMainCheckout();
      writeFileSync(join(cwd, "untracked.txt"), "hi");
      const lines = doctorReport({ codex: CODEX_PATHS, cwd, envHome: home, home, plugin: noPlugin, version: "9.9.9" });
      // Positional rather than `toContain`, so the cleanliness line's PLACE in the report is pinned: it sits
      // after the state-home block and before the declared-main-checkout section the report now ends with.
      expect(lines[lines.length - 3]).toContain("main checkout: DIRTY (1 change(s)");
      expect(lines[lines.length - 2]).toBe(
        "main checkouts: none declared — add `mainCheckouts` to profile.json (see docs/main-checkouts.md)",
      );
      expect(lines[lines.length - 1]).toBe("ok");
    },
  );
});

/** One fatal and one warning probe, as `environmentProbes` would grade a machine with no git and no cmux. */
const FATAL_GIT: EnvironmentProbe = {
  fix: "`xcode-select --install`",
  id: "git",
  says: "`git` is not on PATH",
  scope: "slopweaver",
  verdict: "fatal",
  withoutFix: "almost nothing works",
};
const NO_CMUX: EnvironmentProbe = {
  fix: "install cmux",
  id: "cmux",
  says: "`cmux` is not on PATH",
  scope: "slopweaver",
  verdict: "warning",
  withoutFix: "the supervisor is unavailable",
};

describe("doctorReport's environment section", () => {
  it("renders the probes under the version line, and a fatal one as the report's last line", () => {
    const lines = doctorReport({
      codex: CODEX_PATHS,
      environment: [FATAL_GIT, NO_CMUX],
      envHome: home,
      home,
      plugin: noPlugin,
      version: "9.9.9",
    });
    expect(lines.slice(0, 8)).toEqual([
      "slopweaver v9.9.9",
      "environment (free probes only — `doctor --deep` also checks gh login, the cmux socket and zsh startup):",
      "  [FATAL] git — `git` is not on PATH",
      "      fix: `xcode-select --install`",
      "      continuing without it: almost nothing works",
      "  [warning] cmux — `cmux` is not on PATH",
      "      fix: install cmux",
      "      continuing without it: the supervisor is unavailable",
    ]);
    expect(lines[lines.length - 1]).toBe("FATAL — Slopweaver cannot run on this machine until git is fixed");
  });

  it("ends on a warning count when nothing is fatal", () => {
    const lines = doctorReport({
      codex: CODEX_PATHS,
      deep: true,
      environment: [NO_CMUX],
      envHome: home,
      home,
      plugin: noPlugin,
      version: "9.9.9",
    });
    expect(lines[1]).toBe("environment (every probe, including gh login, the cmux socket and zsh startup):");
    expect(lines[lines.length - 1]).toBe("ok — 1 warning(s) above");
  });

  it("carries every probe and the counts an exit code is decided on in the JSON report", () => {
    const report = doctorJsonReport({
      codex: CODEX_PATHS,
      environment: [FATAL_GIT, NO_CMUX],
      envHome: home,
      home,
      plugin: noPlugin,
      version: "9.9.9",
    });
    expect(report.environment).toEqual({
      deep: false,
      fatal: 1,
      probes: [FATAL_GIT, NO_CMUX],
      unchecked: 0,
      warnings: 1,
    });
  });
});

describe("doctorJsonReport", () => {
  it("reports a stable, structured shape for an initialised home", () => {
    runInit({ home });
    const report = doctorJsonReport({ codex: CODEX_PATHS, envHome: home, home, plugin: noPlugin, version: "9.9.9" });
    expect(report.version).toBe("9.9.9");
    expect(report.home).toBe(home);
    expect(report.initialised).toBe(true);
    expect(report.statuses["identity"]).toBe("retired-file-absent");
    expect(report.statuses["profile"]).toBe("present-valid");
    expect(report.statuses["secrets"]).toBe("exists (empty)");
    expect(report.paths["secrets"]).toBe(stateHomePaths({ home }).secrets);
    expect(report.pluginRoot).toBeNull();
    expect(report.statuses["pluginHookTrust"]).toBe("host-only-unverified");
  });

  it("reports an uninitialised home as not initialised, with missing seeds", () => {
    const report = doctorJsonReport({
      codex: CODEX_PATHS,
      envHome: undefined,
      home,
      plugin: noPlugin,
      version: "9.9.9",
    });
    expect(report.initialised).toBe(false);
    expect(report.envHome).toBe(null);
    expect(report.statuses["identity"]).toBe("retired-file-absent");
    expect(report.statuses["bronze"]).toBe("missing");
  });

  it("reports the peeked roster row under --deep by revision and count, never a person", () => {
    const identityRoster = ok({
      records: [{ handle: "ada", id: "person:ada", name: "Ada Lovelace" }],
      retiredFile: undefined,
      revision: 2,
    });
    const shared = { codex: CODEX_PATHS, deep: true, envHome: home, home, identityRoster, plugin: noPlugin };
    const lines = doctorReport({ ...shared, environment: [], version: "9.9.9" });
    expect(lines).toContain("identity roster: store row revision 2, 1 person record(s)");
    // The input row carries the name above; the report must not.
    expect(lines.join("\n")).not.toContain("Ada Lovelace");
    expect(doctorJsonReport({ ...shared, environment: [], version: "9.9.9" }).statuses["identity"]).toBe("store-row");
  });

  it("reports a store that cannot answer under --deep as unreadable, never as an empty roster", () => {
    const identityRoster = err(
      IdentityRosterErrors.storeUnavailable({ doing: "read", reason: "no database is selected" }),
    );
    const shared = { codex: CODEX_PATHS, deep: true, envHome: home, home, identityRoster, plugin: noPlugin };
    const lines = doctorReport({ ...shared, environment: [], version: "9.9.9" });
    expect(lines.some((line) => line.startsWith("identity roster: store UNREADABLE — "))).toBe(true);
    expect(doctorJsonReport({ ...shared, environment: [], version: "9.9.9" }).statuses["identity"]).toBe(
      "store-unreadable",
    );
  });

  it("never emits identity or profile CONTENTS — only a parse status", () => {
    runInit({ home });
    const p = stateHomePaths({ home });
    // The seeded profile with one field changed, so it still PARSES: a profile the report rejects proves
    // only that it read a broken file, not that a valid one's contents stay out of the report.
    const seeded = JSON.parse(readFileSync(p.profileJson, "utf8")) as Record<string, unknown>;
    const profile = { ...seeded, displayName: "SENSITIVE-NAME" };
    writeFileSync(p.profileJson, JSON.stringify(profile), "utf8");
    const report = doctorJsonReport({ codex: CODEX_PATHS, envHome: home, home, plugin: noPlugin, version: "9.9.9" });
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule — and here the input half is
    // two facts: the profile on disk carries the name, and the report really read that file.
    expect(readFileSync(p.profileJson, "utf8")).toContain("SENSITIVE-NAME");
    expect(report.statuses["profile"]).toBe("present-valid");
    expect(JSON.stringify(report)).not.toContain("SENSITIVE-NAME");
  });

  it("reports mainCheckout as unknown when no cwd is given", () => {
    const report = doctorJsonReport({ codex: CODEX_PATHS, envHome: home, home, plugin: noPlugin, version: "9.9.9" });
    expect(report.statuses["mainCheckout"]).toBe("unknown");
  });

  it("reports mainCheckout as dirty for a real dirty main checkout", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const cwd = realMainCheckout();
    writeFileSync(join(cwd, "untracked.txt"), "hi");
    const report = doctorJsonReport({
      codex: CODEX_PATHS,
      cwd,
      envHome: home,
      home,
      plugin: noPlugin,
      version: "9.9.9",
    });
    expect(report.statuses["mainCheckout"]).toBe("dirty");
  });
});

describe("installed plugin identity", () => {
  it("reads Codex's cachebusted host manifest instead of the stable package version", () => {
    const root = join(home, "plugin");
    mkdirSync(join(root, ".codex-plugin"), { recursive: true });
    writeFileSync(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ version: "0.2.0+codex.123" }));

    expect(pluginVersion({ host: "codex", pluginRoot: root })).toBe("0.2.0+codex.123");
  });

  it("names the commit a plugin-sync export was cut from, beside the release version", () => {
    const root = join(home, "plugin");
    const commit = "0123456789abcdef0123456789abcdef01234567";
    mkdirSync(join(root, ".codex-plugin"), { recursive: true });
    writeFileSync(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "slopweaver" }));
    writeFileSync(join(root, ".codex-plugin", "source.json"), JSON.stringify({ commit }));

    const version = withSourceCommit({ pluginRoot: root, version: pluginVersion({ host: "codex", pluginRoot: root }) });
    expect(version).toBe(`${packageVersion}+${commit}`);
  });

  it("proves all three continuity skills and the bundled hook file from the exact loaded root", () => {
    const root = pluginRootWith({ root: join(home, "plugin"), skills: ["handover", "orchestrate", "pickup"] });
    mkdirSync(join(root, "hooks"), { recursive: true });
    writeFileSync(join(root, "hooks", "hooks.json"), "{}");

    expect(pluginSurface({ pluginRoot: root })).toEqual({
      hooks: "present",
      skills: { handover: true, orchestrate: true, pickup: true },
    });
  });

  it("reports host trust as unverified rather than inferring it from a hook file", () => {
    const root = join(home, "plugin");
    mkdirSync(join(root, "hooks"), { recursive: true });
    writeFileSync(join(root, "hooks", "hooks.json"), "{}");
    const report = doctorJsonReport({
      codex: CODEX_PATHS,
      envHome: home,
      home,
      plugin: { insideAgentHost: true, pluginRoot: root, pluginsDir: PLUGINS_DIR, rootKind: "manifestless" },
      version: "0.2.0+codex.123",
    });

    expect(report.statuses["pluginHooks"]).toBe("present");
    expect(report.statuses["pluginHookTrust"]).toBe("host-only-unverified");
  });
});

describe("hostPluginRoot", () => {
  it("takes Codex's PLUGIN_ROOT over Claude Code's when both are set", () => {
    expect(hostPluginRoot({ env: { CLAUDE_PLUGIN_ROOT: "/claude", PLUGIN_ROOT: "/codex" } })).toBe("/codex");
  });

  it("falls to CLAUDE_PLUGIN_ROOT when PLUGIN_ROOT is unset", () => {
    expect(hostPluginRoot({ env: { CLAUDE_PLUGIN_ROOT: "/claude" } })).toBe("/claude");
  });

  it("keeps an empty PLUGIN_ROOT rather than skipping past it", () => {
    expect(hostPluginRoot({ env: { CLAUDE_PLUGIN_ROOT: "/claude", PLUGIN_ROOT: "" } })).toBe("");
  });

  it("proves no root when neither host set one", () => {
    expect(hostPluginRoot({ env: {} })).toBe(undefined);
  });
});

// PR5.4: the plugin silently failed to load for weeks while `doctor` reported the home in detail and said
// nothing about its own presence. These assert the exact line for every route it can actually prove.
/** One load observation under the synthetic plugins dir: inside a host or not, the root, and its observed kind. */
function seen(at: { host: boolean; root: string | undefined; kind: PluginRootKind }): PluginLoadEvidence {
  return { insideAgentHost: at.host, pluginRoot: at.root, pluginsDir: PLUGINS_DIR, rootKind: at.kind };
}

describe("classifyPluginLoad", () => {
  it("proves a marketplace install from a root under the Claude plugins dir", () => {
    const root = `${PLUGINS_DIR}/marketplaces/slopweaver-dev`;
    expect(classifyPluginLoad(seen({ host: true, kind: "plugin", root }))).toBe("marketplace");
  });

  it("proves a --plugin-dir dev checkout from a root outside the plugins dir", () => {
    expect(classifyPluginLoad(seen({ host: true, kind: "plugin", root: "/work/slopweaver" }))).toBe("plugin-dir");
  });

  it("says UNCONFIRMED (never 'not loaded') for a bare CLI run inside Claude Code", () => {
    expect(classifyPluginLoad(seen({ host: true, kind: "none", root: undefined }))).toBe("unconfirmed");
  });

  it("treats an empty CLAUDE_PLUGIN_ROOT as absent, not as a root", () => {
    expect(classifyPluginLoad(seen({ host: true, kind: "none", root: "" }))).toBe("unconfirmed");
  });

  it("reports no plugin context outside Claude Code", () => {
    expect(classifyPluginLoad(seen({ host: false, kind: "none", root: undefined }))).toBe("outside-agent-host");
  });

  it("does not call an absolute launcher a loaded plugin when no agent host exists", () => {
    expect(classifyPluginLoad(seen({ host: false, kind: "plugin", root: "/work/slopweaver" }))).toBe(
      "outside-agent-host",
    );
  });
});

describe("pluginLoadLine", () => {
  it("names the route and the root when loaded via --plugin-dir", () => {
    expect(pluginLoadLine({ pluginRoot: "/work/slopweaver", route: "plugin-dir" })).toBe(
      "plugin: loaded — --plugin-dir dev checkout (/work/slopweaver)",
    );
  });

  it("names a marketplace install", () => {
    expect(pluginLoadLine({ pluginRoot: `${PLUGINS_DIR}/x`, route: "marketplace" })).toBe(
      `plugin: loaded — marketplace install (${PLUGINS_DIR}/x)`,
    );
  });

  it("tells the user how to confirm when the route is unproven", () => {
    expect(pluginLoadLine({ pluginRoot: undefined, route: "unconfirmed" })).toBe(
      "plugin: load route UNCONFIRMED — PLUGIN_ROOT is unset, so this invocation did not come through the plugin's skills, commands or hooks. Check the host's plugin list to confirm Slopweaver is loaded.",
    );
  });

  it("says not-applicable outside a supported agent host", () => {
    expect(pluginLoadLine({ pluginRoot: undefined, route: "outside-agent-host" })).toBe(
      "plugin: not applicable — running outside a supported agent host (no plugin context)",
    );
  });
});

describe("doctorReport plugin line", () => {
  it("is the second line, right after the version", () => {
    const lines = doctorReport({
      codex: CODEX_PATHS,
      envHome: home,
      home,
      plugin: seen({ host: true, kind: "plugin", root: "/work/slopweaver" }),
      version: "9.9.9",
    });
    expect(lines[1]).toBe("plugin: loaded — --plugin-dir dev checkout (/work/slopweaver)");
  });

  it("names the exact continuity files but never claims the host trusted the hooks", () => {
    const root = pluginRootWith({ root: join(home, "plugin"), skills: [] });
    const lines = doctorReport({
      codex: CODEX_PATHS,
      envHome: home,
      home,
      plugin: { insideAgentHost: true, pluginRoot: root, pluginsDir: PLUGINS_DIR, rootKind: "plugin" },
      version: "9.9.9",
    });

    expect(lines[2]).toContain("Codex continuity skills MISSING (handover, orchestrate, pickup)");
    expect(lines[2]).toContain("hook trust host-only");
  });

  it("surfaces the route in the JSON report the slash commands branch on", () => {
    const report = doctorJsonReport({
      codex: CODEX_PATHS,
      envHome: home,
      home,
      plugin: { insideAgentHost: true, pluginRoot: undefined, pluginsDir: PLUGINS_DIR, rootKind: "none" },
      version: "9.9.9",
    });
    expect(report.statuses["pluginLoad"]).toBe("unconfirmed");
    expect(report.statuses["pluginRootKind"]).toBe("none");
  });
});

/**
 * The Codex prerequisites. Narrow on purpose: `lockedThreadOptions` returns `Required<ThreadOptions>`, so the
 * machine's config cannot silently change the sandbox, network or model. What it can still do is declare MCP
 * servers, which Codex spawns regardless — and a missing login is invisible until the first pass fails.
 */
describe("doctorReport codex lines", () => {
  it("names the fix when there is no Codex login", () => {
    const lines = doctorReport({ codex: CODEX_PATHS, envHome: home, home, plugin: noPlugin, version: "9.9.9" });

    expect(lines).toContain("codex auth: missing — run `codex login`, or the codex verbs will fail at the first pass");
  });

  it("says every option is supplied by slopweaver when there is no machine config", () => {
    const lines = doctorReport({ codex: CODEX_PATHS, envHome: home, home, plugin: noPlugin, version: "9.9.9" });

    expect(lines).toContain("codex config: none — every thread option is supplied explicitly by slopweaver");
  });

  it("warns that a declared MCP server is SPAWNED, even though dispatch is blocked", () => {
    const configPath = join(home, "config.toml");
    writeFileSync(configPath, '[mcp_servers.thing]\ncommand = "x"\n');
    const lines = doctorReport({
      codex: { authPath: CODEX_PATHS.authPath, configPath },
      envHome: home,
      home,
      plugin: noPlugin,
      version: "9.9.9",
    });

    expect(lines.join("\n")).toContain("appears to declare MCP servers");
    expect(lines.join("\n")).toContain("SPAWNS those at startup");
  });

  /**
   * The scan is a substring check, not a TOML parse. Saying "no MCP servers" would be a clean bill of health
   * this cannot actually issue — so it reports what it looked for and admits what it would miss.
   */
  it("admits the scan is shallow rather than certifying a clean config", () => {
    const configPath = join(home, "plain.toml");
    writeFileSync(configPath, 'model = "gpt-5.6-sol"\n');
    const lines = doctorReport({
      codex: { authPath: CODEX_PATHS.authPath, configPath },
      envHome: home,
      home,
      plugin: noPlugin,
      version: "9.9.9",
    });

    expect(lines.join("\n")).toContain("shallow scan");
    expect(lines.join("\n")).not.toContain("no MCP servers are configured");
  });
});

describe("doctorReport / doctorJsonReport self-review reservations", () => {
  it("stays silent with nothing held, and surfaces a reservation once it is stale", () => {
    const clean = doctorReport({ codex: CODEX_PATHS, envHome: home, home, plugin: noPlugin, version: "9.9.9" });
    expect(clean.some((line) => line.includes("self-review"))).toBe(false);

    reserveSelfReviewRound({
      home,
      intent: { formHash: "f", headSha: "abc123", locus: "o/r#7", reservedIso: "2026-01-01T00:00:00.000Z" },
    });
    const nowMs = Date.parse("2026-01-01T00:20:00.000Z");
    const stale = doctorReport({
      codex: CODEX_PATHS,
      envHome: home,
      home,
      nowMs,
      plugin: noPlugin,
      version: "9.9.9",
    });
    expect(stale).toContain("self-review: 1 reservation(s) held past 15min — likely stranded");
    expect(stale.some((line) => line.includes("o/r#7") && line.includes("abc123"))).toBe(true);
  });

  it("does not report a reservation still inside the stale threshold", () => {
    reserveSelfReviewRound({
      home,
      intent: { formHash: "f", headSha: "abc123", locus: "o/r#7", reservedIso: "2026-01-01T00:00:00.000Z" },
    });
    const nowMs = Date.parse("2026-01-01T00:05:00.000Z");
    const fresh = doctorReport({
      codex: CODEX_PATHS,
      envHome: home,
      home,
      nowMs,
      plugin: noPlugin,
      version: "9.9.9",
    });
    expect(fresh.some((line) => line.includes("self-review"))).toBe(false);
  });

  it("lists a stale reservation in the structured report", () => {
    reserveSelfReviewRound({
      home,
      intent: { formHash: "f", headSha: "abc123", locus: "o/r#7", reservedIso: "2026-01-01T00:00:00.000Z" },
    });
    const nowMs = Date.parse("2026-01-01T00:20:00.000Z");
    const report = doctorJsonReport({
      codex: CODEX_PATHS,
      envHome: home,
      home,
      nowMs,
      plugin: noPlugin,
      version: "9.9.9",
    });
    expect(report.selfReviewStrandedReservations).toEqual([
      { ageMs: 20 * 60_000, headSha: "abc123", locus: "o/r#7", reservedIso: "2026-01-01T00:00:00.000Z" },
    ]);
  });
});

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyPluginLoad,
  measurePluginLoad,
  observePluginRoot,
  pluginLoadLine,
  pluginSurfaceLine,
  probeRoot,
} from "../../../../../cli/commands/doctor/pluginReport.js";
import { hookMirrorRoot, pluginRootWith } from "../../../../pluginRootFixture.js";

const PLUGINS_DIR = "/synthetic/.claude/plugins";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-plugin-report-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("pluginSurfaceLine", () => {
  it("still names a real plugin root's missing continuity skill", () => {
    const root = pluginRootWith({ root: join(home, "plugin"), skills: ["handover", "pickup"] });

    expect(pluginSurfaceLine({ pluginRoot: root, rootKind: "plugin" })).toBe(
      "plugin surface: Codex continuity skills MISSING (orchestrate) · hooks bundle missing · hook trust host-only",
    );
  });

  it("reports the hook mirror's skills NOT APPLICABLE, never MISSING", () => {
    const root = hookMirrorRoot({ data: join(home, "plugin-data") });

    expect(pluginSurfaceLine({ pluginRoot: root, rootKind: "hook-mirror" })).toBe(
      "plugin surface: Codex continuity skills NOT APPLICABLE (the hook mirror carries no skills; a host loads them from its own plugin root) · hooks bundle present · hook trust host-only",
    );
  });

  it("asks the directory a symlink-then-`..` root really names for its skills, never its lexical sibling", () => {
    const physical = pluginRootWith({ root: join(home, "physical"), skills: [] });
    mkdirSync(join(physical, "child"));
    pluginRootWith({ root: join(home, "alias"), skills: ["handover", "orchestrate", "pickup"] });
    symlinkSync(join(physical, "child"), join(home, "alias", "jump"));
    const root = `${join(home, "alias", "jump")}/..`;

    expect(observePluginRoot({ host: "claude-code", pluginRoot: root })).toBe("plugin");
    expect(pluginSurfaceLine({ pluginRoot: root, rootKind: "plugin" })).toBe(
      "plugin surface: Codex continuity skills MISSING (handover, orchestrate, pickup) · hooks bundle missing · hook trust host-only",
    );
  });

  it("keeps asking a manifestless root for its skills, so a damaged install keeps its warning", () => {
    const root = join(home, "half-copied");
    mkdirSync(join(root, "bin"), { recursive: true });

    expect(pluginSurfaceLine({ pluginRoot: root, rootKind: "manifestless" })).toBe(
      "plugin surface: Codex continuity skills MISSING (handover, orchestrate, pickup) · hooks bundle missing · hook trust host-only",
    );
  });
});

describe("observePluginRoot", () => {
  it("proves no root when none, or only whitespace, was handed over", () => {
    expect(observePluginRoot({ host: "claude-code", pluginRoot: undefined })).toBe("none");
    expect(observePluginRoot({ host: "claude-code", pluginRoot: " " })).toBe("none");
  });

  it("takes the active host's own manifest as a plugin root", () => {
    const root = pluginRootWith({ root: join(home, "plugin"), skills: [] });

    expect(observePluginRoot({ host: "claude-code", pluginRoot: root })).toBe("plugin");
  });

  it("never takes the OTHER host's manifest as proof for the active one", () => {
    const root = join(home, "codex-only");
    mkdirSync(join(root, ".codex-plugin"), { recursive: true });
    writeFileSync(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "slopweaver" }));

    expect(observePluginRoot({ host: "codex", pluginRoot: root })).toBe("plugin");
    expect(observePluginRoot({ host: "claude-code", pluginRoot: root })).toBe("manifestless");
    expect(observePluginRoot({ host: undefined, pluginRoot: root })).toBe("plugin");
  });

  it("identifies the hook mirror by its slot layout, through the `current` link", () => {
    const root = hookMirrorRoot({ data: join(home, "plugin-data") });

    expect(observePluginRoot({ host: "claude-code", pluginRoot: root })).toBe("hook-mirror");
  });

  it("never calls a root carrying skills/ the mirror, even at a slot-shaped path", () => {
    const root = join(home, "mirror", "by-root", "dev", ".slot-a");
    mkdirSync(join(root, "skills", "handover"), { recursive: true });

    expect(observePluginRoot({ host: "ambiguous", pluginRoot: root })).toBe("manifestless");
  });

  it("never calls a slot-shaped root carrying a manifest the mirror, even when no host's manifest is proof", () => {
    const root = pluginRootWith({ root: join(home, "mirror", "by-root", "key", ".slot-a"), skills: [] });
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "bin", "slopweaver"), "#!/usr/bin/env bash\n");

    expect(observePluginRoot({ host: "ambiguous", pluginRoot: root })).toBe("manifestless");
  });

  it("never calls a slot-shaped path the mirror without the mirror's launcher beneath it", () => {
    const slot = join(home, "mirror", "by-root", "key", ".slot-a");
    mkdirSync(join(home, "mirror", "by-root", "key"), { recursive: true });
    writeFileSync(slot, "not a directory");

    expect(observePluginRoot({ host: "codex", pluginRoot: slot })).toBe("manifestless");
  });

  it("reads a seeded `current`, linked to the plugin root itself, as that plugin", () => {
    const real = pluginRootWith({ root: join(home, "checkout"), skills: ["handover"] });
    mkdirSync(join(real, "bin"));
    const mirrorRoot = join(home, "data", "mirror", "by-root", "checkout");
    mkdirSync(mirrorRoot, { recursive: true });
    symlinkSync(real, join(mirrorRoot, "current"));

    expect(observePluginRoot({ host: "claude-code", pluginRoot: join(mirrorRoot, "current", "bin", "..") })).toBe(
      "plugin",
    );
  });

  it("follows a symlink before its `..`, so a root spelled through one finds the manifest the kernel opens", () => {
    const slot = pluginRootWith({ root: join(home, "mirror", "by-root", "key", ".slot-a"), skills: [] });
    mkdirSync(join(slot, "child"));
    mkdirSync(join(home, "alias"));
    symlinkSync(join(slot, "child"), join(home, "alias", "jump"));

    expect(observePluginRoot({ host: "claude-code", pluginRoot: `${join(home, "alias", "jump")}/..` })).toBe("plugin");
  });

  it("never calls a root the mirror when only its LEXICAL spelling passes through a slot", () => {
    const slot = hookMirrorRoot({ data: join(home, "plugin-data") });
    const physical = join(home, "physical");
    mkdirSync(join(physical, "child"), { recursive: true });
    mkdirSync(join(physical, "skills"));
    symlinkSync(join(physical, "child"), join(slot, "jump"));

    expect(observePluginRoot({ host: "claude-code", pluginRoot: `${join(slot, "jump")}/..` })).toBe("manifestless");
  });

  it("never diagnoses a manifestless root that is not a mirror slot as the mirror", () => {
    const root = join(home, "plugins", "cache", "local");
    mkdirSync(join(root, "bin"), { recursive: true });

    expect(observePluginRoot({ host: "codex", pluginRoot: root })).toBe("manifestless");
  });

  it("never takes either manifest as proof when both hosts were detected at once", () => {
    const root = pluginRootWith({ root: join(home, "plugin"), skills: [] });
    mkdirSync(join(root, ".codex-plugin"), { recursive: true });
    writeFileSync(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "slopweaver" }));

    expect(observePluginRoot({ host: "ambiguous", pluginRoot: root })).toBe("manifestless");
  });

  it("calls a root that does not exist manifestless rather than throwing", () => {
    expect(observePluginRoot({ host: "codex", pluginRoot: join(home, "gone") })).toBe("manifestless");
  });
});

describe("measurePluginLoad", () => {
  it("reads the hook mirror's launcher as the mirror, under the active host's own plugins dir", () => {
    const root = hookMirrorRoot({ data: join(home, "plugin-data") });
    const detection = { kind: "active", session: { host: "codex", id: "019a-fixture" } } as const;

    expect(measurePluginLoad({ detection, env: { PLUGIN_ROOT: root }, userHome: "/u" })).toEqual({
      insideAgentHost: true,
      pluginRoot: root,
      pluginsDir: "/u/.codex/plugins",
      rootKind: "hook-mirror",
    });
  });

  it("takes CLAUDECODE alone as a host, and proves no root without one", () => {
    expect(measurePluginLoad({ detection: { kind: "missing" }, env: { CLAUDECODE: "1" }, userHome: "/u" })).toEqual({
      insideAgentHost: true,
      pluginRoot: undefined,
      pluginsDir: "/u/.claude/plugins",
      rootKind: "none",
    });
  });

  it("is outside any agent host with neither a detected session nor CLAUDECODE", () => {
    expect(
      measurePluginLoad({ detection: { kind: "missing" }, env: { CLAUDECODE: "" }, userHome: "/u" }).insideAgentHost,
    ).toBe(false);
  });
});

describe("classifyPluginLoad", () => {
  it("never calls the hook mirror under the plugins dir's data tree a marketplace install", () => {
    expect(
      classifyPluginLoad({
        insideAgentHost: true,
        pluginRoot: `${PLUGINS_DIR}/data/slopweaver-inline/mirror/current/bin/..`,
        pluginsDir: PLUGINS_DIR,
        rootKind: "hook-mirror",
      }),
    ).toBe("hook-mirror");
  });

  it("never calls a manifestless root under the plugins dir a marketplace install either", () => {
    expect(
      classifyPluginLoad({
        insideAgentHost: true,
        pluginRoot: `${PLUGINS_DIR}/cache/local`,
        pluginsDir: PLUGINS_DIR,
        rootKind: "manifestless",
      }),
    ).toBe("manifestless-root");
  });
});

describe("pluginLoadLine", () => {
  it("names the hook mirror rather than claiming any host loaded the plugin from it", () => {
    expect(pluginLoadLine({ pluginRoot: "/data/mirror/current/bin/..", route: "hook-mirror" })).toBe(
      "plugin: load route UNCONFIRMED — /data/mirror/current/bin/.. is the hook mirror, a copy of the hook surface only, so no host loaded Slopweaver from it. Check the host's plugin list to confirm Slopweaver is loaded.",
    );
  });

  it("states a manifestless root's absence without diagnosing why", () => {
    expect(pluginLoadLine({ pluginRoot: "/cache/local", route: "manifestless-root" })).toBe(
      "plugin: load route UNCONFIRMED — /cache/local carries no plugin manifest for this host, so it proves no plugin load (an install mid-update or a damaged one reads this way). Check the host's plugin list to confirm Slopweaver is loaded.",
    );
  });
});

describe("probeRoot", () => {
  type Resolver = Parameters<typeof probeRoot>[0]["realpath"];
  const failingWith =
    ({ code }: { code: string }): Resolver =>
    (path) => {
      throw Object.assign(new Error(`${code}: ${path}`), { code });
    };

  const lexical: Resolver = (path) => `/cwd/${path}`;

  it("probes the physical directory when a symlink makes it differ from the lexical one", () => {
    expect(probeRoot({ lexical: () => "/cwd", pluginRoot: "link/..", realpath: () => "/physical/parent" })).toBe(
      "/physical/parent",
    );
  });

  it("probes the root as given when both spellings agree, so a long absolute suffix never overflows PATH_MAX", () => {
    expect(probeRoot({ lexical, pluginRoot: "p", realpath: () => "/cwd/p" })).toBe("p");
  });

  it("probes a root past PATH_MAX as given, so a relative root under a long working directory keeps its diagnosis", () => {
    expect(probeRoot({ lexical, pluginRoot: "plugin-long", realpath: failingWith({ code: "ENAMETOOLONG" }) })).toBe(
      "plugin-long",
    );
  });

  it("probes the root as given when the resolver cannot answer, rather than calling a present root absent", () => {
    expect(probeRoot({ lexical, pluginRoot: "/p", realpath: failingWith({ code: "EIO" }) })).toBe("/p");
  });

  it("finds nothing beneath a root that does not resolve", () => {
    expect(probeRoot({ lexical, pluginRoot: "gone", realpath: failingWith({ code: "ENOENT" }) })).toBe(undefined);
    expect(probeRoot({ lexical, pluginRoot: "file/x", realpath: failingWith({ code: "ENOTDIR" }) })).toBe(undefined);
    expect(probeRoot({ lexical, pluginRoot: "loop", realpath: failingWith({ code: "ELOOP" }) })).toBe(undefined);
  });
});

describe("observePluginRoot's launcher", () => {
  it("never takes a slot whose bin/slopweaver is a directory for the hook mirror", () => {
    const slot = join(home, "mirror", "by-root", "key", ".slot-a");
    mkdirSync(join(slot, "bin", "slopweaver"), { recursive: true });

    expect(observePluginRoot({ host: "claude-code", pluginRoot: slot })).toBe("manifestless");
  });
});

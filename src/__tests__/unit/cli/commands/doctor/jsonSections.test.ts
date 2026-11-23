/*
 * The `doctor --json` sections over a throwaway home: the paths record, the statuses record (an empty home and
 * a populated one), and the environment block's tallies.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  doctorJsonPaths,
  doctorJsonStatuses,
  environmentJson,
} from "../../../../../cli/commands/doctor/jsonSections.js";
import { type PluginLoadEvidence, pluginSurface } from "../../../../../cli/commands/doctor/pluginReport.js";
import type { EnvironmentProbe } from "../../../../../environment/facts.js";
import { stateHomePaths } from "../../../../../stateHome.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "doctor-json-sections-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

const noPlugin = (): PluginLoadEvidence => ({
  insideAgentHost: false,
  pluginRoot: undefined,
  pluginsDir: join(dir, "plugins"),
  rootKind: "none",
});

const probe = ({ id, verdict }: Pick<EnvironmentProbe, "id" | "verdict">): EnvironmentProbe => ({
  fix: null,
  id,
  says: `${id} says`,
  scope: "slopweaver",
  verdict,
  withoutFix: null,
});

describe("doctorJsonPaths", () => {
  it("projects the ten public paths of the home and nothing else", () => {
    const paths = stateHomePaths({ home: dir });
    expect(doctorJsonPaths({ paths })).toEqual({
      bronze: paths.corpus.bronze,
      gold: paths.corpus.gold,
      history: paths.corpus.history,
      identity: paths.identityJson,
      members: paths.corpus.members,
      profile: paths.profileJson,
      root: dir,
      secrets: paths.secrets,
      silver: paths.corpus.silver,
      structures: paths.corpus.structures,
    });
  });
});

describe("doctorJsonStatuses", () => {
  it("reports an empty home as missing everywhere, with no cwd to judge", () => {
    expect(
      doctorJsonStatuses({
        codex: { authPath: join(dir, "auth.json"), configPath: join(dir, "config.toml") },
        cwd: undefined,
        execStore: join(dir, "exec"),
        identityRoster: undefined,
        paths: stateHomePaths({ home: dir }),
        plugin: noPlugin(),
        surface: pluginSurface({ pluginRoot: undefined }),
      }),
    ).toEqual({
      bronze: "missing",
      codexAuth: "missing",
      codexConfig: "none",
      denylist: "missing",
      execInodes: "unknown",
      gold: "missing",
      history: "missing",
      identity: "retired-file-absent",
      mainCheckout: "unknown",
      members: "missing",
      pluginHookTrust: "host-only-unverified",
      pluginHooks: "unconfirmed",
      pluginLoad: "outside-agent-host",
      pluginRootKind: "none",
      profile: "missing",
      secrets: "missing",
      silver: "missing",
      structures: "missing",
    });
  });

  it("reports presence and parse words for what the home does hold", () => {
    const paths = stateHomePaths({ home: dir });
    const codex = { authPath: join(dir, "auth.json"), configPath: join(dir, "config.toml") };
    writeFileSync(codex.authPath, "{}");
    writeFileSync(codex.configPath, "");
    mkdirSync(paths.corpus.bronze, { recursive: true });
    mkdirSync(paths.corpus.silver, { recursive: true });
    writeFileSync(join(paths.corpus.silver, "row.jsonl"), "");
    mkdirSync(dirname(paths.hygieneDenylist), { recursive: true });
    writeFileSync(paths.hygieneDenylist, "");
    mkdirSync(dirname(paths.profileJson), { recursive: true });
    writeFileSync(paths.profileJson, "[]");
    mkdirSync(dirname(paths.identityJson), { recursive: true });
    writeFileSync(paths.identityJson, "[]");
    const statuses = doctorJsonStatuses({
      codex,
      cwd: undefined,
      execStore: join(dir, "exec"),
      identityRoster: undefined,
      paths,
      plugin: noPlugin(),
      surface: pluginSurface({ pluginRoot: undefined }),
    });
    expect(statuses["codexAuth"]).toBe("present");
    expect(statuses["codexConfig"]).toBe("present");
    expect(statuses["denylist"]).toBe("present");
    expect(statuses["bronze"]).toBe("exists (empty)");
    expect(statuses["silver"]).toBe("exists");
    expect(statuses["profile"]).toBe("present-invalid");
    expect(statuses["identity"]).toBe("retired-file-present");
  });
});

describe("environmentJson", () => {
  it("carries every probe through beside its three tallies", () => {
    const probes = [
      probe({ id: "node", verdict: "fatal" }),
      probe({ id: "docker", verdict: "warning" }),
      probe({ id: "zsh", verdict: "warning" }),
      probe({ id: "datadog", verdict: "unchecked" }),
      probe({ id: "git", verdict: "ok" }),
    ];
    expect(environmentJson({ deep: true, probes })).toEqual({
      deep: true,
      fatal: 1,
      probes,
      unchecked: 1,
      warnings: 2,
    });
  });

  it("tallies zero for no probes", () => {
    const probes: readonly EnvironmentProbe[] = [];
    expect(environmentJson({ deep: false, probes })).toEqual({
      deep: false,
      fatal: 0,
      probes: [],
      unchecked: 0,
      warnings: 0,
    });
  });
});

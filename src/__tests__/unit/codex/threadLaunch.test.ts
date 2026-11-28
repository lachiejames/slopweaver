/**
 * The per-thread launch every pass's SDK and every sandboxed probe share (`codex/client.ts`'s
 * `codexThreadLaunch`): the temp folder closed, the shell temp moved into the thread's scratch, and — the
 * condition the per-thread build must keep — the same credentials, home and binary as before.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { codexCapabilityOverrides } from "../../../codex/capabilities.js";
import {
  codexClientEnvironment,
  codexPassEnvironment,
  codexThreadLaunch,
  postureSandboxMode,
  productionCodexClient,
} from "../../../codex/client.js";
import { ok } from "../../../lib/result.js";

/** An inherited environment carrying every credential the CLI would read ahead of the routed home's login. */
const INHERITED: NodeJS.ProcessEnv = {
  CODEX_ACCESS_TOKEN: "FIXTURE-ACCESS",
  CODEX_API_KEY: "FIXTURE-CODEX",
  HOME: "/home/acme",
  OPENAI_API_KEY: "FIXTURE-OPENAI",
  PATH: "/usr/bin",
  TMPDIR: "/var/folders/acme/T/",
};

const CLI = { path: "/vendor/bin/codex", pathDirs: ["/vendor/codex-path"] };

describe("codexThreadLaunch for a pass", () => {
  const launch = codexThreadLaunch({
    cli: CLI,
    codexHome: "/homes/acme-1",
    env: INHERITED,
    posture: "pass",
    workingDirectory: "/orchestration/p1.scratch",
  });

  it("carries every capability override, then the scratch's shell temp", () => {
    expect(launch.configOverrides).toEqual([
      ...codexCapabilityOverrides({ runtime: "pass" }),
      'shell_environment_policy.set.TMPDIR="/orchestration/p1.scratch/.tmp"',
      'shell_environment_policy.set.TMPPREFIX="/orchestration/p1.scratch/.tmp/zsh"',
    ]);
  });

  it("drops every inherited credential, routes the home, and changes nothing else but the two temp names", () => {
    expect(launch.env).toEqual({
      CODEX_HOME: "/homes/acme-1",
      HOME: "/home/acme",
      PATH: "/vendor/codex-path:/usr/bin",
      TMPDIR: "/orchestration/p1.scratch/.tmp",
      TMPPREFIX: "/orchestration/p1.scratch/.tmp/zsh",
    });
  });

  it("is the client environment with exactly TMPDIR and TMPPREFIX replaced, so no account choice moves", () => {
    const client = codexClientEnvironment({ codexHome: "/homes/acme-1", env: INHERITED });
    const pass = codexPassEnvironment({
      codexHome: "/homes/acme-1",
      env: INHERITED,
      workingDirectory: "/orchestration/p1.scratch",
    });
    const changed = Object.keys(pass).filter((key) => pass[key] !== client[key]);
    expect(changed).toEqual(["TMPDIR", "TMPPREFIX"]);
    expect(Object.keys(client).filter((key) => !(key in pass))).toEqual([]);
  });
});

describe("codexThreadLaunch for a sealed thread", () => {
  it("moves no temp, since its read-only sandbox has none to write and its directory must stay untouched", () => {
    const launch = codexThreadLaunch({
      cli: undefined,
      codexHome: undefined,
      env: INHERITED,
      posture: "sealed",
      workingDirectory: "/tmp/sw-draft-x",
    });
    expect(launch.configOverrides).toEqual(codexCapabilityOverrides({ runtime: "pass" }));
    expect(launch.env).toEqual({ HOME: "/home/acme", PATH: "/usr/bin", TMPDIR: "/var/folders/acme/T/" });
  });
});

describe("productionCodexClient's per-thread build", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /**
   * A scratch made the way `eval/turnProvider.ts` makes one, with no `.tmp` of its own.
   *
   * @returns the bare scratch directory
   */
  function bareScratch(): string {
    const dir = mkdtempSync(join(tmpdir(), "sw-launch-"));
    dirs.push(dir);
    return dir;
  }

  it("mints the pass's owner-only shell temp in a scratch its caller made bare, before any model call", () => {
    const scratch = bareScratch();
    const client = productionCodexClient({ admitThread: () => ok(undefined), codexHome: scratch });

    client.startThread({ workingDirectory: scratch });

    expect(statSync(join(scratch, ".tmp")).mode & 0o777).toBe(0o700);
  });

  it("creates nothing in a sealed thread's directory, whose untouched check would otherwise fail", () => {
    const scratch = bareScratch();
    const client = productionCodexClient({ admitThread: () => ok(undefined), codexHome: scratch, posture: "sealed" });

    client.startThread({ workingDirectory: scratch });

    expect(readdirSync(scratch)).toEqual([]);
  });
});

describe("postureSandboxMode", () => {
  it("names each posture's own sandbox for a `codex sandbox` launch", () => {
    expect(postureSandboxMode({ posture: "pass" })).toBe("workspace-write");
    expect(postureSandboxMode({ posture: "sealed" })).toBe("read-only");
  });
});

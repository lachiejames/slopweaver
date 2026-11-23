/**
 * `bin/slopweaver` resolves its own Node — SLOPWEAVER_NODE, then `.nvmrc`'s exact version under a version manager,
 * then `node` on PATH — and when none meets `engines.node` it refuses in its own words and exits 1, rather than
 * dying on `env`'s, an old Node's or a manager shim's error. `hooks/lib/node-resolve.sh` carries the mechanism.
 *
 * Every case runs the REAL launcher with `/bin/bash`, against a fake CLI tree whose tsx prints which `node` it
 * would get, under a PATH built from only the tools the launcher calls — so "no node on PATH" is literal here,
 * on any host, rather than an assumption about what the machine running the test has installed.
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const LAUNCHER = join(repoRoot, "bin", "slopweaver");

/** The external tools the launcher runs on its way to exec'ing tsx; each is linked in only where the host has it. */
const LAUNCHER_TOOLS = ["dirname", "uname", "sysctl", "awk", "git"] as const;

/** Every variable that could point resolution at the host's own Node, removed from each run. */
const HOST_NODE_VARIABLES = [
  "SLOPWEAVER_NODE",
  "PROTO_HOME",
  "NVM_DIR",
  "FNM_DIR",
  "VOLTA_HOME",
  "MISE_DATA_DIR",
  "ASDF_DATA_DIR",
  "NODE_OPTIONS",
  "CMUX_ORIGINAL_NODE_OPTIONS",
  "CMUX_ORIGINAL_NODE_OPTIONS_PRESENT",
  "PLUGIN_ROOT",
  "CLAUDE_PLUGIN_ROOT",
  "SLOPWEAVER_LAUNCHER_NO_TSX_WRAPPER",
] as const;

let scratch: string;
let cli: string;
let home: string;
let toolBin: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "slop-finds-node-")));
  cli = join(scratch, "cli");
  home = join(scratch, "home");
  toolBin = join(scratch, "tools");
  mkdirSync(join(cli, "node_modules", ".bin"), { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(toolBin, { recursive: true });
  writeFileSync(join(cli, "package.json"), '{\n  "name": "fake",\n  "engines": {\n    "node": ">=24.11"\n  }\n}\n');
  writeFileSync(join(cli, ".nvmrc"), "24.21.0\n");
  writeExecutable({
    body: "#!/bin/sh\nprintf 'tsx ran with node=%s\\n' \"$(command -v node)\"\n",
    path: join(cli, "node_modules", ".bin", "tsx"),
  });
  for (const tool of LAUNCHER_TOOLS) {
    const found = process.env["PATH"]!.split(delimiter)
      .map((dir) => join(dir, tool))
      .find((path) => existsSync(path));
    if (found !== undefined) {
      symlinkSync(found, join(toolBin, tool));
    }
  }
});
afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

/** Write an executable file, creating its directory. */
function writeExecutable({ path, body }: { path: string; body: string }): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

/**
 * A fake `node` whose `--version` prints the given line and exits with the given status.
 *
 * @param path where to write it
 * @param line what `--version` prints
 * @param status its exit status
 * @returns the path written
 */
function fakeNode({ path, line, status = 0 }: { path: string; line: string; status?: number }): string {
  writeExecutable({ body: `#!/bin/sh\necho '${line}'\nexit ${String(status)}\n`, path });
  return path;
}

/**
 * Run the real launcher with only the scratch tool dir on PATH.
 *
 * @param extra environment on top of the scrubbed base
 * @returns exit status, stdout and stderr
 */
function launch({ extra = {} }: { extra?: Readonly<Record<string, string>> } = {}): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    PATH: toolBin,
    PLUGIN_DATA: join(scratch, "plugin-data"),
    SLOPWEAVER_CLI_DIR: cli,
    SLOPWEAVER_LAUNCHER_QUIET: "1",
    XDG_CONFIG_HOME: join(scratch, "config"),
    XDG_DATA_HOME: join(scratch, "data"),
  };
  for (const name of HOST_NODE_VARIABLES) {
    delete env[name];
  }
  const run = spawnSync("/bin/bash", [LAUNCHER, "catalog"], {
    cwd: scratch,
    encoding: "utf8",
    env: { ...env, ...extra },
  });
  return { status: run.status, stderr: run.stderr, stdout: run.stdout };
}

/** The two closing lines every refusal carries, after the per-tier lines. */
function closing({ install }: { install: string }): readonly string[] {
  return [
    `slopweaver:   install it:  ${install}`,
    `slopweaver:   or point SLOPWEAVER_NODE at a node >=24.11 in ${join(scratch, "config")}/slopweaver/env`,
  ];
}

const HEADLINE = (): string =>
  `slopweaver: REFUSED [no-node] — no Node.js >=24.11 to run this CLI (engines.node in ${cli}/package.json).`;
const NO_MANAGER_INSTALL =
  "install proto (https://moonrepo.dev/proto), then: proto install node 24.21.0 — or Node 24.21.0 from https://nodejs.org/";

describe("bin/slopweaver with no Node that fits", () => {
  it("refuses on a node-less PATH, naming the floor, each tier and the install command, and exits 1", () => {
    const run = launch();
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr.trimEnd().split("\n")).toEqual([
      HEADLINE(),
      "slopweaver:   SLOPWEAVER_NODE: unset",
      "slopweaver:   .nvmrc 24.21.0: not installed under proto, nvm, fnm, volta, mise or asdf",
      "slopweaver:   node on PATH: none",
      ...closing({ install: NO_MANAGER_INSTALL }),
    ]);
  });

  it("refuses a Node on PATH below the floor, naming the version it found", () => {
    const old = fakeNode({ line: "v18.19.0", path: join(toolBin, "node") });
    const run = launch();
    expect(run.status).toBe(1);
    expect(run.stderr.split("\n")[3]).toBe(`slopweaver:   node on PATH: ${old} is \`v18.19.0\`, not >=24.11`);
  });

  it("refuses a `node` on PATH that answers with something that is not a version", () => {
    const odd = fakeNode({ line: "Usage: node-shim [options]", path: join(toolBin, "node") });
    const run = launch();
    expect(run.status).toBe(1);
    expect(run.stderr.split("\n")[3]).toBe(
      `slopweaver:   node on PATH: ${odd} answered \`--version\` with \`Usage: node-shim [options]\`, which is not a Node version`,
    );
  });

  it("names a manager shim's own failure instead of dying on it, and installs with the manager already present", () => {
    const shim = fakeNode({ line: "proto: no version of node configured", path: join(toolBin, "node"), status: 1 });
    mkdirSync(join(home, ".proto"), { recursive: true });
    const run = launch();
    expect(run.status).toBe(1);
    expect(run.stderr.trimEnd().split("\n").slice(3)).toEqual([
      `slopweaver:   node on PATH: ${shim} failed \`--version\`: proto: no version of node configured`,
      ...closing({ install: "proto install node 24.21.0" }),
    ]);
  });

  it("refuses an explicit SLOPWEAVER_NODE below the floor rather than passing over it for a Node that fits", () => {
    const pin = fakeNode({ line: "v20.0.0", path: join(scratch, "pin", "node") });
    fakeNode({ line: "v24.21.0", path: join(home, ".proto", "tools", "node", "24.21.0", "bin", "node") });
    const run = launch({ extra: { SLOPWEAVER_NODE: pin } });
    expect(run.status).toBe(1);
    expect(run.stderr.split("\n")[1]).toBe(
      `slopweaver:   SLOPWEAVER_NODE=${pin} is \`v20.0.0\`, not >=24.11, and an explicit pin is never passed over for another Node`,
    );
    expect(run.stdout).toBe("");
  });
});

describe("bin/slopweaver with a PRESENT candidate that does not fit", () => {
  it("passes over a broken .nvmrc install for a Node on PATH that fits, and says so rather than silently", () => {
    const ambient = fakeNode({ line: "v24.30.0", path: join(toolBin, "node") });
    const broken = fakeNode({
      line: "dyld: Library not loaded",
      path: join(home, ".proto", "tools", "node", "24.21.0", "bin", "node"),
      status: 134,
    });
    // Quiet unset: the warning is an advisory, and the console's quiet marker would discard it.
    const run = launch({ extra: { SLOPWEAVER_LAUNCHER_QUIET: "" } });
    expect(run.stderr).toBe(
      `slopweaver: WARNING — .nvmrc 24.21.0: ${broken} failed \`--version\`: dyld: Library not loaded — that install is broken; reinstall it. Running the node on PATH instead.\n`,
    );
    expect(run.stdout).toBe(`tsx ran with node=${ambient}\n`);
    expect(run.status).toBe(0);
  });

  it("refuses when the .nvmrc install is broken and nothing on PATH fits, naming both", () => {
    const broken = fakeNode({
      line: "dyld: Library not loaded",
      path: join(home, ".proto", "tools", "node", "24.21.0", "bin", "node"),
      status: 134,
    });
    const run = launch();
    expect(run.status).toBe(1);
    expect(run.stderr.trimEnd().split("\n")).toEqual([
      HEADLINE(),
      "slopweaver:   SLOPWEAVER_NODE: unset",
      `slopweaver:   .nvmrc 24.21.0: ${broken} failed \`--version\`: dyld: Library not loaded — that install is broken; reinstall it`,
      "slopweaver:   node on PATH: none",
      ...closing({ install: "proto install node 24.21.0" }),
    ]);
  });

  it("refuses a SLOPWEAVER_NODE that is not an absolute path to a binary named node", () => {
    const run = launch({ extra: { SLOPWEAVER_NODE: "node24" } });
    expect(run.status).toBe(1);
    expect(run.stderr.split("\n")[1]).toBe(
      "slopweaver:   SLOPWEAVER_NODE=node24 is not an absolute path to a binary named `node` — only that name answers tsx's `env node`",
    );
  });

  it("refuses a fitting SLOPWEAVER_NODE whose path holds a colon, rather than letting an older PATH node run", () => {
    const pin = fakeNode({ line: "v24.21.0", path: join(scratch, "sw:pin", "node") });
    fakeNode({ line: "v18.19.0", path: join(toolBin, "node") });
    const run = launch({ extra: { SLOPWEAVER_NODE: pin } });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr.split("\n")[1]).toBe(
      `slopweaver:   SLOPWEAVER_NODE=${pin} contains \`:\`, the PATH separator, so its directory cannot go first on PATH`,
    );
  });
});

describe("bin/slopweaver over a checkout that contradicts itself", () => {
  it("refuses as node-contract when package.json declares no engines.node floor", () => {
    writeFileSync(join(cli, "package.json"), '{\n  "name": "fake"\n}\n');
    fakeNode({ line: "v24.30.0", path: join(toolBin, "node") });
    const run = launch();
    expect(run.status).toBe(1);
    expect(run.stderr.split("\n")[0]).toBe(
      `slopweaver: REFUSED [node-contract] — ${cli}/package.json declares no \`engines.node\` \`>=MAJOR[.MINOR[.PATCH]]\` floor,`,
    );
  });

  it("refuses as node-contract when .nvmrc pins a version below engines.node", () => {
    writeFileSync(join(cli, ".nvmrc"), "v22.1.0\n");
    fakeNode({ line: "v24.30.0", path: join(toolBin, "node") });
    const run = launch();
    expect(run.status).toBe(1);
    expect(run.stderr.split("\n")[0]).toBe(
      `slopweaver: REFUSED [node-contract] — ${cli}/.nvmrc pins 22.1.0, below the >=24.11 its package.json requires.`,
    );
  });
});

describe("bin/slopweaver resolving a Node that fits", () => {
  it("takes .nvmrc's exact version from proto ahead of PATH and puts it first on PATH", () => {
    fakeNode({ line: "v24.30.0", path: join(toolBin, "node") });
    const pinned = fakeNode({
      line: "v24.21.0",
      path: join(home, ".proto", "tools", "node", "24.21.0", "bin", "node"),
    });
    const run = launch();
    expect(run.stderr).toBe("");
    expect(run.stdout).toBe(`tsx ran with node=${pinned}\n`);
    expect(run.status).toBe(0);
  });

  it("finds .nvmrc's version under NVM_DIR", () => {
    const nvm = join(scratch, "nvm");
    const pinned = fakeNode({ line: "v24.21.0", path: join(nvm, "versions", "node", "v24.21.0", "bin", "node") });
    const run = launch({ extra: { NVM_DIR: nvm } });
    expect(run.stdout).toBe(`tsx ran with node=${pinned}\n`);
  });

  it("falls to a Node on PATH that meets the floor when .nvmrc's version is not installed", () => {
    const ambient = fakeNode({ line: "v24.11.0", path: join(toolBin, "node") });
    const run = launch();
    expect(run.stdout).toBe(`tsx ran with node=${ambient}\n`);
    expect(run.status).toBe(0);
  });

  it("takes an explicit SLOPWEAVER_NODE that fits ahead of .nvmrc's installed version", () => {
    const pin = fakeNode({ line: "v25.0.0", path: join(scratch, "pin", "node") });
    fakeNode({ line: "v24.21.0", path: join(home, ".proto", "tools", "node", "24.21.0", "bin", "node") });
    const run = launch({ extra: { SLOPWEAVER_NODE: pin } });
    expect(run.stdout).toBe(`tsx ran with node=${pin}\n`);
  });
});

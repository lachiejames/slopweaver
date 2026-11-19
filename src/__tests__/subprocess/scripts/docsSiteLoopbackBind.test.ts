/**
 * Every console server `scripts/docs-site.sh` starts listens on 127.0.0.1 and nowhere else, and a client that
 * dials `http://localhost:<port>` — the address the owner has bookmarked, and the one the desktop app uses — still
 * reaches it.
 *
 * The incident: `lsof -nP -iTCP:3000 -sTCP:LISTEN` read `TCP *:3000 (LISTEN)`. No start named a
 * host, and Next listens on every interface when none is named, so the console answered beyond this machine. The
 * script is copied into a throwaway git root beside
 * a fake `site/`, and a fake `yarn` on PATH stands in for Next: it records its argv and listens exactly as Next
 * does — on the `--hostname`/`-H` it was given, the LAST one winning, and on every interface when given none — so
 * a start that drops the host binds `::` here as it did on the owner's Mac. All three starts are driven for real: the
 * background dev server (`--start`), the production round (`--serve`, whose readiness probe must answer even
 * under a NODE_OPTIONS that stops Node falling back from `::1`), and the foreground serve, handed a caller's own
 * `-H 0.0.0.0`. The site's own `dev` and `start`
 * scripts are read too, since a hand-typed `yarn dev` in `site/` never passes through the script.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { gitInTemp } from "../../tempGitRepo.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPT = join(repoRoot, "scripts", "docs-site.sh");

/**
 * The fake `yarn`: `install` and `build` succeed at once; `dev` and `start` serve HTTP the way `next` binds, and
 * write one line naming the address the kernel actually bound.
 */
const FAKE_YARN = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const http = require("node:http");
const log = (entry) => appendFileSync(process.env.FAKE_YARN_LOG, JSON.stringify(entry) + "\\n");
const args = process.argv.slice(2);
log({ argv: args });
if (args[0] !== "dev" && args[0] !== "start") process.exit(0);
let port;
let host;
for (let index = 1; index < args.length; index += 1) {
  if (args[index] === "--port" || args[index] === "-p") port = Number(args[index + 1]);
  if (args[index] === "--hostname" || args[index] === "-H") host = args[index + 1];
}
const server = http.createServer((_request, response) => response.end("console"));
server.listen(port, host, () => log({ bound: server.address().address, pid: process.pid, port: server.address().port }));
`;

let root: string | undefined;
let foreground: ChildProcess | undefined;

afterEach(() => {
  if (root !== undefined) {
    spawnSync("bash", [join(root, "scripts", "docs-site.sh"), "--stop"], { encoding: "utf8", env: envFor({ root }) });
    foreground?.kill();
    for (const entry of logEntries({ root })) {
      if (entry.pid !== undefined) {
        spawnSync("kill", [String(entry.pid)]);
      }
    }
    rmSync(root, { force: true, recursive: true });
  }
  root = undefined;
  foreground = undefined;
});

/** One line the fake `yarn` wrote: the argv it was run with, or the address its server bound. */
interface YarnLogEntry {
  readonly argv?: readonly string[];
  readonly bound?: string;
  readonly pid?: number;
  readonly port?: number;
}

/**
 * The environment the script runs under: the fake `yarn` first on PATH, a throwaway home, the port to start at.
 *
 * @returns the child's environment
 */
function envFor({ root: at, port }: { root: string; port?: number }): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DOCS_SITE_PORT: port === undefined ? "" : String(port),
    FAKE_YARN_LOG: join(at, "yarn.log"),
    PATH: `${join(at, "bin")}:${process.env["PATH"]!}`,
    SLOPWEAVER_HOME: join(at, "home"),
  };
}

/**
 * Every line the fake `yarn` has written so far.
 *
 * @returns the entries, oldest first; none when it never ran
 */
function logEntries({ root: at }: { root: string }): YarnLogEntry[] {
  const path = join(at, "yarn.log");
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as YarnLogEntry);
}

/**
 * A git checkout holding the script and a `site/` whose install is current, so no real `yarn install` runs.
 *
 * @returns the checkout's root
 */
function makeCheckout(): string {
  const at = mkdtempSync(join(tmpdir(), "docs-bind-"));
  cpSync(SCRIPT, join(at, "scripts", "docs-site.sh"));
  mkdirSync(join(at, "site", "node_modules"), { recursive: true });
  writeFileSync(join(at, "site", "yarn.lock"), "");
  writeFileSync(join(at, "site", "node_modules", ".yarn-state.yml"), "");
  mkdirSync(join(at, "bin"));
  writeFileSync(join(at, "bin", "yarn"), FAKE_YARN);
  chmodSync(join(at, "bin", "yarn"), 0o755);
  // The built-CLI check every dev start runs first, passing: what it refuses is `docsSiteBuiltCliFreshness.test.ts`'s.
  mkdirSync(join(at, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(at, "node_modules", ".bin", "tsx"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(at, "node_modules", ".bin", "tsx"), 0o755);
  const identity = ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false"];
  gitInTemp({ args: ["init", "-q"], cwd: at });
  gitInTemp({ args: [...identity, "commit", "-q", "--allow-empty", "-m", "seed"], cwd: at });
  return at;
}

/**
 * A port nothing is listening on right now.
 *
 * @returns the port
 */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

/**
 * Wait for the fake server to say what it bound, up to fifteen seconds.
 *
 * @returns that entry, or throws when it never bound
 */
async function waitForBind({ root: at }: { root: string }): Promise<YarnLogEntry> {
  for (let tries = 0; tries < 150; tries += 1) {
    const bound = logEntries({ root: at }).find((entry) => entry.bound !== undefined);
    if (bound !== undefined) {
      return bound;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("the fake server never bound");
}

/**
 * What the kernel says is listening on a port, as `lsof` prints it — the same reading that showed `*:3000`.
 *
 * @returns lsof's listing, one socket per line after its header
 */
function listenersOn({ port }: { port: number }): string {
  return spawnSync("lsof", ["-nP", `-iTCP:${String(port)}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout;
}

/**
 * The page a client dialling `localhost` reads — the name every client here uses, against a 127.0.0.1 listener.
 *
 * @returns the body it answered
 */
async function readAsLocalhost({ port }: { port: number }): Promise<string> {
  const response = await fetch(`http://localhost:${String(port)}/`);
  return response.text();
}

describe("docs-site.sh binds every console server to loopback", () => {
  beforeAll(() => {
    // The script itself waits on `lsof` for every start, so without it each case would only time out.
    if (spawnSync("lsof", ["-v"]).error !== undefined) {
      throw new Error("lsof is not on PATH, and docs-site.sh needs it");
    }
  });

  it("starts the background dev server on 127.0.0.1, and a localhost client reaches it", async () => {
    root = makeCheckout();
    const port = await freePort();

    const run = spawnSync("bash", [join(root, "scripts", "docs-site.sh"), "--start"], {
      encoding: "utf8",
      env: envFor({ port, root }),
    });

    expect(run.stderr).toContain(`started http://localhost:${String(port)}`);
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(`http://localhost:${String(port)}`);
    expect(logEntries({ root })[0]!.argv).toEqual(["dev", "--port", String(port), "--hostname", "127.0.0.1"]);
    const bound = await waitForBind({ root });
    expect([bound.bound, bound.port]).toEqual(["127.0.0.1", port]);
    expect(listenersOn({ port })).toContain(`127.0.0.1:${String(port)} (LISTEN)`);
    expect(listenersOn({ port })).not.toContain(`*:${String(port)}`);
    expect(await readAsLocalhost({ port })).toBe("console");
  }, 60_000);

  it("serves the production console on 127.0.0.1, ready even when Node may not fall back from ::1", async () => {
    root = makeCheckout();
    const port = await freePort();

    // The readiness probe is a `node` this script runs, so an inherited NODE_OPTIONS reaches it: one that turns off
    // family autoselection stranded a `localhost` probe on a refused `::1` and stopped a console that was answering.
    const run = spawnSync("bash", [join(root, "scripts", "docs-site.sh"), "--serve"], {
      encoding: "utf8",
      env: { ...envFor({ port, root }), NODE_OPTIONS: "--no-network-family-autoselection" },
    });

    expect(run.stdout).toContain(`at http://localhost:${String(port)} (pid`);
    expect(run.status).toBe(0);
    expect(logEntries({ root }).flatMap((entry) => (entry.argv === undefined ? [] : [entry.argv]))).toEqual([
      ["build"],
      ["start", "--port", String(port), "--hostname", "127.0.0.1"],
    ]);
    const bound = await waitForBind({ root });
    expect([bound.bound, bound.port]).toEqual(["127.0.0.1", port]);
    expect(listenersOn({ port })).toContain(`127.0.0.1:${String(port)} (LISTEN)`);
    expect(listenersOn({ port })).not.toContain(`*:${String(port)}`);
    expect(await readAsLocalhost({ port })).toBe("console");
  }, 120_000);

  it("keeps the foreground serve on 127.0.0.1 even when the caller passes its own -H 0.0.0.0", async () => {
    root = makeCheckout();
    const port = await freePort();

    foreground = spawn("bash", [join(root, "scripts", "docs-site.sh"), "--port", String(port), "-H", "0.0.0.0"], {
      env: envFor({ root }),
      stdio: "ignore",
    });
    const bound = await waitForBind({ root });

    expect(logEntries({ root })[0]!.argv).toEqual([
      "dev",
      "--port",
      String(port),
      "-H",
      "0.0.0.0",
      "--hostname",
      "127.0.0.1",
    ]);
    expect([bound.bound, bound.port]).toEqual(["127.0.0.1", port]);
    expect(await readAsLocalhost({ port })).toBe("console");
  }, 60_000);

  it("gives the site's own dev and start scripts the same loopback host, for a hand-typed start in site/", () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, "site", "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect([manifest.scripts["dev"], manifest.scripts["start"]]).toEqual([
      "next dev --hostname 127.0.0.1",
      "next start --hostname 127.0.0.1",
    ]);
  });
});

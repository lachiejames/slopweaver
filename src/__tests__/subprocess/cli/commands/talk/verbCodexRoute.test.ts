/**
 * `talk verb` running `codex route`, over stores whose app-server never answers — the composition the unit lane
 * cannot reach: the gateway's kill deadline handed to its child, and the fleet read sizing its live batch to that
 * deadline rather than being killed mid-read.
 *
 * The register lives in the store and no lane has one, so the route child is `codexRouteChild.entry.ts` — the
 * shipped verb body over an in-memory register that imports the seeded `plans.json` — and the gateway launches it
 * through its own `runVerbChildOver` seam. Every process below the register stays real: the gateway's child, the
 * `tclsh` it starts and the fake app-servers that one starts. The shipped binary is spawned once, for the other
 * half: with no store selected, `codex route` refuses rather than reading a file.
 *
 * The fake app-server is a real executable launched by the real `tclsh` program; it writes the deadline it
 * INHERITED, so the first case proves the instant crossed every process boundary, and then stays silent, so a
 * store only ever ends by a deadline.
 */
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { runVerbChildOver } from "../../../../../cli/commands/talk/verbRun.js";
import { APP_SERVER_ENV } from "../../../../../codex/accountLive.js";
import { CHILD_DEADLINE_ENV } from "../../../../../lib/childDeadline.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { resolveModelRead } from "../../../../../talk/modelReads.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const TSX = join(repoRoot, "node_modules", ".bin", "tsx");
const ROUTE_CHILD = join(here, "codexRouteChild.entry.ts");
/** The variable naming where the route child writes the fleet-cap rows its in-memory store filed — that entry's own. */
const FILED_FLEET_CAP_ENV = "ROUTE_CHILD_FILED_FLEET_CAP";

/** The talk gateway's own kill deadline (`src/cli/commands/talk/verbRun.ts`). */
const GATEWAY_DEADLINE_MS = 16_000;

/** An app-server that records the deadline it inherited and its pid, then never answers. */
const SILENT_APP_SERVER = `#!/usr/bin/env node
const { join } = require("node:path");
const { writeFileSync } = require("node:fs");
const home = process.env.CODEX_HOME;
writeFileSync(join(home, "deadline"), String(process.env.${CHILD_DEADLINE_ENV}));
writeFileSync(join(home, "pid"), String(process.pid));
process.stdin.on("end", () => {});
setInterval(() => {}, 1000);
`;

const STORES = ["silent-a", "silent-b", "silent-c"] as const;

/** The variables the in-process gateway case moves on this process, for its child to inherit. */
const MOVED_VARS = [APP_SERVER_ENV, "CODEX_HOME", FILED_FLEET_CAP_ENV, "HOME", "SLOPWEAVER_HOME"] as const;

let scratch: string;
let home: string;
let fake: string;
let movedBefore: ReadonlyMap<string, string | undefined>;

beforeEach(() => {
  movedBefore = new Map(MOVED_VARS.map((name) => [name, process.env[name]]));
  scratch = mkdtempSync(join(tmpdir(), "slop-verb-route-"));
  home = join(scratch, "home");
  mkdirSync(home, { recursive: true });
  fake = join(scratch, "fake-app-server.cjs");
  writeFileSync(fake, SILENT_APP_SERVER, "utf8");
  chmodSync(fake, 0o755);
  const rows = STORES.map((alias) => {
    const storeDir = join(scratch, "stores", alias);
    mkdirSync(storeDir, { recursive: true });
    return { alias, provider: "codex", storeDir };
  });
  writeFileSync(stateHomePaths({ home }).plansJson, JSON.stringify({ rows, version: 1 }), "utf8");
});

afterEach(() => {
  for (const [name, value] of movedBefore) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, name);
    } else {
      process.env[name] = value;
    }
  }
  rmSync(scratch, { force: true, recursive: true });
});

/** Where the route child writes any fleet-cap row it filed — absent unless a read filed one. */
function filedFleetCapPath(): string {
  return join(scratch, "filed-fleet-cap.json");
}

/** The environment every case runs its route under: a throwaway home, the fake app-server, no real Codex home. */
function baseEnv(): Record<string, string> {
  return {
    [APP_SERVER_ENV]: fake,
    CODEX_HOME: join(scratch, "no-ambient-codex"),
    HOME: scratch,
    PATH: process.env["PATH"]!,
    [FILED_FLEET_CAP_ENV]: filedFleetCapPath(),
    SLOPWEAVER_HOME: home,
  };
}

/** Run the route child directly, as a seat would run `codex route`, under {@link baseEnv} plus `env`. */
function runRouteChild({ env }: { env: Record<string, string> }): SpawnSyncReturns<string> {
  return spawnSync(TSX, [ROUTE_CHILD, "codex", "route"], {
    cwd: scratch,
    encoding: "utf8",
    env: { ...baseEnv(), ...env },
  });
}

/**
 * Whether a process is still running, by the signal-0 probe: it delivers nothing and fails only when no such
 * process exists.
 *
 * @param pid the process to probe
 * @returns whether it is still running
 */
function isRunning({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The lines `codex route` printed for the three silent stores' rows. */
function storeRowLines({ text }: { text: string }): readonly string[] {
  return text.split("\n").filter((line) => STORES.some((alias) => line.startsWith(`  ${alias} — `)));
}

describe("talk verb codex route", () => {
  it("hands the gateway's kill instant down to the app-server, and answers before it", () => {
    // The gateway's child inherits THIS process's environment, exactly as it inherits the console's.
    for (const [name, value] of Object.entries(baseEnv())) {
      process.env[name] = value;
    }
    const childArgv = unwrap(resolveModelRead({ request: { args: [], noun: "codex", verb: "route" } }));
    const before = Date.now();
    const ran = runVerbChildOver({ childArgv, childCommand: { executable: TSX, prefixArgs: [ROUTE_CHILD] } });
    const after = Date.now();

    expect(childArgv).toEqual(["codex", "route"]);
    expect(ran.timedOut).toBe(false);
    expect(ran.exitCode).toBe(0);
    const inherited = STORES.map((alias) => Number(readFileSync(join(scratch, "stores", alias, "deadline"), "utf8")));
    expect(inherited.every((atMs) => atMs >= before + GATEWAY_DEADLINE_MS && atMs <= after + GATEWAY_DEADLINE_MS)).toBe(
      true,
    );
    const deferred = "no usable weekly observation; no standing refusal found; deferred behind measured destinations";
    const degraded =
      "live read unavailable — the app-server did not answer both requests before the per-store deadline · rollout scan not run: under a caller's deadline the live read is the meter";
    expect(storeRowLines({ text: ran.stdout.text })).toEqual([
      `  silent-a — week unread · ranked #1: ${deferred} · ${degraded}`,
      `  silent-b — week unread · ranked #2: ${deferred} · ${degraded}`,
      `  silent-c — week unread · ranked #3: ${deferred} · ${degraded}`,
    ]);
    const notScanned = ran.stdout.text
      .split("\n")
      .filter((line) => line.endsWith(" · rollout scan not run: under a caller's deadline the live read is the meter"));
    expect(notScanned.length).toBe(STORES.length);
    // The batch kept its standing cleanup margin, so it ended every store it launched rather than orphaning one.
    const pids = STORES.map((alias) => Number(readFileSync(join(scratch, "stores", alias, "pid"), "utf8")));
    expect(pids.map((pid) => isRunning({ pid }))).toEqual([false, false, false]);
    expect(existsSync(filedFleetCapPath())).toBe(false);
  }, 30_000);

  it("launches nothing when the deadline leaves no time for a live read, and still answers before it", () => {
    const deadlineAtMs = Date.now() + 7_000;
    const ran = runRouteChild({ env: { [CHILD_DEADLINE_ENV]: String(deadlineAtMs) } });

    expect(ran.status).toBe(0);
    expect(Date.now()).toBeLessThan(deadlineAtMs);
    expect(STORES.map((alias) => existsSync(join(scratch, "stores", alias, "pid")))).toEqual([false, false, false]);
    const notLaunched = ran.stdout
      .split("\n")
      .filter((line) => line.includes("live read unavailable — not launched: "));
    expect(notLaunched.length).toBe(STORES.length);
    expect(existsSync(filedFleetCapPath())).toBe(false);
  }, 30_000);

  // The outer timeout is a backstop, so a `tclsh` that ignores SIGTERM must still be ended by it.
  it("ends a tclsh that ignores SIGTERM at the outer timeout, and still answers before the deadline", () => {
    const binDir = join(scratch, "deaf-bin");
    mkdirSync(binDir, { recursive: true });
    const deafTclsh = join(binDir, "tclsh");
    writeFileSync(
      deafTclsh,
      '#!/usr/bin/env node\nprocess.on("SIGTERM", () => {});\nsetInterval(() => {}, 1000);\n',
      "utf8",
    );
    chmodSync(deafTclsh, 0o755);
    const deadlineAtMs = Date.now() + 10_000;
    const ran = runRouteChild({
      env: { [CHILD_DEADLINE_ENV]: String(deadlineAtMs), PATH: `${binDir}:${process.env["PATH"]!}` },
    });

    expect(ran.status).toBe(0);
    expect(Date.now()).toBeLessThan(deadlineAtMs);
    const unreadable = ran.stdout.split("\n").filter((line) => line.includes("live read unavailable — "));
    expect(unreadable.length).toBe(STORES.length);
  }, 30_000);

  it("refuses a deadline that is not an instant rather than reading without one", () => {
    const ran = runRouteChild({ env: { [CHILD_DEADLINE_ENV]: "soon" } });

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain(`codex route: ${CHILD_DEADLINE_ENV} is not an epoch-millisecond instant: "soon"`);
  }, 30_000);

  it("refuses from the shipped binary when no store is selected, rather than reading the seeded file", () => {
    const ran = spawnSync(BIN, ["codex", "route"], {
      cwd: scratch,
      encoding: "utf8",
      // No SLOPWEAVER_STORE_URL and no `secrets/store-url` under the throwaway home: nothing is selected.
      env: { ...baseEnv(), SLOPWEAVER_CLI_DIR: repoRoot, TMPDIR: process.env["TMPDIR"]! },
    });

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("the plan register lives in the store, and the store could not be opened");
    expect(STORES.map((alias) => existsSync(join(scratch, "stores", alias, "pid")))).toEqual([false, false, false]);
  }, 30_000);
});

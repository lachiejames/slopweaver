/**
 * The move's liveness and lock rules, run for real: a run record naming a LIVE server, a kernel lock file a refresh
 * holds, and another run's move still in progress each decide which copy of a record stays where.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cachePaths } from "../../../../cacheHome.js";
import { envOf, made, repoRoot, run, SCRIPT, scratch } from "./harness.js";

let sleeper: ChildProcess | undefined;

afterEach(() => {
  sleeper?.kill();
  sleeper = undefined;
  for (const dir of made.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("docs-site.sh moves the console's records out of the home", () => {
  /** A machine with a legacy `docs-site/` under its home, holding one record and one lease. */
  function legacyMachine(): { env: NodeJS.ProcessEnv; legacy: string; current: string } {
    const user = scratch();
    const env = envOf({ over: { SLOPWEAVER_CACHE_HOME: join(user, "cache") }, user });
    const legacy = join(user, "home", "docs-site");
    mkdirSync(join(legacy, "x.hold", "calls"), { recursive: true });
    writeFileSync(join(legacy, "x.hold", "calls", "call.json"), '{"callId":"c","untilMs":1}');
    return { current: cachePaths({ root: join(user, "cache") }).docsSite, env, legacy };
  }

  /** A process whose arguments carry `--port <port>`, as a recorded console's do, so `record_live` names it live. */
  function liveServer({ port }: { port: number }): ChildProcess {
    const running = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)", "--", "--port", String(port)], {
      stdio: "ignore",
    });
    sleeper = running;
    return running;
  }

  it("keeps the cache root's record of a LIVE server over a newer home copy naming a dead one", () => {
    const { env, legacy, current } = legacyMachine();
    mkdirSync(current, { recursive: true });
    const live = JSON.stringify({ pid: liveServer({ port: 4321 }).pid, port: 4321 });
    writeFileSync(join(current, "x-0123abcd.json"), live);
    utimesSync(join(current, "x-0123abcd.json"), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    writeFileSync(join(legacy, "x-0123abcd.json"), '{"pid":2147483646,"port":4322}');

    expect(run({ args: ["--status"], env }).code).toBe(0);
    expect(readFileSync(join(current, "x-0123abcd.json"), "utf8")).toBe(live);
    expect(readFileSync(join(legacy, "x-0123abcd.json"), "utf8")).toBe('{"pid":2147483646,"port":4322}');
  });

  it("takes the home's record of a LIVE server over a newer cache-root copy naming a dead one", () => {
    const { env, legacy, current } = legacyMachine();
    mkdirSync(current, { recursive: true });
    const live = JSON.stringify({ pid: liveServer({ port: 4323 }).pid, port: 4323 });
    writeFileSync(join(legacy, "x-0123abcd.json"), live);
    utimesSync(join(legacy, "x-0123abcd.json"), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    writeFileSync(join(current, "x-0123abcd.json"), '{"pid":2147483646,"port":4324}');

    expect(run({ args: ["--status"], env }).code).toBe(0);
    expect(readFileSync(join(current, "x-0123abcd.json"), "utf8")).toBe(live);
    expect(readlinkSync(legacy)).toBe(current);
  });

  it("asks liveness only of a run record: any other file naming a live server loses to a newer copy", () => {
    const { env, legacy, current } = legacyMachine();
    mkdirSync(join(current, "x.hold"), { recursive: true });
    const live = JSON.stringify({ pid: liveServer({ port: 4325 }).pid, port: 4325 });
    const old = new Date("2026-01-01T00:00:00Z");
    writeFileSync(join(legacy, "notes"), live);
    utimesSync(join(legacy, "notes"), old, old);
    writeFileSync(join(current, "notes"), "newer");
    writeFileSync(join(legacy, "x.hold", "y.json"), live);
    utimesSync(join(legacy, "x.hold", "y.json"), old, old);
    writeFileSync(join(current, "x.hold", "y.json"), "newer");
    writeFileSync(join(legacy, "notes.json"), live);
    utimesSync(join(legacy, "notes.json"), old, old);
    writeFileSync(join(current, "notes.json"), "newer");

    expect(run({ args: ["--status"], env }).code).toBe(0);
    expect(readFileSync(join(current, "notes"), "utf8")).toBe("newer");
    expect(readFileSync(join(current, "notes.json"), "utf8")).toBe("newer");
    expect(readFileSync(join(current, "x.hold", "y.json"), "utf8")).toBe("newer");
    expect(readFileSync(join(legacy, "notes"), "utf8")).toBe(live);
  });

  it("leaves a collision with a link at the old path, whichever side holds the link", () => {
    const { env, legacy, current } = legacyMachine();
    mkdirSync(current, { recursive: true });
    const old = new Date("2026-01-01T00:00:00Z");
    writeFileSync(join(current, "elsewhere"), "elsewhere");
    utimesSync(join(current, "elsewhere"), old, old);
    symlinkSync(join(current, "elsewhere"), join(current, "a"));
    writeFileSync(join(legacy, "a"), "newer");
    writeFileSync(join(current, "b"), "cache");
    symlinkSync(join(current, "elsewhere"), join(legacy, "b"));

    const out = run({ args: ["--status"], env });
    expect(out.code).toBe(0);
    expect(out.stderr).toContain("2 entry(ies) whose cache-root copy is kept");
    expect(readlinkSync(join(current, "a"))).toBe(join(current, "elsewhere"));
    expect(readFileSync(join(legacy, "a"), "utf8")).toBe("newer");
    expect(readFileSync(join(current, "b"), "utf8")).toBe("cache");
    expect(readlinkSync(join(legacy, "b"))).toBe(join(current, "elsewhere"));
  });

  it("never replaces the cache root's kernel lock file, however new the home's copy", () => {
    const { env, legacy, current } = legacyMachine();
    mkdirSync(current, { recursive: true });
    writeFileSync(join(current, "x.refresh.lockf"), "cache");
    utimesSync(join(current, "x.refresh.lockf"), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    writeFileSync(join(legacy, "x.refresh.lockf"), "home");

    expect(run({ args: ["--status"], env }).code).toBe(0);
    expect(readFileSync(join(current, "x.refresh.lockf"), "utf8")).toBe("cache");
    expect(readFileSync(join(legacy, "x.refresh.lockf"), "utf8")).toBe("home");
  });

  /** Hold the kernel lock on one file from another process, resolving once it is taken. */
  async function holdLock({ path }: { path: string }): Promise<ChildProcess> {
    const holder = spawn(
      "bash",
      [
        "-c",
        'exec 8>>"$1"; if command -v lockf >/dev/null; then lockf -s -t 0 8; else flock -n 8; fi; echo locked; exec sleep 30',
        "holder",
        path,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    sleeper = holder;
    await new Promise((done) => holder.stdout.once("data", done));
    return holder;
  }

  it("waits for another run's move to finish before moving anything itself", async () => {
    const { env, legacy, current } = legacyMachine();
    const migrateLock = join(dirname(current), "docs-site.migrate.lockf");
    mkdirSync(dirname(current), { recursive: true });
    const holder = await holdLock({ path: migrateLock });
    const waiting = spawn("bash", [SCRIPT, "--status"], { cwd: repoRoot, env, stdio: "ignore" });
    const exited = new Promise<number | null>((done) => waiting.on("exit", done));

    await new Promise((done) => setTimeout(done, 1000));
    expect(lstatSync(legacy).isDirectory()).toBe(true);
    expect(existsSync(current)).toBe(false);

    holder.kill();
    expect(await exited).toBe(0);
    expect(readlinkSync(legacy)).toBe(current);
  });

  it("leaves a lock file a refresh HOLDS at the old path rather than moving it, and moves one nobody holds", async () => {
    const { env, legacy, current } = legacyMachine();
    mkdirSync(current, { recursive: true });
    writeFileSync(join(legacy, "held.refresh.lockf"), "held");
    writeFileSync(join(legacy, "free.refresh.lockf"), "free");
    await holdLock({ path: join(legacy, "held.refresh.lockf") });

    expect(run({ args: ["--status"], env }).code).toBe(0);
    expect(readFileSync(join(legacy, "held.refresh.lockf"), "utf8")).toBe("held");
    expect(existsSync(join(current, "held.refresh.lockf"))).toBe(false);
    expect(readFileSync(join(current, "free.refresh.lockf"), "utf8")).toBe("free");
    expect(lstatSync(legacy).isDirectory()).toBe(true);
  });

  it("reads a refresh as running while the OLD script holds the home's lock, though the cache root has its own", async () => {
    const { env, legacy, current } = legacyMachine();
    mkdirSync(current, { recursive: true });
    const name = `${basename(repoRoot)}-${createHash("sha1").update(repoRoot).digest("hex").slice(0, 8)}`;
    writeFileSync(
      join(current, `${name}.json`),
      JSON.stringify({ mode: "production", pid: 2147483646, port: 4398, sha: "0".repeat(40) }),
    );
    writeFileSync(join(current, `${name}.refresh.lockf`), "");
    const legacyLock = join(legacy, `${name}.refresh.lockf`);
    writeFileSync(legacyLock, "");
    await holdLock({ path: legacyLock });

    const out = run({ args: ["--refresh", "--background"], env });
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("docs-site: a build left by a killed refresh still holds the lock");
    expect(lstatSync(legacy).isDirectory()).toBe(true);
  });

  it("creates nothing under a home that never served the console", () => {
    const user = scratch();
    const env = envOf({ over: { SLOPWEAVER_CACHE_HOME: join(user, "cache") }, user });
    expect(run({ args: ["--status"], env }).code).toBe(0);
    expect(existsSync(join(user, "home"))).toBe(false);
  });
});

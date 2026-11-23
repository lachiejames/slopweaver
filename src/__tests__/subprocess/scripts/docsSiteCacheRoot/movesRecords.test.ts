/**
 * And the move itself, run for real: a `docs-site/` left under the home is renamed under the cache root with a link
 * at the old path, the link stays while a console started before the move still runs, and goes once none does — so
 * the home ends with no `docs-site/` at all. A home directory the old script recreated beside the cache root's is
 * merged, keeping every live record and lock where its holder can still find it.
 */
import { type ChildProcess, spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cachePaths } from "../../../../cacheHome.js";
import { envOf, made, run, scratch } from "./harness.js";

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

  it("renames the directory under the cache root and leaves a link, then removes the link once nothing names it", () => {
    const { env, legacy, current } = legacyMachine();

    const first = run({ args: ["--status"], env });
    expect(first.code).toBe(0);
    expect(first.stderr).toContain(`moved the console's records from ${legacy} to ${current}`);
    expect(readFileSync(join(current, "x.hold", "calls", "call.json"), "utf8")).toBe('{"callId":"c","untilMs":1}');
    expect(lstatSync(legacy).isSymbolicLink()).toBe(true);
    expect(readlinkSync(legacy)).toBe(current);

    expect(run({ args: ["--status"], env }).code).toBe(0);
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(join(current, "x.hold", "calls", "call.json"))).toBe(true);
  });

  it("keeps the link while a console started before the move is still running, and drops it once it stops", async () => {
    const { env, legacy } = legacyMachine();
    const running = spawn("sleep", ["30"], { stdio: "ignore" });
    sleeper = running;
    writeFileSync(join(legacy, "x.json"), JSON.stringify({ pid: running.pid, startedIso: "2000-01-01T00:00:00Z" }));
    expect(run({ args: ["--status"], env }).code).toBe(0);

    expect(run({ args: ["--status"], env }).code).toBe(0);
    expect(lstatSync(legacy).isSymbolicLink()).toBe(true);

    const gone = new Promise((done) => running.on("exit", done));
    running.kill();
    sleeper = undefined;
    await gone;
    expect(run({ args: ["--status"], env }).code).toBe(0);
    expect(existsSync(legacy)).toBe(false);
  });

  it("refuses a cache root inside the old directory rather than reading past the records it cannot move", () => {
    const { env, legacy } = legacyMachine();
    const inside = { ...env, SLOPWEAVER_CACHE_HOME: join(legacy, "cache") };

    const out = run({ args: ["--status"], env: inside });
    expect(out.code).toBe(1);
    expect(out.stderr).toContain(`sits inside ${legacy}, so the console's records cannot move there`);
    expect(readFileSync(join(legacy, "x.hold", "calls", "call.json"), "utf8")).toBe('{"callId":"c","untilMs":1}');
  });

  it("leaves the link standing when the move's marker cannot be written", () => {
    const { env, legacy, current } = legacyMachine();
    mkdirSync(join(legacy, ".moved-from-home"));

    expect(run({ args: ["--status"], env }).code).toBe(1);
    expect(readlinkSync(legacy)).toBe(current);
    expect(readFileSync(join(legacy, "x.hold", "calls", "call.json"), "utf8")).toBe('{"callId":"c","untilMs":1}');
  });

  it("leaves a link to another cache root for that root's run to retire", () => {
    const { env, legacy, current } = legacyMachine();
    expect(run({ args: ["--status"], env }).code).toBe(0);
    const other = { ...env, SLOPWEAVER_CACHE_HOME: join(scratch(), "other-cache") };

    expect(run({ args: ["--status"], env: other }).code).toBe(0);
    expect(readlinkSync(legacy)).toBe(current);

    expect(run({ args: ["--status"], env }).code).toBe(0);
    expect(existsSync(legacy)).toBe(false);
  });

  it("drops the link while a console started AFTER the move runs, because that one never knew the old path", () => {
    const { env, legacy, current } = legacyMachine();
    expect(run({ args: ["--status"], env }).code).toBe(0);
    sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
    writeFileSync(join(current, "x.json"), JSON.stringify({ pid: sleeper.pid, startedIso: "2000-01-01T00:00:00Z" }));

    expect(run({ args: ["--status"], env }).code).toBe(0);
    expect(existsSync(legacy)).toBe(false);
  });

  it("keeps the link for a console running at the move whose recorded start is later than the move, as after a clock set back", () => {
    const { env, legacy } = legacyMachine();
    sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
    writeFileSync(join(legacy, "x.json"), JSON.stringify({ pid: sleeper.pid, startedIso: "2999-01-01T00:00:00Z" }));
    expect(run({ args: ["--status"], env }).code).toBe(0);

    expect(run({ args: ["--status"], env }).code).toBe(0);
    expect(lstatSync(legacy).isSymbolicLink()).toBe(true);
  });

  it("merges a home directory an old script recreated beside the cache root's, so its live record is found", () => {
    const { env, legacy, current } = legacyMachine();
    mkdirSync(current, { recursive: true });
    writeFileSync(join(current, "other.json"), '{"pid":1}');
    writeFileSync(join(legacy, "mine.json"), '{"pid":2}');

    const out = run({ args: ["--status"], env });
    expect(out.code).toBe(0);
    expect(out.stderr).toContain(`merged the console's records from ${legacy} into ${current}`);
    expect(readFileSync(join(current, "mine.json"), "utf8")).toBe('{"pid":2}');
    expect(readFileSync(join(current, "other.json"), "utf8")).toBe('{"pid":1}');
    expect(readFileSync(join(current, "x.hold", "calls", "call.json"), "utf8")).toBe('{"callId":"c","untilMs":1}');
    expect(readlinkSync(legacy)).toBe(current);
  });

  it("merges a record whose checkout's name starts with two dots, and one with one dot", () => {
    const { env, legacy, current } = legacyMachine();
    mkdirSync(current, { recursive: true });
    writeFileSync(join(legacy, "..foo-abc.json"), '{"pid":2}');
    writeFileSync(join(legacy, ".bar-abc.json"), '{"pid":3}');

    const out = run({ args: ["--status"], env });
    expect(out.code).toBe(0);
    expect(readFileSync(join(current, "..foo-abc.json"), "utf8")).toBe('{"pid":2}');
    expect(readFileSync(join(current, ".bar-abc.json"), "utf8")).toBe('{"pid":3}');
    expect(readlinkSync(legacy)).toBe(current);
  });

  it("takes the home's copy of a record both hold when it is the newer, and merges a hold both hold", () => {
    const { env, legacy, current } = legacyMachine();
    mkdirSync(join(current, "x.hold", "calls"), { recursive: true });
    writeFileSync(join(current, "x.hold", "calls", "other.json"), '{"callId":"o","untilMs":1}');
    writeFileSync(join(current, "x.json"), '{"pid":1}');
    utimesSync(join(current, "x.json"), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    writeFileSync(join(legacy, "x.json"), '{"pid":2}');

    const out = run({ args: ["--status"], env });
    expect(out.code).toBe(0);
    expect(out.stderr).toContain(`merged the console's records from ${legacy} into ${current}`);
    expect(readFileSync(join(current, "x.json"), "utf8")).toBe('{"pid":2}');
    expect(readFileSync(join(current, "x.hold", "calls", "call.json"), "utf8")).toBe('{"callId":"c","untilMs":1}');
    expect(readFileSync(join(current, "x.hold", "calls", "other.json"), "utf8")).toBe('{"callId":"o","untilMs":1}');
    expect(readlinkSync(legacy)).toBe(current);
  });

  it("takes the home's copy when it is newer by less than a second, which bash 3.2's `-nt` reads as a tie", () => {
    const { env, legacy, current } = legacyMachine();
    mkdirSync(current, { recursive: true });
    writeFileSync(join(current, "notes.json"), "cache");
    utimesSync(join(current, "notes.json"), 1767225600.1, 1767225600.1);
    writeFileSync(join(legacy, "notes.json"), "home");
    utimesSync(join(legacy, "notes.json"), 1767225600.9, 1767225600.9);

    expect(run({ args: ["--status"], env }).code).toBe(0);
    expect(readFileSync(join(current, "notes.json"), "utf8")).toBe("home");
    expect(readlinkSync(legacy)).toBe(current);
  });

  it("leaves the home's OLDER copy of a record both hold at the old path, and the old path a directory", () => {
    const { env, legacy, current } = legacyMachine();
    mkdirSync(current, { recursive: true });
    writeFileSync(join(legacy, "x.json"), '{"pid":2}');
    utimesSync(join(legacy, "x.json"), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    writeFileSync(join(current, "x.json"), '{"pid":1}');

    const out = run({ args: ["--status"], env });
    expect(out.code).toBe(0);
    expect(out.stderr).toContain(
      `merged ${legacy} into ${current}; 1 entry(ies) whose cache-root copy is kept (live, a lock, or newer) stay at the old path`,
    );
    expect(lstatSync(legacy).isDirectory()).toBe(true);
    expect(readFileSync(join(legacy, "x.json"), "utf8")).toBe('{"pid":2}');
    expect(readFileSync(join(current, "x.json"), "utf8")).toBe('{"pid":1}');
    expect(existsSync(join(current, "x.hold", "calls", "call.json"))).toBe(true);
  });
});

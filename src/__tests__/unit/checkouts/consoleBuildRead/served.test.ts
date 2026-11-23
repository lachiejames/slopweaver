import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { consoleRecordKey } from "../../../../checkouts/consoleBuild.js";
import { homeDocsSite, read, root, SHA_A, SHA_B, STARTED, stem, useConsoleBuildRoots, worldAt } from "./harness.js";

const ROUND = "bash /work/scripts/docs-site.sh --refresh-round";

useConsoleBuildRoots();

describe("readConsoleBuild", () => {
  it("reads a console whose pid no longer carries its port as down", () => {
    const world = worldAt();
    world.processes.delete(700);
    const report = read({ world });
    expect(report.served).toEqual({
      kind: "production",
      live: false,
      port: 3000,
      sha: SHA_B,
      slot: ".next-serve-a",
      startedIso: STARTED,
    });
  });

  it("refuses a run record naming another checkout", () => {
    const world = worldAt();
    world.files.set(`${stem}.json`, {
      mtimeMs: 0,
      text: JSON.stringify({
        mode: "production",
        pid: 1,
        port: 3000,
        sha: SHA_B,
        slot: ".next-serve-a",
        startedIso: STARTED,
        worktree: "/else",
      }),
    });
    const report = read({ world });
    expect(report.served).toEqual({ kind: "none" });
    expect(report.problems).toEqual([`the run record ${stem}.json names /else, not ${root}`]);
  });

  it("refuses a run record docs-site.sh would not write", () => {
    const world = worldAt();
    world.files.set(`${stem}.json`, { mtimeMs: 0, text: "{" });
    const report = read({ world });
    expect(report.served).toEqual({ kind: "none" });
    expect(report.problems).toEqual([`the run record ${stem}.json is not one docs-site.sh writes`]);
  });

  it("reads a console recorded only under the home, where a server started before the move still records itself", () => {
    const world = worldAt();
    const legacyStem = join(homeDocsSite, consoleRecordKey({ root }));
    world.files.set(`${legacyStem}.json`, world.files.get(`${stem}.json`)!);
    world.files.delete(`${stem}.json`);
    const report = read({ world });
    expect(report.served).toEqual({
      kind: "production",
      live: true,
      port: 3000,
      sha: SHA_B,
      slot: ".next-serve-a",
      startedIso: STARTED,
    });
    expect(report.rebuild.logPath).toBe(`${legacyStem}.refresh.log`);
  });

  it("reads the home's LIVE console over a stopped one the cache root records, which an old checkout started after", () => {
    const world = worldAt();
    const legacyStem = join(homeDocsSite, consoleRecordKey({ root }));
    const record = { mode: "production", pid: 701, port: 3001, sha: SHA_A, slot: ".next-serve-b", startedIso: STARTED };
    world.files.set(`${legacyStem}.json`, { mtimeMs: 0, text: JSON.stringify({ ...record, worktree: root }) });
    world.processes.set(701, "node next start --port 3001");
    world.processes.delete(700);
    const report = read({ world });
    expect(report.served).toEqual({
      kind: "production",
      live: true,
      port: 3001,
      sha: SHA_A,
      slot: ".next-serve-b",
      startedIso: STARTED,
    });
    expect(report.rebuild.logPath).toBe(`${legacyStem}.refresh.log`);
  });

  it("reads the cache root's record over the home's when both hold one", () => {
    const world = worldAt();
    world.files.set(`${join(homeDocsSite, consoleRecordKey({ root }))}.json`, { mtimeMs: 0, text: "{" });
    const report = read({ world });
    expect(report.served).toEqual({
      kind: "production",
      live: true,
      port: 3000,
      sha: SHA_B,
      slot: ".next-serve-a",
      startedIso: STARTED,
    });
    expect(report.rebuild.logPath).toBe(`${stem}.refresh.log`);
  });

  it("says none when no console is recorded", () => {
    const world = worldAt();
    world.files.delete(`${stem}.json`);
    expect(read({ world }).served).toEqual({ kind: "none" });
  });

  it("believes a running round and a held build only while their pids are refresh rounds", () => {
    const world = worldAt();
    world.files.set(`${stem}.refresh.pid`, { mtimeMs: 0, text: "800\n" });
    world.files.set(join(`${stem}.hold`, "waiting.json"), {
      mtimeMs: 0,
      text: JSON.stringify({ pid: 800, sha: SHA_A, sinceIso: "2026-09-28T07:00:00Z" }),
    });
    world.processes.set(800, ROUND);
    expect(read({ world }).rebuild).toEqual({
      logPath: `${stem}.refresh.log`,
      running: true,
      waiting: { pid: 800, sha: SHA_A, sinceIso: "2026-09-28T07:00:00Z" },
    });
    world.processes.set(800, `vim /work/scripts/docs-site.sh`);
    expect(read({ world }).rebuild).toEqual({ logPath: `${stem}.refresh.log`, running: false, waiting: undefined });
  });

  it("reads a refresh.pid that is not a number as no round", () => {
    const world = worldAt();
    world.files.set(`${stem}.refresh.pid`, { mtimeMs: 0, text: "not a pid" });
    expect(read({ world }).rebuild.running).toBe(false);
  });
});

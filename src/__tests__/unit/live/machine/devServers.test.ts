import { describe, expect, it } from "vitest";

import { devServers, servingPids, worktreeOfCwd } from "../../../../live/machine/devServerCensus.js";
import {
  type DocsSiteStarter,
  liveStarterRootPidsOf,
  parseDocsSiteStarter,
  parseLsofCwds,
} from "../../../../live/machine/devServerRead.js";
import { type StrayDevServerInput, strayDevServers } from "../../../../live/machine/devServers.js";
import { parseProcessRows } from "../../../../live/standing/processes.js";
import type { SessionRecord } from "../../../../sessions/liveSessions.js";

/** Two fleet worktrees and the main checkout, spelled the way `worktreePathKey` folds them. */
const ALPHA = "/repo/.claude/worktrees.noindex/alpha";
const BETA = "/repo/.claude/worktrees.noindex/beta";
const MAIN = "/repo";

/**
 * The shape the owner found, written as `ps` really prints it: two servers in one worktree on consecutive ports,
 * one in another worktree, the owner's own server in the main checkout, and a `next build` that is not a server at
 * all. Every argv here is the live shape as measured — a yarn shim (`…/bin/yarn.js dev`), the
 * `next` bin under it, and a `next-server (v15.5.25)` leaf whose own argv names neither a path nor a port,
 * which is exactly why a cwd reading is what identifies one. Repro:
 * `ps -ax -o pid=,ppid=,args= | grep -E 'next|yarn'`.
 */
const PS_TEXT = [
  "  200     1 /node/bin/node /tools/yarn/4.18.0/bin/yarn.js dev --port 3111",
  "  201   200 /node/bin/node /repo/site/node_modules/next/dist/bin/next dev --port 3111",
  "  210     1 /node/bin/node /tools/yarn/4.18.0/bin/yarn.js dev --port 3112",
  "  211   210 /node/bin/node /repo/site/node_modules/next/dist/bin/next dev --port 3112",
  "  212   211 next-server (v15.5.25) ",
  "  301     1 next dev --port 3113",
  "  400     1 next dev --port 3000",
  "  500     1 next build",
  "  600     1 /bin/zsh -c yarn docs",
].join("\n");

const PROCESSES = parseProcessRows({ text: PS_TEXT });

const CWDS = new Map<number, string>([
  [201, `${ALPHA}/site`],
  [211, `${ALPHA}/site`],
  [301, `${BETA}/site`],
  [400, `${MAIN}/site`],
]);

/** 201 has been up an hour, 211 ten minutes — so 201 is the keeper of alpha. */
const ELAPSED = [
  { pid: 201, seconds: 3600 },
  { pid: 211, seconds: 600 },
  { pid: 301, seconds: 1200 },
  { pid: 400, seconds: 90 },
];

const inputWith = (over: Partial<StrayDevServerInput> = {}): StrayDevServerInput => ({
  cpuRows: [],
  cwdByPid: CWDS,
  elapsedRows: ELAPSED,
  liveStarterRootPids: new Set<number>(),
  liveWorktrees: [ALPHA, BETA],
  processes: PROCESSES,
  protectedPids: new Set<number>(),
  terminalSlugs: new Set<string>(),
  ...over,
});

describe("servingPids", () => {
  it("takes every next dev in the snapshot", () => {
    expect(servingPids({ processes: PROCESSES })).toEqual([201, 211, 301, 400]);
  });

  it("never takes a next build, which is not a server and is something a seat is waiting on", () => {
    expect(servingPids({ processes: PROCESSES })).not.toContain(500);
  });
});

describe("worktreeOfCwd", () => {
  it("folds the site directory away, because that is where docs-site.sh serves from", () => {
    expect(worktreeOfCwd({ cwd: `${ALPHA}/site` })).toBe(ALPHA);
  });

  it("takes any other directory as the worktree itself", () => {
    expect(worktreeOfCwd({ cwd: ALPHA })).toBe(ALPHA);
  });
});

describe("devServers", () => {
  const census = devServers({ cpuRows: [], cwdByPid: CWDS, elapsedRows: ELAPSED, processes: PROCESSES });

  it("finds one row per serving process whose cwd was readable", () => {
    expect(census.map((server) => server.servePid)).toEqual([201, 211, 301, 400]);
  });

  it("starts a kill at the YARN WRAPPER, so nothing is left holding the terminal", () => {
    expect(census[0]!.rootPid).toBe(200);
  });

  it("starts at the serving process itself when it was not launched through a wrapper", () => {
    expect(census[2]!.rootPid).toBe(301);
  });

  it("carries the port the argv names, and the worktree its cwd belongs to", () => {
    expect(census[0]!.port).toBe(3111);
    expect(census[1]!.port).toBe(3112);
    expect(census[0]!.worktree).toBe(ALPHA);
  });

  it("orders each tree DEEPEST FIRST, the root last", () => {
    expect(census[1]!.treePids).toEqual([212, 211, 210]);
  });

  it("records what every pid in the tree was running, for the recycled-pid re-check", () => {
    expect(Object.keys(census[1]!.argvByPid).toSorted()).toEqual(["210", "211", "212"]);
    expect(census[1]!.argvByPid["211"]).toBe(
      "/node/bin/node /repo/site/node_modules/next/dist/bin/next dev --port 3112",
    );
  });

  it("says CPU was unmeasured rather than reporting a reap that gives back zero", () => {
    expect(census[0]!.cpuPct).toBeUndefined();
  });

  it("sums the tree's CPU when a sample WAS taken", () => {
    const sampled = devServers({
      cpuRows: [
        { cpuPct: 4, pid: 210 },
        { cpuPct: 31.5, pid: 211 },
        { cpuPct: 2, pid: 212 },
      ],
      cwdByPid: CWDS,
      elapsedRows: ELAPSED,
      processes: PROCESSES,
    });
    expect(sampled[1]!.cpuPct).toBe(37.5);
  });
});

describe("strayDevServers", () => {
  it("takes the SECOND server in a worktree and leaves the one that has been up longer", () => {
    const plan = strayDevServers({ input: inputWith() });
    expect(plan.stray.map((server) => server.servePid)).toEqual([211]);
    expect(plan.stray[0]!.reason).toBe("duplicate");
    expect(plan.stray[0]!.why).toBe(`a second server in ${ALPHA} — pid 201 has been up longer and keeps serving it`);
  });

  it("never touches a server outside a fleet worktree — the owner's own, in the main checkout", () => {
    const plan = strayDevServers({ input: inputWith() });
    expect(plan.stray.map((server) => server.servePid)).not.toContain(400);
    expect(plan.left.find((skip) => skip.servePid === 400)!.why).toBe(
      "it is not in a fleet worktree — no seat owns it",
    );
  });

  it("takes a server whose worktree holds no live seat", () => {
    const plan = strayDevServers({ input: inputWith({ liveWorktrees: [ALPHA] }) });
    const beta = plan.stray.find((server) => server.servePid === 301)!;
    expect(beta.reason).toBe("seat-closed");
    expect(beta.why).toBe(`no live agent session sits in ${BETA}, and the session that started it is gone`);
  });

  it("LEAVES a seatless worktree's server when the session that started it is still live", () => {
    // The reaped-starter shape: a live seat ran `docs-site.sh --start` in a worktree it does not live in, and
    // the reap that took the server is what made the owner watch one reappear four times.
    const plan = strayDevServers({
      input: inputWith({ liveStarterRootPids: new Set([301]), liveWorktrees: [ALPHA] }),
    });
    expect(plan.stray.map((server) => server.servePid)).toEqual([211]);
    expect(plan.left.find((skip) => skip.servePid === 301)!.why).toBe(
      "the session that started it is still live, in a worktree of its own",
    );
  });

  it("protects the RECORDED root pid only — a starter for another server rescues nothing", () => {
    const plan = strayDevServers({
      input: inputWith({ liveStarterRootPids: new Set([200]), liveWorktrees: [ALPHA] }),
    });
    const beta = plan.stray.find((server) => server.servePid === 301)!;
    expect(beta.reason).toBe("seat-closed");
  });

  it("still takes a DUPLICATE whose starter is live — a second server on a second port is waste either way", () => {
    const plan = strayDevServers({ input: inputWith({ liveStarterRootPids: new Set([210]) }) });
    expect(plan.stray.map((server) => server.servePid)).toEqual([211]);
    expect(plan.stray[0]!.reason).toBe("duplicate");
  });

  it("switches the SEAT criterion off entirely when the starter records could not be read", () => {
    const plan = strayDevServers({
      input: inputWith({ liveStarterRootPids: undefined, liveWorktrees: [ALPHA] }),
    });
    expect(plan.stray.map((server) => server.servePid)).toEqual([211]);
    expect(plan.left.find((skip) => skip.servePid === 301)!.why).toBe(
      "the docs-site run records could not be read, so that criterion was not applied",
    );
  });

  it("takes a server whose board row is done or closed, even with the seat still live", () => {
    const plan = strayDevServers({ input: inputWith({ terminalSlugs: new Set(["beta"]) }) });
    const beta = plan.stray.find((server) => server.servePid === 301)!;
    expect(beta.reason).toBe("row-terminal");
    expect(beta.why).toBe("the board row beta is done or closed");
  });

  it("switches a criterion OFF when it was not measured, rather than reading the absence as empty", () => {
    const plan = strayDevServers({ input: inputWith({ liveWorktrees: undefined, terminalSlugs: undefined }) });
    expect(plan.stray.map((server) => server.servePid)).toEqual([211]);
    expect(plan.left.find((skip) => skip.servePid === 301)!.why).toBe(
      "the live agent sessions could not be read and the board could not be read, so that criterion was not applied",
    );
  });

  it("names all three criteria when a lone server passed every one of them", () => {
    const plan = strayDevServers({ input: inputWith() });
    expect(plan.left.find((skip) => skip.servePid === 301)!.why).toBe(
      "its seat is live, its row is open, and it is the only server in its worktree",
    );
  });

  it("calls the KEEPER of a crowded worktree the longest-running one, never the only one", () => {
    const plan = strayDevServers({ input: inputWith() });
    expect(plan.left.find((skip) => skip.servePid === 201)!.why).toBe(
      "its seat is live, its row is open, and of the 2 servers in its worktree it has been up longest",
    );
  });

  it("never signals a pid in the reaping process's own ancestry", () => {
    const plan = strayDevServers({ input: inputWith({ protectedPids: new Set([212]) }) });
    expect(plan.stray).toEqual([]);
    expect(plan.left.find((skip) => skip.servePid === 211)!.why).toBe(
      "this process's own parent chain runs through it",
    );
  });

  it("REPORTS a server whose working directory could not be read, rather than dropping it silently", () => {
    const plan = strayDevServers({ input: inputWith({ cwdByPid: new Map([[201, `${ALPHA}/site`]]) }) });
    const blind = plan.left.find((skip) => skip.servePid === 211)!;
    expect(blind.why).toBe("its working directory could not be read, so no criterion could be evaluated");
    expect(blind.worktree).toBeUndefined();
    expect(plan.stray).toEqual([]);
  });

  it("plans nothing at all when the machine has no dev server on it", () => {
    const plan = strayDevServers({
      input: inputWith({
        cwdByPid: new Map<number, string>(),
        processes: parseProcessRows({ text: "600 1 /bin/zsh" }),
      }),
    });
    expect(plan.stray).toEqual([]);
    expect(plan.left).toEqual([]);
  });
});

describe("parseLsofCwds", () => {
  it("attributes each n line to the p line above it", () => {
    const cwds = parseLsofCwds({ text: `p201\nn${ALPHA}/site\np301\nn${BETA}/site\n` });
    expect([...cwds.entries()]).toEqual([
      [201, `${ALPHA}/site`],
      [301, `${BETA}/site`],
    ]);
  });

  it("drops an n line that belongs to no pid rather than attributing it to the previous one", () => {
    const cwds = parseLsofCwds({ text: `n/orphan/path\np201\nn${ALPHA}/site\n` });
    expect([...cwds.entries()]).toEqual([[201, `${ALPHA}/site`]]);
  });

  it("reads nothing out of empty output", () => {
    expect(parseLsofCwds({ text: "" }).size).toBe(0);
  });
});

describe("parseDocsSiteStarter", () => {
  /** The record `scripts/docs-site.sh` really writes, measured from a `--start` in a fleet seat. */
  const RECORD = JSON.stringify({
    log: "/home/docs-site/alpha-070f6c98.log",
    pid: 79883,
    port: 3001,
    startedIso: "2026-09-20T10:17:52Z",
    starterPid: 3541,
    starterSessionId: "a0000125-0000-4000-8000-000000000138",
    worktree: ALPHA,
  });

  it("reads the server's own pid as the root pid a kill would start from", () => {
    expect(parseDocsSiteStarter({ text: RECORD })!.rootPid).toBe(79883);
  });

  it("reads the starting session, which is the fact no live process still carries", () => {
    const starter = parseDocsSiteStarter({ text: RECORD })!;
    expect(starter.starterPid).toBe(3541);
    expect(starter.starterSessionId).toBe("a0000125-0000-4000-8000-000000000138");
  });

  it("decodes a record written before the starter fields existed with both of them absent", () => {
    const old = parseDocsSiteStarter({ text: JSON.stringify({ pid: 501, port: 3000, worktree: ALPHA }) })!;
    expect(old.rootPid).toBe(501);
    expect(old.starterPid).toBeUndefined();
    expect(old.starterSessionId).toBeUndefined();
  });

  it("refuses a record with no numeric pid, and unparseable text", () => {
    expect(parseDocsSiteStarter({ text: JSON.stringify({ pid: "79883" }) })).toBeUndefined();
    expect(parseDocsSiteStarter({ text: "not json at all" })).toBeUndefined();
  });
});

describe("liveStarterRootPidsOf", () => {
  const session = ({ pid, sessionId }: { pid: number; sessionId: string }): SessionRecord => ({
    cwd: ALPHA,
    entrypoint: "cli",
    kind: "interactive",
    name: "seat",
    pid,
    sessionId,
    startedAtMs: 0,
    status: "busy",
  });

  const starter = (over: Partial<DocsSiteStarter> = {}): DocsSiteStarter => ({
    rootPid: 79883,
    starterPid: 3541,
    starterSessionId: "a0000125",
    ...over,
  });

  it("protects a server whose starting session is still in the registry", () => {
    const live = liveStarterRootPidsOf({
      liveSessions: [session({ pid: 3541, sessionId: "a0000125" })],
      starters: [starter()],
    });
    expect([...live]).toEqual([79883]);
  });

  it("protects nothing when the starting session is gone", () => {
    const live = liveStarterRootPidsOf({
      liveSessions: [session({ pid: 4502, sessionId: "a0000119" })],
      starters: [starter()],
    });
    expect([...live]).toEqual([]);
  });

  it("refuses a RECYCLED starter pid — same pid, a different session now", () => {
    const live = liveStarterRootPidsOf({
      liveSessions: [session({ pid: 3541, sessionId: "a-different-session" })],
      starters: [starter()],
    });
    expect([...live]).toEqual([]);
  });

  it("protects nothing for a record that named no starter at all", () => {
    const live = liveStarterRootPidsOf({
      liveSessions: [session({ pid: 3541, sessionId: "a0000125" })],
      starters: [starter({ starterPid: undefined, starterSessionId: undefined })],
    });
    expect([...live]).toEqual([]);
  });

  it("protects nothing for a record carrying a pid but no session id to bind it to", () => {
    const live = liveStarterRootPidsOf({
      liveSessions: [session({ pid: 3541, sessionId: "a0000125" })],
      starters: [starter({ starterSessionId: undefined })],
    });
    expect([...live]).toEqual([]);
  });
});

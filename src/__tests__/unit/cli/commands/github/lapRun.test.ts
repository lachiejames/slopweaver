import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { batchNote } from "../../../../../cli/commands/github/lapBatchCore.js";
import { lapPlan } from "../../../../../cli/commands/github/lapCore.js";
import { LapErrors } from "../../../../../cli/commands/github/lapErrors.js";
import { land } from "../../../../../cli/commands/github/lapPhases.js";
import { runGithubLap } from "../../../../../cli/commands/github/lapRun.js";
import { lapStatuses } from "../../../../../cli/commands/github/lapStatuses.js";
import { GITHUB_LAP_USAGE } from "../../../../../cli/commands/github/lapUsage.js";
import { err, ok } from "../../../../../lib/result.js";
import {
  ADVANCING_LOCK,
  ARGS,
  BASE,
  depsFor,
  earnedReceipt,
  HEAD,
  observe,
  takeLapHomes,
} from "../../../../lapRunFixture.js";

afterEach(() => {
  for (const home of takeLapHomes()) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("runGithubLap", () => {
  it("posts pending first, runs every planned step, posts both contexts green on the head, and tears down", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed }), rest: ARGS })).toBe(0);
    expect(observed.ran).toEqual(lapPlan().map((step) => step.id));
    expect(observed.posted).toEqual([
      { context: "build", sha: HEAD, state: "pending" },
      { context: "integration", sha: HEAD, state: "pending" },
      { context: "build", sha: HEAD, state: "success" },
      { context: "integration", sha: HEAD, state: "success" },
    ]);
    expect(observed.disposed).toEqual(["store", "lane-home", "tree", "lock"]);
    expect(observed.landing).toEqual([]);
  });

  it("runs every lane in CI's switches and a throwaway home, never the seat's token, cassette mode or home", async () => {
    const observed = observe();
    await runGithubLap({ deps: depsFor({ observed }), rest: ARGS });
    expect(observed.envs[0]).toEqual({
      CI: "true",
      HOME: "/lane-home",
      PATH: "/bin",
      POLLY_MODE: "replay",
      SLOPWEAVER_COVERAGE_BASE_SHA: BASE,
      SLOPWEAVER_HOME: "/lane-home",
      TZ: "UTC",
      YARN_GLOBAL_FOLDER: "/Users/seat/.yarn/berry",
    });
  });

  it("hands the store only to the lanes whose CI job set it, never to integration", async () => {
    const observed = observe();
    await runGithubLap({ deps: depsFor({ observed }), rest: ARGS });
    const envOf = ({ id }: { id: string }): Readonly<Record<string, string>> =>
      observed.envs[observed.ran.indexOf(id)]!;
    expect(envOf({ id: "subprocess" })["STORE_PROOF_ADMIN_URL"]).toBe("postgresql://x");
    expect(Object.keys(envOf({ id: "integration" }))).not.toContain("STORE_PROOF_ADMIN_URL");
    expect(Object.keys(envOf({ id: "subprocess" }))).toContain("STORE_PROOF_ADMIN_URL");
  });

  it("writes a running receipt before the first step and a finished one after the last", async () => {
    const observed = observe();
    await runGithubLap({ deps: depsFor({ observed }), rest: ARGS });
    expect(observed.receipts[0]!.phase).toBe("running");
    expect(observed.receipts[0]!.outcomes).toEqual([]);
    expect(observed.receipts.at(-1)!.phase).toBe("finished");
    expect(observed.receipts.at(-1)!.outcomes.length).toBe(lapPlan().length);
    expect(observed.receipts[0]!.environmentKeys).toContain("SLOPWEAVER_HOME");
  });

  it("stops at the first red step and posts its context as failed, never green", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed, red: ["lint"] }), rest: ARGS })).toBe(1);
    expect(observed.ran.slice(-2)).toEqual(["integration", "lint"]);
    expect(observed.posted.slice(2).map((status) => status.state)).toEqual(["failure", "success"]);
    expect(observed.disposed).toEqual(["store", "lane-home", "tree", "lock"]);
  });

  it("retries a red Vitest lane once, whole, and records the first exit when the retry is green", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed, red: ["unit-1"] }), rest: ARGS })).toBe(0);
    expect(observed.ran.slice(observed.ran.indexOf("unit-1"), observed.ran.indexOf("unit-1") + 3)).toEqual([
      "unit-1",
      "unit-1.retry",
      "unit-2",
    ]);
    const unit1 = observed.receipts.at(-1)!.outcomes.find((outcome) => outcome.id === "unit-1")!;
    expect(unit1.firstExit).toBe(1);
    expect(unit1.exitCode).toBe(0);
  });

  it("stands a Vitest lane's red when its one retry is red too", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed, red: ["unit-1", "unit-1.retry"] }), rest: ARGS })).toBe(1);
    expect(observed.ran.slice(-2)).toEqual(["unit-1", "unit-1.retry"]);
    expect(observed.posted.slice(2).map((status) => status.state)).toEqual(["failure", "success"]);
  });

  it("posts error over the pending when the store will not start, running no lane", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed, storeFails: true }), rest: ARGS })).toBe(1);
    expect(observed.ran).toEqual([]);
    expect(observed.posted.map((status) => status.state)).toEqual(["pending", "pending", "error", "error"]);
    expect(observed.disposed).toEqual(["lane-home", "tree", "lock"]);
    expect(observed.diagnostic).toEqual(["github lap: stopped — the lap's throwaway store would not start"]);
  });

  it("refuses a head behind its base before running or posting anything", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ contains: false, observed }), rest: ARGS })).toBe(1);
    expect(observed.ran).toEqual([]);
    expect(observed.posted).toEqual([]);
    expect(observed.diagnostic).toEqual([
      "github lap: refused — the head 777de6d8be does not contain main's tip 4cf8df588a: rebase it and push, so the tree the lap tests is the tree that lands",
    ]);
  });

  it("refuses when this checkout's CI register differs from the head's, so it never runs another plan", async () => {
    const observed = observe();
    const deps = depsFor({ differing: ["src/devLint/ciOffloadCommands.ts"], observed });
    expect(await runGithubLap({ deps, rest: ARGS })).toBe(1);
    expect(observed.posted).toEqual([]);
    expect(observed.diagnostic).toEqual([
      "github lap: refused — this checkout's src/devLint/ciOffloadCommands.ts differs from the head 777de6d8be's, so the lap would run a plan the head does not declare: run it from a checkout whose CI model matches the head's",
    ]);
  });

  it("dry-runs the preflight and the plan, printing the pinned-app note, running and posting nothing", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed }), rest: [...ARGS, "--dry-run"] })).toBe(0);
    expect(observed.ran).toEqual([]);
    expect(observed.posted).toEqual([]);
    expect(observed.out[0]).toBe(
      'github lap: note — "build" and "integration" are pinned to app 15368, so GitHub itself will not count the lap\'s statuses; the landing is the administrator bypass',
    );
    expect(observed.out.length).toBe(1 + lapPlan().length);
  });

  it("lands by checking the landing first, then taking the hold BEFORE refetching, merging, releasing", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed }), rest: [...ARGS, "--land"] })).toBe(0);
    expect(observed.landing).toEqual(["landing preconditions in /tree", "hold", "fetch", "merge in /tree", "release"]);
  });

  it("measures the landing check and the merge each in a fresh tree, all under the lock it releases last", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed }), rest: [...ARGS, "--land"] })).toBe(0);
    expect(observed.disposed).toEqual(["tree", "store", "lane-home", "tree", "tree", "lock"]);
  });

  it("refuses --land before any post or lane when the landing would refuse, naming why and releasing the lock", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ landingExit: 1, observed }), rest: [...ARGS, "--land"] })).toBe(1);
    expect(observed.ran).toEqual([]);
    expect(observed.posted).toEqual([]);
    expect(observed.landing).toEqual(["landing preconditions in /tree"]);
    expect(observed.disposed).toEqual(["tree", "lock"]);
    expect(observed.diagnostic).toEqual([
      "github lap: refused — the landing would refuse: `github merge --admin --dry-run` exited 1; its refusal is printed above, and no lap can clear it",
    ]);
  });

  it("refuses --land when no tree can be made to check the landing in, running nothing", async () => {
    const observed = observe();
    const deps = {
      ...depsFor({ observed }),
      checkout: () => Promise.resolve(err(LapErrors.refused({ reason: "worktree add failed" }))),
    };
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land"] })).toBe(1);
    expect(observed.ran).toEqual([]);
    expect(observed.landing).toEqual([]);
    expect(observed.diagnostic[0]).toContain(
      "github lap: refused — the landing could not be checked before the lap: no tree could be made to measure it in: ",
    );
  });

  it("checks the landing under --land --dry-run, then prints the plan and runs nothing", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed }), rest: [...ARGS, "--land", "--dry-run"] })).toBe(0);
    expect(observed.landing).toEqual(["landing preconditions in /tree"]);
    expect(observed.ran).toEqual([]);
    expect(observed.posted).toEqual([]);
    expect(observed.out.length).toBe(1 + lapPlan().length);
  });

  it("refuses --land --dry-run when the landing would refuse, so a dry run names the stop a lap would hit", async () => {
    const observed = observe();
    const deps = depsFor({ landingExit: 1, observed });
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land", "--dry-run"] })).toBe(1);
    expect(observed.out.length).toBe(1);
  });

  it("never checks the landing ahead for a plain lap, which lands nothing", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ landingExit: 1, observed }), rest: ARGS })).toBe(0);
    expect(observed.landing).toEqual([]);
  });

  it("lands on the lap a head already earned with --land-only, running and posting nothing", async () => {
    const observed = observe();
    const preposted = [
      { context: "build", description: "local lap: 20 steps green in 35m over base 4cf8df588a", state: "success" },
      { context: "integration", description: "local lap: 1 steps green in 1m over base 4cf8df588a", state: "success" },
    ];
    const deps = depsFor({ observed, preposted, receipts: [earnedReceipt()] });
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land-only"] })).toBe(0);
    expect(observed.ran).toEqual([]);
    expect(observed.posted).toEqual([]);
    expect(observed.landing).toEqual(["hold", "fetch", "merge in /tree", "release"]);
  });

  it("refuses --land-only on a lap's green this machine keeps no receipt of, since any poster can write one", async () => {
    const observed = observe();
    const preposted = [
      { context: "build", description: "local lap: forged over base 4cf8df588a", state: "success" },
      { context: "integration", description: "local lap: forged over base 4cf8df588a", state: "success" },
    ];
    const receipts = [{ ...earnedReceipt(), phase: "running" }];
    expect(
      await runGithubLap({ deps: depsFor({ observed, preposted, receipts }), rest: [...ARGS, "--land-only"] }),
    ).toBe(1);
    expect(observed.landing).toEqual([]);
    expect(observed.diagnostic).toEqual([
      `github lap: not landing on an earned lap — no finished lap receipt on this machine shows all ${String(lapPlan().length)} steps green at head 777de6d8be over base 4cf8df588a`,
    ]);
  });

  it("refuses --land-only on one member over a batch's newer green, even with its own earlier receipt", async () => {
    const observed = observe();
    const outcomes = lapPlan().map((step) => ({ context: step.context, exitCode: 0, id: step.id, wallMs: 1000 }));
    const batchGreen = lapStatuses({ baseTip: BASE, note: batchNote({ size: 2 }), outcomes, plan: lapPlan() });
    const deps = depsFor({ observed, preposted: batchGreen, receipts: [earnedReceipt()] });
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land-only"] })).toBe(1);
    expect(observed.landing).toEqual([]);
    expect(batchGreen[0]!.description.startsWith("local lap batch: ")).toBe(true);
  });

  it("holds the lap lock from --land-only's check through its merge, so no lap posts over the head between", async () => {
    const observed = observe();
    const preposted = [
      { context: "build", description: "local lap: 20 steps green in 35m over base 4cf8df588a", state: "success" },
      { context: "integration", description: "local lap: 1 steps green in 1m over base 4cf8df588a", state: "success" },
    ];
    const deps = {
      ...depsFor({ observed, preposted, receipts: [earnedReceipt()] }),
      acquireLock: () => {
        observed.landing.push("lock");
        return ok({ dispose: () => Promise.resolve(void observed.landing.push("unlock")), value: ADVANCING_LOCK });
      },
    };
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land-only"] })).toBe(0);
    expect(observed.landing).toEqual(["lock", "hold", "fetch", "merge in /tree", "release", "unlock"]);
  });

  it("refuses --land-only while another lap holds the machine, landing nothing", async () => {
    const observed = observe();
    const held = LapErrors.lockHeld({
      phase: "running its lanes or landing",
      pid: 99,
      startedIso: "2026-11-10T02:00:00.000Z",
      subject: "o/r#3,7@abc",
    });
    const deps = { ...depsFor({ observed, receipts: [earnedReceipt()] }), acquireLock: () => err(held) };
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land-only"] })).toBe(1);
    expect(observed.landing).toEqual([]);
    expect(observed.diagnostic).toEqual([
      "github lap: refused — another lap holds this machine: o/r#3,7@abc, pid 99, since 2026-11-10T02:00:00.000Z, running its lanes or landing. One lap at a time, because two would each starve the other into timeouts; run again once it finishes",
    ]);
  });

  it("refuses --land-only over a lap's green on an older base, landing nothing", async () => {
    const observed = observe();
    const preposted = [
      { context: "build", description: "local lap: 20 steps green in 35m over base 0123456789", state: "success" },
      { context: "integration", description: "local lap: 1 steps green in 1m over base 4cf8df588a", state: "success" },
    ];
    const deps = depsFor({ observed, preposted, receipts: [earnedReceipt()] });
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land-only"] })).toBe(1);
    expect(observed.landing).toEqual([]);
    expect(observed.diagnostic).toEqual([
      'github lap: not landing on an earned lap — "build" reads success ("local lap: 20 steps green in 35m over base 0123456789"), not a lap\'s green over base 4cf8df588a',
    ]);
  });

  it("does not merge when the base moved under the lap, and still releases the hold", async () => {
    const observed = observe();
    const refsAfter = { baseTip: "9999999999aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", headSha: HEAD };
    expect(await runGithubLap({ deps: depsFor({ observed, refsAfter }), rest: [...ARGS, "--land"] })).toBe(1);
    expect(observed.landing).toEqual(["landing preconditions in /tree", "hold", "fetch", "release"]);
    expect(observed.diagnostic).toEqual([
      "github lap: not landing — the base or the head moved while the lap ran, so the tree it tested is not the tree that would land; rebase, push and lap again",
    ]);
  });

  it("answers the merge's own exit when it refuses, after releasing the hold", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ mergeExit: 2, observed }), rest: [...ARGS, "--land"] })).toBe(2);
    expect(observed.landing).toEqual(["landing preconditions in /tree", "hold", "fetch", "merge in /tree", "release"]);
  });

  it("names the live lap holding the machine and runs or posts nothing", async () => {
    const observed = observe();
    const held = LapErrors.lockHeld({
      phase: "still in its preflight, before its lanes",
      pid: 99,
      startedIso: "2026-11-10T02:00:00.000Z",
      subject: "o/r#3",
    });
    const deps = { ...depsFor({ observed }), acquireLock: () => err(held) };
    expect(await runGithubLap({ deps, rest: ARGS })).toBe(1);
    expect(observed.ran).toEqual([]);
    expect(observed.posted).toEqual([]);
    expect(observed.diagnostic).toEqual([
      "github lap: refused — another lap holds this machine: o/r#3, pid 99, since 2026-11-10T02:00:00.000Z, still in its preflight, before its lanes. One lap at a time, because two would each starve the other into timeouts; run again once it finishes",
    ]);
  });

  it("never refetches, merges or releases when the hold itself could not be taken", async () => {
    const observed = observe();
    const deps = depsFor({ holdExit: 3, observed });
    const args = {
      acknowledge: undefined,
      dryRun: false,
      home: undefined,
      land: true,
      landOnly: false,
      number: 7,
      owner: "o",
      repo: "r",
    };
    const session = {
      api: deps.makeApi({ home: deps.home(), token: "token" }),
      args,
      baseRef: "main",
      deps,
      home: deps.home(),
      refs: { baseTip: BASE, headSha: HEAD },
    };
    expect(await land({ session })).toBe(3);
    expect(observed.landing).toEqual(["hold"]);
    expect(observed.diagnostic).toEqual(["github lap: not landing — the hold could not be taken"]);
  });

  it("never takes, merges under or releases a hold another session already placed", async () => {
    const observed = observe();
    const deps = depsFor({ holder: { holder: "claude-code:other-session", kind: "held" }, observed });
    const args = {
      acknowledge: undefined,
      dryRun: false,
      home: undefined,
      land: true,
      landOnly: false,
      number: 7,
      owner: "o",
      repo: "r",
    };
    const session = {
      api: deps.makeApi({ home: deps.home(), token: "token" }),
      args,
      baseRef: "main",
      deps,
      home: deps.home(),
      refs: { baseTip: BASE, headSha: HEAD },
    };
    expect(await land({ session })).toBe(1);
    expect(observed.landing).toEqual([]);
    expect(observed.diagnostic).toEqual([
      "github lap: not landing — o/r's merge queue is already held by claude-code:other-session, and a hold the lap did not place is never the lap's to release; land once it is released",
    ]);
  });

  it("never takes a hold over a hold document it could not read", async () => {
    const observed = observe();
    const deps = depsFor({
      holder: { kind: "unreadable", path: "/h/live/github/merge-hold.json", why: "EACCES" },
      observed,
    });
    const args = {
      acknowledge: undefined,
      dryRun: false,
      home: undefined,
      land: true,
      landOnly: false,
      number: 7,
      owner: "o",
      repo: "r",
    };
    const session = {
      api: deps.makeApi({ home: deps.home(), token: "token" }),
      args,
      baseRef: "main",
      deps,
      home: deps.home(),
      refs: { baseTip: BASE, headSha: HEAD },
    };
    expect(await land({ session })).toBe(1);
    expect(observed.landing).toEqual([]);
    expect(observed.diagnostic).toEqual([
      "github lap: not landing — the merge hold at /h/live/github/merge-hold.json could not be read (EACCES), so a hold already standing there cannot be ruled out; repair or remove that file, then land",
    ]);
  });

  it("refuses a usage mistake with exit 2 and the usage, before any credential or read", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed }), rest: ["--number", "7"] })).toBe(2);
    expect(observed.diagnostic).toEqual(["--repo owner/name is required", GITHUB_LAP_USAGE]);
    expect(observed.posted).toEqual([]);
  });
});

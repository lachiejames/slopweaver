/**
 * The courier's in-place re-exec, through plain fake seams: the exact request, the checks that stand between it and
 * an exec Node 24 cannot survive failing (each check itself is `./courierExecChecks.test.ts`), and the follower's
 * cadence, stabilisation and once-only notices.
 */
import { describe, expect, it } from "vitest";

import {
  type CourierExecRequest,
  type CourierFollowerDeps,
  type CourierMeasurement,
  type CourierReexecError,
  CourierReexecErrors,
  courierExecRequest,
  courierFollower,
  execCourier,
} from "../../../../../cli/commands/talk/courierReexec.js";
import { err, type Result } from "../../../../../lib/result.js";
import { COURIER_FRESHNESS_EVERY_MS } from "../../../../../talk/courierFreshness.js";

const MAIN = "/repo/main";
const WORKTREE = "/repo/.claude/worktrees.noindex/fresh-supervisor-handoff-9356";
const AT = "2026-10-31T06:30:00.000Z";

describe("courierExecRequest", () => {
  it("runs main's own launcher as the follower, forced to main and to this tier, every other variable kept and the instant and pid stamped", () => {
    expect(
      courierExecRequest({
        env: { CMUX_WORKSPACE_ID: "ws-1", SLOPWEAVER_CLI_DIR: WORKTREE, SLOPWEAVER_LAUNCHER_NO_TSX_WRAPPER: "0" },
        mainRoot: MAIN,
        pid: 2059,
        reexecAtIso: AT,
      }),
    ).toEqual({
      argv: ["/repo/main/bin/slopweaver", "talk", "courier", "--follow"],
      env: {
        CMUX_WORKSPACE_ID: "ws-1",
        SLOPWEAVER_CLI_DIR: MAIN,
        SLOPWEAVER_COURIER_REEXEC_AT: AT,
        SLOPWEAVER_COURIER_REEXEC_PID: "2059",
        SLOPWEAVER_LAUNCHER_NO_TSX_WRAPPER: "1",
      },
      file: "/repo/main/bin/slopweaver",
      mainRoot: MAIN,
    });
  });
});

describe("execCourier", () => {
  it("never reaches the exec when the launcher is not executable, and says so", () => {
    const execed: CourierExecRequest[] = [];
    const request = courierExecRequest({ env: {}, mainRoot: MAIN, pid: 2059, reexecAtIso: AT });
    const result = execCourier({
      deps: {
        accessExecutable: () => {
          throw new Error("EACCES: permission denied, access '/repo/main/bin/slopweaver'");
        },
        builtCliRefusal: () => undefined,
        execve: (options) => {
          execed.push(options);
          throw new Error("unreachable: the fake exec was called");
        },
      },
      request,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({
      code: "LAUNCHER_NOT_EXECUTABLE",
      file: "/repo/main/bin/slopweaver",
      message:
        "talk courier: not re-executing — /repo/main/bin/slopweaver is not executable here (EACCES: permission denied, access '/repo/main/bin/slopweaver'); following on, and a later check tries again",
    });
    expect(execed).toEqual([]);
  });

  it("never reaches the check or the exec when main's built CLI would refuse as stale, and says so", () => {
    const execed: CourierExecRequest[] = [];
    const accessed: string[] = [];
    const request = courierExecRequest({ env: {}, mainRoot: MAIN, pid: 2059, reexecAtIso: AT });
    const result = execCourier({
      deps: {
        accessExecutable: ({ file }) => {
          accessed.push(file);
        },
        builtCliRefusal: ({ mainRoot }) => `${mainRoot}/src changed since the build`,
        execve: (options) => {
          execed.push(options);
          throw new Error("unreachable: the fake exec was called");
        },
      },
      request,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({
      code: "MAIN_BUILD_STALE",
      mainRoot: MAIN,
      message:
        "talk courier: not re-executing — /repo/main's launcher would run its built CLI, which would refuse (/repo/main/src changed since the build); following on until it is rebuilt",
    });
    expect(accessed).toEqual([]);
    expect(execed).toEqual([]);
  });

  it("execs exactly the request once main runs current code and the launcher checks executable", () => {
    const execed: CourierExecRequest[] = [];
    const request = courierExecRequest({ env: { A: "1" }, mainRoot: MAIN, pid: 2059, reexecAtIso: AT });
    expect(() =>
      execCourier({
        deps: {
          accessExecutable: () => undefined,
          builtCliRefusal: () => undefined,
          execve: (options) => {
            execed.push(options);
            throw new Error("exec'd");
          },
        },
        request,
      }),
    ).toThrow("exec'd");
    expect(execed).toEqual([request]);
  });
});

/** A follower over scripted measurements and a hand-wound clock, recording everything it says and execs. */
function harness({
  runningRoot,
  measurements,
  execResult = err(
    CourierReexecErrors.launcherNotExecutable({ cause: new Error("fake"), file: "/repo/main/bin/slopweaver" }),
  ),
}: {
  runningRoot: string;
  measurements: CourierMeasurement[];
  execResult?: Result<never, CourierReexecError>;
}): {
  readonly deps: CourierFollowerDeps;
  readonly clock: { ms: number };
  readonly out: string[];
  readonly errors: string[];
  readonly execs: string[];
  readonly drains: number[];
} {
  const clock = { ms: Date.parse(AT) };
  const out: string[] = [];
  const errors: string[] = [];
  const execs: string[] = [];
  const drains: number[] = [];
  const deps: CourierFollowerDeps = {
    drain: async () => {
      drains.push(out.length);
    },
    error: ({ line }) => {
      errors.push(line);
    },
    exec: ({ mainRoot, reexecAtIso }) => {
      execs.push(`${mainRoot} @ ${reexecAtIso}`);
      return execResult;
    },
    measure: () => measurements.shift()!,
    nowMs: () => clock.ms,
    out: ({ line }) => {
      out.push(line);
    },
    reexecAtIso: undefined,
    runningRoot,
    startHead: undefined,
  };
  return { clock, deps, drains, errors, execs, out };
}

const fromMain: CourierMeasurement = {
  current: { kind: "unresolved", why: "not measured off main" },
  main: { kind: "resolved", root: MAIN },
};

describe("courierFollower", () => {
  it("measures on the first pass, not again within the minute, and execs into main on the second observation", async () => {
    const h = harness({ measurements: [fromMain, fromMain], runningRoot: WORKTREE });
    const follower = courierFollower({ deps: h.deps });
    await follower.check();
    h.clock.ms += COURIER_FRESHNESS_EVERY_MS - 1;
    await follower.check();
    expect(h.execs).toEqual([]);
    h.clock.ms += 1;
    await follower.check();
    const at = new Date(Date.parse(AT) + COURIER_FRESHNESS_EVERY_MS).toISOString();
    expect(h.execs).toEqual([`${MAIN} @ ${at}`]);
    expect(h.out).toEqual([
      "talk courier: re-executing in place from the main checkout /repo/main — this follower runs another tree's code",
    ]);
    // Drained after the restart line was written, before the exec.
    expect(h.drains).toEqual([1]);
    expect(h.errors).toEqual([
      "talk courier: not re-executing — /repo/main/bin/slopweaver is not executable here (fake); following on, and a later check tries again",
    ]);
  });

  it("after a refused exec, waits for two fresh observations before trying again", async () => {
    const h = harness({ measurements: [fromMain, fromMain, fromMain, fromMain], runningRoot: WORKTREE });
    const follower = courierFollower({ deps: h.deps });
    for (let check = 0; check < 3; check += 1) {
      await follower.check();
      h.clock.ms += COURIER_FRESHNESS_EVERY_MS;
    }
    expect(h.execs.length).toBe(1);
    await follower.check();
    expect(h.execs.length).toBe(2);
  });

  it("says an unmeasured reason once however many checks repeat it, and execs nothing", async () => {
    const unresolved: CourierMeasurement = {
      current: { kind: "unresolved", why: "not measured off main" },
      main: { kind: "unresolved", why: "cannot name the main checkout to run from: no main checkouts are declared" },
    };
    const h = harness({ measurements: [unresolved, unresolved, unresolved], runningRoot: WORKTREE });
    const follower = courierFollower({ deps: h.deps });
    for (let check = 0; check < 3; check += 1) {
      await follower.check();
      h.clock.ms += COURIER_FRESHNESS_EVERY_MS;
    }
    expect(h.errors).toEqual([
      "talk courier: cannot name the main checkout to run from: no main checkouts are declared",
    ]);
    expect(h.execs).toEqual([]);
  });

  it("stays quiet on main at its start head", async () => {
    const current: CourierMeasurement = {
      current: { changedPaths: [], head: "fd1b669e0f", kind: "resolved" },
      main: { kind: "resolved", root: MAIN },
    };
    const h = harness({ measurements: [current, current], runningRoot: MAIN });
    const follower = courierFollower({ deps: { ...h.deps, startHead: "fd1b669e0f" } });
    await follower.check();
    h.clock.ms += COURIER_FRESHNESS_EVERY_MS;
    await follower.check();
    expect(h.out).toEqual([]);
    expect(h.errors).toEqual([]);
    expect(h.execs).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { absentAsNull, absentAsNumber } from "#lib/absent.js";
import { err, ok, type Result } from "#lib/result.js";
import { buildResyncPolicies, type ResyncPolicy } from "../../../../live/resync/policy.js";
import { type ResyncRunDeps, runResync } from "../../../../live/resync/run.js";

const HOUR = 60 * 60 * 1000;

const atlasPolicy = ({ command }: { command: string }): ResyncPolicy =>
  buildResyncPolicies({
    atlases: [{ platform: "clerk", resyncCommand: command, seated: true, windowMs: 4 * HOUR }],
    corpus: [],
  }).policies[0]!;

const slackPolicy = (): ResyncPolicy =>
  buildResyncPolicies({ atlases: [], corpus: [{ source: "slack", subject: { kind: "none" }, windowMs: 4 * HOUR }] })
    .policies[0]!;

/** A runner whose verb outcomes and clock readings are supplied, so no CLI, no filesystem and no store is touched. */
const fakeDeps = ({
  exitCodes,
  clocks,
  ran,
  lines,
  stops = [],
  recoveries = [],
  walls = [],
  collisions = [],
  asOf = ok(null),
}: {
  exitCodes: readonly number[];
  /** What the target certifies its success current as of; `ok(null)` for a target that certifies none. */
  asOf?: Result<string | null>;
  clocks: readonly (string | null)[];
  ran: string[][];
  lines: string[];
  /** What the browser-stop register answers on each drain, the first being the pre-attempt one. */
  stops?: readonly (readonly string[])[];
  /** What the recovered-drop register answers on each drain, the first being the pre-attempt one. */
  recoveries?: readonly (readonly string[])[];
  /** What the sign-in-wall register answers on each drain, the first being the pre-attempt one. */
  walls?: readonly (readonly string[])[];
  /** What the collision register answers on each drain, the first being the pre-attempt one. */
  collisions?: readonly (readonly string[])[];
}): ResyncRunDeps => {
  let step = 0;
  let read = 0;
  let drain = 0;
  let recoveryDrain = 0;
  let wallDrain = 0;
  let collisionDrain = 0;
  return {
    takeWalkCollisions: () => {
      const declared = collisionDrain < collisions.length;
      collisionDrain += 1;
      if (declared) {
        return collisions[collisionDrain - 1]!;
      }
      return [];
    },
    takeSignInWalls: () => {
      const declared = wallDrain < walls.length;
      wallDrain += 1;
      if (declared) {
        return walls[wallDrain - 1]!;
      }
      return [];
    },
    takeRelayRecoveries: () => {
      const declared = recoveryDrain < recoveries.length;
      recoveryDrain += 1;
      if (declared) {
        return recoveries[recoveryDrain - 1]!;
      }
      return [];
    },
    takeWalkStops: () => {
      const declared = drain < stops.length;
      drain += 1;
      if (declared) {
        return stops[drain - 1]!;
      }
      return [];
    },
    now: () => "2026-09-12T04:00:00.000Z",
    readAsOf: () => asOf,
    readClock: () => {
      const clock = absentAsNull({ value: clocks[Math.min(read, clocks.length - 1)] });
      read += 1;
      return Promise.resolve(clock);
    },
    runVerb: (argv) => {
      ran.push([...argv]);
      const code = absentAsNumber({ value: exitCodes[Math.min(step, exitCodes.length - 1)], whenAbsent: 0 });
      step += 1;
      return Promise.resolve(code);
    },
    writeOut: (line) => {
      lines.push(line);
    },
  };
};

describe("runResync", () => {
  it("runs every step in order, pointing each at the home it was given", async () => {
    const ran: string[][] = [];
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({
        clocks: ["2026-09-11T00:00:00.000Z", "2026-09-12T03:00:00.000Z"],
        exitCodes: [0, 0],
        lines: [],
        ran,
      }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync && slopweaver atlas clerk walk" }),
      previous: null,
    });
    expect(ran).toEqual([
      ["node", "slopweaver", "atlas", "clerk", "sync", "--home", "/tmp/sandbox"],
      ["node", "slopweaver", "atlas", "clerk", "walk", "--home", "/tmp/sandbox"],
    ]);
    expect(result.attempt.outcome).toBe("succeeded");
  });

  it("stops a compound target at its first failing step", async () => {
    const ran: string[][] = [];
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({ clocks: ["2026-09-11T00:00:00.000Z"], exitCodes: [1, 0], lines: [], ran }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync && slopweaver atlas clerk walk" }),
      previous: null,
    });
    expect(ran.length).toBe(1);
    expect(result.attempt.problems).toEqual(["`slopweaver atlas clerk sync` exited 1", "exited 1"]);
  });

  it("fails an atlas whose clock moved when a LATER step exits non-zero, naming that step", async () => {
    const ran: string[][] = [];
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({
        clocks: ["2026-09-11T00:00:00.000Z", "2026-09-12T03:00:00.000Z"],
        exitCodes: [0, 3],
        lines: [],
        ran,
      }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({
        command: "slopweaver atlas datadog sync && slopweaver datadog catalogue build --from 7d",
      }),
      previous: null,
    });
    expect(ran.length).toBe(2);
    expect(result.attempt.outcome).toBe("failed");
    expect(result.attempt.problems[0]).toBe("`slopweaver datadog catalogue build --from 7d` exited 3");
  });

  it("fails an atlas whose steps exited 0 and whose clock did not move", async () => {
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({
        clocks: ["2026-09-06T10:04:27.618Z", "2026-09-06T10:04:27.618Z"],
        exitCodes: [0],
        lines: [],
        ran: [],
      }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync" }),
      previous: null,
    });
    expect(result.attempt.exitCode).toBe(0);
    expect(result.attempt.outcome).toBe("failed");
    expect(result.state.lastSuccessAtIso).toBe(null);
  });

  it("records the clock either side of the attempt", async () => {
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({
        clocks: ["2026-09-11T00:00:00.000Z", "2026-09-12T03:00:00.000Z"],
        exitCodes: [0],
        lines: [],
        ran: [],
      }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync" }),
      previous: null,
    });
    expect(result.attempt.beforeClock).toBe("2026-09-11T00:00:00.000Z");
    expect(result.attempt.afterClock).toBe("2026-09-12T03:00:00.000Z");
  });

  it("turns a thrown step into that attempt's own failure rather than letting it escape", async () => {
    const result = await runResync({
      blocker: null,
      deps: {
        now: () => "2026-09-12T04:00:00.000Z",
        readAsOf: () => ok(null),
        readClock: () => Promise.resolve(null),
        runVerb: () => Promise.reject(new Error("the dispatcher blew up")),
        takeRelayRecoveries: () => [],
        takeSignInWalls: () => [],
        takeWalkCollisions: () => [],
        takeWalkStops: () => [],
        writeOut: () => undefined,
      },
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync" }),
      previous: null,
    });
    expect(result.attempt.outcome).toBe("failed");
    expect(result.attempt.problems[0]).toContain("the dispatcher blew up");
  });

  it("prints the command it is about to run, so a pass is never silent about what it did", async () => {
    const lines: string[] = [];
    await runResync({
      blocker: null,
      deps: fakeDeps({ clocks: [null], exitCodes: [0], lines, ran: [] }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync" }),
      previous: null,
    });
    expect(lines).toEqual(["  slopweaver atlas clerk sync"]);
  });

  it("fails an atlas whose step exited 0 and moved the clock while its browser walk stopped part way", async () => {
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({
        clocks: ["2026-09-16T10:50:37.114Z", "2026-09-16T16:48:07.433Z"],
        exitCodes: [0],
        lines: [],
        ran: [],
        stops: [[], ["the browser session driving this walk is no longer usable: Target page has been closed"]],
      }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync" }),
      previous: null,
    });
    expect(result.attempt.exitCode).toBe(0);
    expect(result.attempt.outcome).toBe("failed");
    expect(result.attempt.problems).toEqual([
      "`slopweaver atlas clerk sync` exited 0, and its browser walk stopped part way: the browser session " +
        "driving this walk is no longer usable: Target page has been closed",
      "exited 0 with its browser walk stopped part way, so every page after the stop went unread whatever " +
        "the clock says — a partial walk is not a resync, and the slot stays due",
    ]);
    expect(result.state.lastSuccessAtIso).toBe(null);
  });

  // The other side of the case above, and the reason the two registers are separate. A drop the transport
  // REBUILT is a walk that reached its own end, so grading it the same way would reintroduce exactly the
  // refusal `relaySession.ts`'s reconnect exists to remove — a 251-page walk that lost its relay at 147,
  // rebuilt it and finished would still have its slot left due.
  it("passes an atlas whose browser walk lost its relay and rebuilt it, reporting the drop rather than failing on it", async () => {
    const lines: string[] = [];
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({
        clocks: ["2026-09-16T10:50:37.114Z", "2026-09-16T16:48:07.433Z"],
        exitCodes: [0],
        lines,
        ran: [],
        recoveries: [[], ["the relay dropped the call while it was in flight"]],
      }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas linear walk" }),
      previous: null,
    });
    expect(result.attempt.outcome).toBe("succeeded");
    expect(result.attempt.problems).toEqual([]);
    expect(lines).toContain(
      "    relay rebuilt mid-walk and the page was re-addressed: the relay dropped the call while it was in flight",
    );
  });

  it("does not charge an attempt with a recovery this process left behind before it started", async () => {
    const lines: string[] = [];
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({
        clocks: ["2026-09-11T00:00:00.000Z", "2026-09-12T03:00:00.000Z"],
        exitCodes: [0],
        lines,
        ran: [],
        recoveries: [["the relay detached from the browser"], []],
      }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync" }),
      previous: null,
    });
    expect(result.attempt.outcome).toBe("succeeded");
    expect(lines.filter((line) => line.includes("relay rebuilt mid-walk"))).toEqual([]);
  });

  it("stops a compound target whose first step's browser walk stopped, rather than walking the next one", async () => {
    const ran: string[][] = [];
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({
        clocks: ["2026-09-11T00:00:00.000Z", "2026-09-12T03:00:00.000Z"],
        exitCodes: [0, 0],
        lines: [],
        ran,
        stops: [[], ["no browser transport is attached: another walk holds the relay lease"]],
      }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync && slopweaver atlas clerk walk" }),
      previous: null,
    });
    expect(ran).toEqual([["node", "slopweaver", "atlas", "clerk", "sync", "--home", "/tmp/sandbox"]]);
    expect(result.attempt.outcome).toBe("failed");
  });

  it("does not charge an attempt with a stop this process left behind before it started", async () => {
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({
        clocks: ["2026-09-11T00:00:00.000Z", "2026-09-12T03:00:00.000Z"],
        exitCodes: [0],
        lines: [],
        ran: [],
        stops: [["the browser session driving this walk is no longer usable: closed an hour ago"], []],
      }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync" }),
      previous: null,
    });
    expect(result.attempt.outcome).toBe("succeeded");
    expect(result.attempt.problems).toEqual([]);
  });

  it("carries a caller-supplied blocker onto a failed attempt's state", async () => {
    const blocker = { findingSlug: "row", key: "session-gone", reason: "signed out", steps: ["sign in"] };
    const result = await runResync({
      blocker,
      deps: fakeDeps({ clocks: [null], exitCodes: [1], lines: [], ran: [] }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync" }),
      previous: null,
    });
    expect(result.state.blocker).toEqual(blocker);
  });

  it("records the origin a step's sign-in wall named, fails the attempt and stops before the next step", async () => {
    const ran: string[][] = [];
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({
        clocks: ["2026-09-11T00:00:00.000Z", "2026-09-12T03:00:00.000Z"],
        exitCodes: [0, 0],
        lines: [],
        ran,
        walls: [[], ["https://acme.trelica.app"]],
      }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync && slopweaver atlas clerk walk" }),
      previous: null,
    });
    expect(ran.length).toBe(1);
    expect(result.attempt.outcome).toBe("failed");
    expect(result.attempt.signInWall).toBe("https://acme.trelica.app");
    expect(result.attempt.problems[0]).toBe(
      "`slopweaver atlas clerk sync` reached https://acme.trelica.app's sign-in page instead of the page it " +
        "asked for — the owner signs in there in their work Chrome",
    );
  });

  it("records no sign-in wall on a failure that met none, nor for one left behind before it started", async () => {
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({
        clocks: [null],
        exitCodes: [1],
        lines: [],
        ran: [],
        walls: [["https://go.xero.com"], []],
      }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync" }),
      previous: null,
    });
    expect(result.attempt.outcome).toBe("failed");
    expect(Object.keys(result.attempt)).not.toContain("signInWall");
  });

  it("records the collision that kept a step's walk from starting, fails the attempt and stops there", async () => {
    const ran: string[][] = [];
    const collision =
      "another browser walk is driving the owner's Chrome, so the hex walk may not start: held by pid 99021";
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({
        clocks: ["2026-09-11T00:00:00.000Z", "2026-09-12T03:00:00.000Z"],
        collisions: [[], [collision]],
        exitCodes: [0, 0],
        lines: [],
        ran,
        stops: [[], [`no browser transport is attached: ${collision}`]],
      }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync && slopweaver atlas clerk walk" }),
      previous: null,
    });
    expect(ran.length).toBe(1);
    expect(result.attempt.outcome).toBe("failed");
    expect(result.attempt.relayCollision).toBe(collision);
    expect(Object.keys(result.attempt)).not.toContain("signInWall");
  });

  it("records no collision on a stop that was not one, nor for one left behind before it started", async () => {
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({
        clocks: [null],
        collisions: [["another browser walk is driving the owner's Chrome"], []],
        exitCodes: [0],
        lines: [],
        ran: [],
        stops: [[], ["the browser session driving this walk is no longer usable: Target page has been closed"]],
      }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync" }),
      previous: null,
    });
    expect(result.attempt.outcome).toBe("failed");
    expect(Object.keys(result.attempt)).not.toContain("relayCollision");
  });

  // Found in review: kept from any step, a collision the sync step got past would give back the slot of a walk
  // that then failed on its own account.
  it("records no collision for a step that got past one when a LATER step fails on its own", async () => {
    const ran: string[][] = [];
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({
        clocks: [null],
        collisions: [[], ["another browser walk is driving the owner's Chrome"], []],
        exitCodes: [0, 1],
        lines: [],
        ran,
      }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync && slopweaver atlas clerk walk" }),
      previous: null,
    });
    expect(ran.length).toBe(2);
    expect(result.attempt.outcome).toBe("failed");
    expect(Object.keys(result.attempt)).not.toContain("relayCollision");
  });

  // MEASURED: `resync-corpus-slack` met another process's slack refresh holding the slot.
  it("records the step that exited 4 on a corpus attempt whose refresh found its slot held", async () => {
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({ clocks: ["2026-10-07T16:00:00.000Z"], exitCodes: [4], lines: [], ran: [] }),
      home: "/tmp/sandbox",
      policy: slackPolicy(),
      previous: null,
    });
    expect(result.attempt.outcome).toBe("failed");
    expect(result.attempt.stepDeferred).toBe("slopweaver refresh --source slack --store");
  });

  it("records no deferred step on a step that failed outright", async () => {
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({ clocks: ["2026-10-07T16:00:00.000Z"], exitCodes: [1], lines: [], ran: [] }),
      home: "/tmp/sandbox",
      policy: slackPolicy(),
      previous: null,
    });
    expect(result.attempt.outcome).toBe("failed");
    expect(Object.keys(result.attempt)).not.toContain("stepDeferred");
  });

  it("stamps a success at the instant its target certified, not the instant the attempt finished", async () => {
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({
        asOf: ok("2026-09-11T05:00:00.000Z"),
        clocks: ["2026-09-11T00:00:00.000Z", "2026-09-12T03:00:00.000Z"],
        exitCodes: [0],
        lines: [],
        ran: [],
      }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync" }),
      previous: null,
    });
    expect(result.attempt.outcome).toBe("succeeded");
    expect(result.attempt.asOfIso).toBe("2026-09-11T05:00:00.000Z");
    expect(result.state.lastSuccessAtIso).toBe("2026-09-11T05:00:00.000Z");
  });

  it("fails a success whose target cannot say what it is current as of, naming why", async () => {
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({
        asOf: err([
          "chatgpt: no instant a sync certified … (it dates export 0123456789ab, which is not the newest held)",
        ]),
        clocks: ["2026-09-11T00:00:00.000Z", "2026-09-12T03:00:00.000Z"],
        exitCodes: [0],
        lines: [],
        ran: [],
      }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync" }),
      previous: { blocker: null, lastAttempt: null, lastSuccessAtIso: "2026-09-10T00:00:00.000Z", recipeId: "x" },
    });
    expect(result.attempt.outcome).toBe("failed");
    expect(result.attempt.problems).toEqual([
      "chatgpt: no instant a sync certified … (it dates export 0123456789ab, which is not the newest held)",
    ]);
    expect(result.state.lastSuccessAtIso).toBe("2026-09-10T00:00:00.000Z");
  });

  it("never asks a failed attempt what it is current as of", async () => {
    const result = await runResync({
      blocker: null,
      deps: fakeDeps({ asOf: err(["never read"]), clocks: [null], exitCodes: [1], lines: [], ran: [] }),
      home: "/tmp/sandbox",
      policy: atlasPolicy({ command: "slopweaver atlas clerk sync" }),
      previous: null,
    });
    expect(result.attempt.outcome).toBe("failed");
    expect(result.attempt.problems).not.toContain("never read");
    expect(Object.keys(result.attempt)).not.toContain("asOfIso");
  });
});

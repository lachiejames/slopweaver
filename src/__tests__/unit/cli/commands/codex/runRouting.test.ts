/**
 * Every Codex pass is admitted, THEN reserved and routed, THEN run, THEN released, and a review does all of it per
 * property when that property's own slot opens — `cli/commands/codex/passRoute.ts`, over the REAL reservation port
 * and routing read against a register in a throwaway home.
 *
 * Routing used to happen once per invocation, before the fan-out, so every property shared one client and a
 * duplicate still paid for a fleet read. What is held down here is the ORDER, which no test of either half
 * alone can see: one shared log records each acquire, each routed client the factory builds, each pass that runs
 * and each release, so the sequence itself is the assertion. The factory and the pass are plain fake functions
 * passed in — seams, not mocks.
 */
import { readFileSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import type { PassAdmit } from "../../../../../cli/commands/codex/admitFor.js";
import type { CodexDeps } from "../../../../../cli/commands/codex/passDeps.js";
import { admittedRoutedPass, fanOutAdmittedReview } from "../../../../../cli/commands/codex/passRoute.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import type { CodexAccountLive } from "../../../../../codex/accountLiveParse.js";
import { makePassBound } from "../../../../../codex/bounds.js";
import type { CodexClientFactory, LockedCodexClient, LockedCodexThread } from "../../../../../codex/client.js";
import type { CompletedPass } from "../../../../../codex/orchestrate.js";
import type { CodexPassReservationPort } from "../../../../../codex/passReservationStore.js";
import type { DeadlineRuntime } from "../../../../../codex/runPass.js";
import type { ReviewProperty } from "../../../../../codex/types.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import type { PlanRegisterPort } from "../../../../../plans/port.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import {
  loggingReservationPort,
  type ReservationRow,
  reservationHome,
  signedInLive,
  testReservationPort,
} from "../../../../codexPassReservationFixture.js";
import { memoryFallbackRegisterPort } from "../../../../fallbackRegisterFixture.js";
import { memorySupersessionPort } from "../../../../landingRegistersFixture.js";
import { memoryPlanRegisterPort, memoryPlanRegisterStore } from "../../../../planRegisterFixture.js";
import { planRecord } from "../../../codex/ledger/fixtures.js";

const roots: string[] = [];

const BOUND = unwrap(makePassBound({ boundSeconds: 600 }));
const MODEL = "gpt-5.6-sol";

/** A clock the routing never consults, present only because `CodexDeps` declares one. */
const RUNTIME: DeadlineRuntime = {
  nowIso: () => "2026-11-05T06:00:00.000Z",
  nowMs: () => 0,
  schedule: () => ({ cancel: () => {} }),
};

const PROPERTIES: readonly ReviewProperty[] = [
  { id: "r1-01", statement: "the first falsifiable claim" },
  { id: "r1-02", statement: "the second falsifiable claim" },
  { id: "r1-03", statement: "the third falsifiable claim" },
];

const ALLOWED: PassAdmit = () => ({ kind: "allowed", reason: "no conclusive duplicate on file" });

const DUPLICATE: PassAdmit = () => ({
  duplicate: planRecord({ pass: "p2", tree: undefined }),
  kind: "duplicate",
  refusal: ["codex plan blocked because an exact conclusive pass is already on file."],
});

/** A thread the fake client hands back. Nothing here starts one. */
function noThread(): LockedCodexThread {
  return {
    currentId: () => null,
    run: async () => {
      throw new Error("no thread is run in this test");
    },
  };
}

/** A home whose register carries `rows`, removed after the test. */
function homeWith({ rows }: { rows: readonly ReservationRow[] }): ReturnType<typeof reservationHome> {
  const made = reservationHome({ rows });
  roots.push(made.root);
  return made;
}

/** A factory that logs `route:<alias>` for every client it builds. */
function loggingFactory({ log }: { log: string[] }): CodexClientFactory {
  return ({ destination, model }) => {
    log.push(`route:${destination.alias}`);
    return ok({ model, resumeThread: () => noThread(), startThread: () => noThread() } satisfies LockedCodexClient);
  };
}

/**
 * Deps whose reservation port and client factory both log into the shared sequence.
 *
 * @param byHome each store's live answer, for a case on a usage-limited account
 * @param clientFor the factory, logging by default
 * @param registerPort where the register is read, so a case can count the store's connections
 * @param wrap wraps the logging port, for a case that watches acquires settle
 * @returns the deps
 */
function depsLogging({
  byHome = {},
  clientFor,
  log,
  registerPort = memoryPlanRegisterPort(),
  wrap = (port) => port,
}: {
  byHome?: Readonly<Record<string, CodexAccountLive>>;
  clientFor?: CodexClientFactory;
  log: string[];
  registerPort?: PlanRegisterPort;
  wrap?: (port: CodexPassReservationPort) => CodexPassReservationPort;
}): CodexDeps {
  const inner = testReservationPort({ byHome, registerPort });
  return {
    clientFor: factoryFor({ clientFor, log }),
    fallbackPort: memoryFallbackRegisterPort(),
    reservationPort: wrap(loggingReservationPort({ inner, log })),
    runtime: RUNTIME,
    supersessions: memorySupersessionPort(),
  };
}

/** The factory a case named, or the logging one when it named none. */
function factoryFor({
  clientFor,
  log,
}: {
  clientFor: CodexClientFactory | undefined;
  log: string[];
}): CodexClientFactory {
  if (clientFor !== undefined) {
    return clientFor;
  }
  return loggingFactory({ log });
}

/** A completed pass for the shared log, standing in for a real bounded pass. */
function loggedPass({ label, log }: { label: string; log: string[] }): Promise<CompletedPass> {
  log.push(`run:${label}`);
  return Promise.resolve({
    location: undefined,
    persistError: undefined,
    record: planRecord({ pass: "p2", tree: undefined }),
  });
}

afterEach(() => {
  roots.splice(0).forEach((root) => {
    rmSync(root, { force: true, recursive: true });
  });
});

describe("a planning pass is admitted before it is reserved and routed", () => {
  it("refuses a duplicate with no fleet read, no acquire, no client and no pass", async () => {
    const log: string[] = [];
    const store = memoryPlanRegisterStore();
    const deps = depsLogging({ log, registerPort: memoryPlanRegisterPort({ store }) });

    const invocation = await admittedRoutedPass({
      admit: DUPLICATE,
      route: { bound: BOUND, deps, home: homeWith({ rows: [{ alias: "plan-one" }] }).home, model: MODEL },
      run: () => loggedPass({ label: "p2", log }),
    });

    expect(invocation.kind).toBe("refused");
    expect(log).toEqual([]);
    expect(store.opened).toBe(0);
  });

  // The falsifier for the case above: the SAME home and deps, admitted, does acquire, route, run and release.
  it("acquires once, runs on that client, and releases once after the pass", async () => {
    const log: string[] = [];
    const deps = depsLogging({ log });

    const invocation = await admittedRoutedPass({
      admit: ALLOWED,
      route: { bound: BOUND, deps, home: homeWith({ rows: [{ alias: "plan-one" }] }).home, model: MODEL },
      run: () => loggedPass({ label: "p2", log }),
    });

    expect(invocation.kind).toBe("completed");
    expect(log).toEqual(["acquire", "route:plan-one", "run:p2", "release"]);
  });

  it("releases exactly once when the pass throws, and the throw still reaches the caller", async () => {
    const log: string[] = [];
    const deps = depsLogging({ log });

    const invocation = admittedRoutedPass({
      admit: ALLOWED,
      route: { bound: BOUND, deps, home: homeWith({ rows: [{ alias: "plan-one" }] }).home, model: MODEL },
      run: () => {
        log.push("run:p2");
        return Promise.reject(new Error("the pass blew up"));
      },
    });

    await expect(invocation).rejects.toThrow("the pass blew up");
    expect(log).toEqual(["acquire", "route:plan-one", "run:p2", "release"]);
  });

  it("releases, and runs nothing, when the factory refuses the routed client", async () => {
    const log: string[] = [];
    const clientFor: CodexClientFactory = ({ destination }) => {
      log.push(`route:${destination.alias}`);
      return err("a Codex thread launch blocked because cua_repl would start");
    };
    const deps = depsLogging({ clientFor, log });

    const invocation = await admittedRoutedPass({
      admit: ALLOWED,
      route: { bound: BOUND, deps, home: homeWith({ rows: [{ alias: "plan-one" }] }).home, model: MODEL },
      run: () => loggedPass({ label: "p2", log }),
    });

    expect(invocation).toEqual({ exitCode: EXIT_ERROR, kind: "unrouted" });
    expect(log).toEqual(["acquire", "route:plan-one", "release"]);
  });

  it("returns the routing refusal's exit code, and runs nothing, when the fleet cannot take an admitted plan", async () => {
    const log: string[] = [];
    const deps = depsLogging({ log });

    const invocation = await admittedRoutedPass({
      admit: ALLOWED,
      route: { bound: BOUND, deps, home: homeWith({ rows: [{ alias: "plan-one", paused: true }] }).home, model: MODEL },
      run: () => loggedPass({ label: "p2", log }),
    });

    expect(invocation).toEqual({ exitCode: EXIT_ERROR, kind: "unrouted" });
    expect(log).toEqual(["acquire"]);
  });

  /**
   * The checkout moved while the fleet read awaited: admission allowed HEAD A, and by the time the client
   * exists the tree the pass would freeze is HEAD B, already on file. The second ask refuses it before it runs,
   * and what the route reserved is still released.
   */
  it("refuses, after routing and before running, a plan that became a duplicate while the fleet was read", async () => {
    const log: string[] = [];
    const deps = depsLogging({ log });
    const answers = [ALLOWED, DUPLICATE];
    const asked: string[] = [];

    const invocation = await admittedRoutedPass({
      admit: () => {
        const admission = answers[asked.length]!();
        asked.push(admission.kind);
        return admission;
      },
      route: { bound: BOUND, deps, home: homeWith({ rows: [{ alias: "plan-one" }] }).home, model: MODEL },
      run: () => loggedPass({ label: "p2", log }),
    });

    expect(invocation.kind).toBe("refused");
    expect(asked).toEqual(["allowed", "duplicate"]);
    expect(log).toEqual(["acquire", "route:plan-one", "release"]);
  });
});

describe("a review reserves and routes each property when its own slot opens", () => {
  it("acquires three times for three admitted properties, each just before its own pass, in property order", async () => {
    const log: string[] = [];
    const deps = depsLogging({ log });

    const invocations = await fanOutAdmittedReview({
      admitOf: () => ALLOWED,
      concurrency: 1,
      properties: PROPERTIES,
      route: { bound: BOUND, deps, home: homeWith({ rows: [{ alias: "plan-one" }] }).home, model: MODEL },
      run: ({ property }) => loggedPass({ label: property.id, log }),
    });

    expect(invocations.map((invocation) => invocation.kind)).toEqual(["completed", "completed", "completed"]);
    expect(log).toEqual(
      ["r1-01", "r1-02", "r1-03"].flatMap((id) => ["acquire", "route:plan-one", `run:${id}`, "release"]),
    );
  });

  it("acquires nothing for a duplicate property while its admitted siblings acquire", async () => {
    const log: string[] = [];
    const deps = depsLogging({ log });

    const invocations = await fanOutAdmittedReview({
      admitOf: ({ property }) => (property.id === "r1-02" ? DUPLICATE : ALLOWED),
      concurrency: 1,
      properties: PROPERTIES,
      route: { bound: BOUND, deps, home: homeWith({ rows: [{ alias: "plan-one" }] }).home, model: MODEL },
      run: ({ property }) => loggedPass({ label: property.id, log }),
    });

    expect(invocations.map((invocation) => invocation.kind)).toEqual(["completed", "refused", "completed"]);
    expect(log).toEqual(["r1-01", "r1-03"].flatMap((id) => ["acquire", "route:plan-one", `run:${id}`, "release"]));
  });

  // The defect this PR closes: three properties released together on an account at 48% of a 50% limit used to all
  // read 48 and all spend. Every pass here waits until all three acquires have settled, so the first two genuinely
  // hold their points while the third asks — and the third is refused, the week never projected past 50.
  it("lets only as many concurrent properties through as the account's usage limit holds", async () => {
    const log: string[] = [];
    const { home, storeOf } = homeWith({ rows: [{ alias: "plan-one", usageLimitPercent: 50 }] });
    const store = storeOf["plan-one"]!;
    let settled = 0;
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const countSettled = (port: CodexPassReservationPort): CodexPassReservationPort => ({
      acquire: async (request) => {
        const route = await port.acquire(request);
        settled += 1;
        if (settled === PROPERTIES.length) {
          openGate();
        }
        return route;
      },
    });
    const byHome = { [store]: signedInLive({ accountId: "acct-one", codexHome: store, weeklyPercent: 48 }) };
    const deps = depsLogging({ byHome, log, wrap: countSettled });

    const invocations = await fanOutAdmittedReview({
      admitOf: () => ALLOWED,
      concurrency: 3,
      properties: PROPERTIES,
      route: { bound: BOUND, deps, home, model: MODEL },
      run: async ({ property }) => {
        const pass = await loggedPass({ label: property.id, log });
        await gate;
        return pass;
      },
    });

    expect(invocations.map((invocation) => invocation.kind).toSorted()).toEqual(["completed", "completed", "unrouted"]);
    expect(log.filter((line) => line.startsWith("run:"))).toHaveLength(2);
    expect(log.filter((line) => line === "release")).toHaveLength(2);
    const path = stateHomePaths({ home }).live.codexPassReservationsJson;
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ reservations: [], schemaVersion: 1 });
  });
});

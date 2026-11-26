/**
 * `withLapCleanup` over the lap fixture's fakes: every resource the lap brings up is registered as it comes up, so a
 * signal's drain disposes the ones still standing, newest first and once; and once the drain has begun the lap
 * mints no new tree and runs no new step.
 */
import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { createLapCleanupRegistry } from "../../../../../cli/commands/github/lapCleanup.js";
import { withLapCleanup } from "../../../../../cli/commands/github/lapCleanupDeps.js";
import { lapPlan } from "../../../../../cli/commands/github/lapCore.js";
import { LapErrors } from "../../../../../cli/commands/github/lapErrors.js";
import { err, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { depsFor, observe, takeLapHomes } from "../../../../lapRunFixture.js";

afterEach(() => {
  for (const home of takeLapHomes()) {
    rmSync(home, { force: true, recursive: true });
  }
});

const LOCK = { phase: "running", pid: 4242, startedIso: "2026-11-26T00:00:00.000Z", subject: "pr-1" } as const;

describe("withLapCleanup", () => {
  it("drains every resource still up, newest first", async () => {
    const observed = observe();
    const cleanup = createLapCleanupRegistry();
    const deps = withLapCleanup({ cleanup, deps: depsFor({ observed }) });
    unwrap(deps.acquireLock({ home: "/home", lock: LOCK }));
    unwrap(await deps.checkout({ sha: "abc" }));
    deps.laneHome();
    unwrap(await deps.startStore({ register: ({ dispose }) => dispose }));

    expect(await cleanup.drain()).toEqual([]);
    expect(observed.disposed).toEqual(["store", "lane-home", "tree", "lock"]);
  });

  it("removes a store a signal caught mid-start, before it was ready, and only once", async () => {
    const observed = observe();
    const cleanup = createLapCleanupRegistry();
    let ready: () => void = () => undefined;
    let removals = 0;
    const base = depsFor({ observed });
    const deps = withLapCleanup({
      cleanup,
      deps: {
        ...base,
        startStore: async ({ register }) => {
          const dispose = register({
            dispose: () => {
              removals += 1;
              return Promise.resolve();
            },
          });
          await new Promise<void>((done) => {
            ready = done;
          });
          await dispose();
          return err(LapErrors.storeUnavailable({ why: "never accepted connections" }));
        },
      },
    });
    const starting = deps.startStore({ register: ({ dispose }) => dispose });

    await cleanup.drain();
    expect(removals).toBe(1);
    ready();
    expect(unwrapErr(await starting).message).toContain("never accepted connections");
    expect(removals).toBe(1);
  });

  it("hands the loop back before a step, so a drain waiting on the loop starts first and the step never runs", async () => {
    const observed = observe();
    const cleanup = createLapCleanupRegistry();
    const deps = withLapCleanup({ cleanup, deps: depsFor({ observed }) });
    setImmediate(() => {
      void cleanup.drain();
    });

    const outcome = await deps.runStep({ env: {}, logDir: "/logs", step: lapPlan()[0]!, tree: "/tree" });
    expect(outcome.exitCode).toBe(128);
    expect(observed.ran).toEqual([]);
  });

  it("starts no store once the drain has begun", async () => {
    const cleanup = createLapCleanupRegistry();
    const deps = withLapCleanup({ cleanup, deps: depsFor({ observed: observe() }) });
    await cleanup.drain();

    expect(unwrapErr(await deps.startStore({ register: ({ dispose }) => dispose })).message).toBe(
      "the lap is stopping on a signal, so it brings nothing new up",
    );
  });

  it("leaves the drain nothing to redo for a tree its owner's finally already removed", async () => {
    const observed = observe();
    const cleanup = createLapCleanupRegistry();
    const deps = withLapCleanup({ cleanup, deps: depsFor({ observed }) });
    const tree = unwrap(await deps.checkout({ sha: "abc" }));
    await tree.dispose();

    await cleanup.drain();
    await tree.dispose();
    expect(observed.disposed).toEqual(["tree"]);
  });

  it("refuses a new tree and answers a new step red, unrun, once the drain has begun", async () => {
    const observed = observe();
    const cleanup = createLapCleanupRegistry();
    const deps = withLapCleanup({ cleanup, deps: depsFor({ observed }) });
    await cleanup.drain();

    expect(unwrapErr(await deps.checkout({ sha: "abc" })).message).toBe(
      "the lap is stopping on a signal, so it brings nothing new up",
    );
    const step = lapPlan()[0]!;
    const outcome = await deps.runStep({ env: {}, logDir: "/logs", step, tree: "/tree" });
    expect(outcome.exitCode).toBe(128);
    expect(observed.ran).toEqual([]);
    expect(observed.disposed).toEqual([]);
  });
});

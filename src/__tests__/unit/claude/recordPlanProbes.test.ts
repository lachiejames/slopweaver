/**
 * `recordPlanProbes` over the REAL port and register orchestration, the database alone swapped for memory
 * (`../../claudePlanProbesFixture.ts`): what a sweep writes, what it keeps out, and what an outage says.
 */
import { describe, expect, it } from "vitest";

import { ClaudeRotationErrors } from "../../../claude/errors.js";
import { type ClaudePlanProbesPort, claudePlanProbesDomainSeams } from "../../../claude/planProbes.js";
import { claudePlanProbesPortOver } from "../../../claude/planProbesStore.js";
import { recordableProbes, recordPlanProbes } from "../../../claude/recordPlanProbes.js";
import { err, ok, unwrap } from "../../../lib/result.js";
import { singletonRegister } from "../../../store/singletonRegister.js";
import { memoryClaudePlanProbesPort, unavailableClaudePlanProbesPort } from "../../claudePlanProbesFixture.js";
import { memorySingletonRegisterSeams, memorySingletonStore } from "../../singletonRegisterFixture.js";

const HOME = "/home/fixture";
const T1 = "2026-11-03T06:18:01.000Z";
const T2 = "2026-11-03T06:28:10.000Z";
const SIGNED_OUT = err(ClaudeRotationErrors.storeNotReady({ alias: "plan-two" }));

describe("recordPlanProbes", () => {
  it("records each plan's verdict at the sweep's instant, a missing store as STORE_MISSING", async () => {
    const port = memoryClaudePlanProbesPort();
    const lines = await recordPlanProbes({
      home: HOME,
      nowIso: T1,
      port,
      probes: [
        { alias: "plan-one", reading: ok({}), storeDir: "/s/one" },
        { alias: "plan-two", reading: SIGNED_OUT, storeDir: "/s/two" },
        { alias: "plan-three", reading: ok({}), storeDir: "/s/gone" },
      ],
      storeExists: (path) => path !== "/s/gone",
    });
    const records = unwrap(await port.read({ home: HOME }));
    expect([lines, records.map((record) => [record.alias, record.latest, record.fault?.code])]).toEqual([
      [],
      [
        ["plan-one", "ok", undefined],
        ["plan-three", "fault", "STORE_MISSING"],
        ["plan-two", "fault", "STORE_NOT_READY"],
      ],
    ]);
  });

  it("keeps out a sweep older than the one already recorded, and says so", async () => {
    const port = memoryClaudePlanProbesPort();
    const probes = [{ alias: "plan-two", reading: SIGNED_OUT, storeDir: "/s/two" }];
    await recordPlanProbes({ home: HOME, nowIso: T2, port, probes, storeExists: () => true });
    const lines = await recordPlanProbes({ home: HOME, nowIso: T1, port, probes, storeExists: () => true });
    expect(lines).toEqual([`a probe was not recorded: a probe at ${T2} is already recorded for plan-two`]);
  });

  it("says no note can follow when the store cannot be opened, and fails nothing else", async () => {
    const lines = await recordPlanProbes({
      home: HOME,
      nowIso: T1,
      port: unavailableClaudePlanProbesPort(),
      probes: [{ alias: "plan-two", reading: SIGNED_OUT, storeDir: "/s/two" }],
      storeExists: () => true,
    });
    expect([lines.length, lines[0]!.startsWith("the plans' probes were not recorded, so no plan-fault note")]).toEqual([
      1,
      true,
    ]);
  });

  it("records a later ok whose first write lost the race to the other writer's fault", async () => {
    const store = memorySingletonStore();
    const gauge = memoryClaudePlanProbesPort({ store });
    const real = singletonRegister({
      seams: memorySingletonRegisterSeams({ ...claudePlanProbesDomainSeams(), store }),
    });
    let raced = false;
    // The gauge's still-failing probe lands between the watch's read and its compare-and-set, once.
    const racing: typeof real = {
      ...real,
      compareAndSet: async (request) => {
        if (!raced) {
          raced = true;
          await recordPlanProbes({
            home: HOME,
            nowIso: T1,
            port: gauge,
            probes: [{ alias: "plan-two", reading: SIGNED_OUT, storeDir: "/s/two" }],
            storeExists: () => true,
          });
        }
        return real.compareAndSet(request);
      },
    };
    const watch = claudePlanProbesPortOver({ register: racing });
    const lines = await recordPlanProbes({
      home: HOME,
      nowIso: T2,
      port: watch,
      probes: [{ alias: "plan-two", reading: ok({}), storeDir: "/s/two" }],
      storeExists: () => true,
    });
    const records = unwrap(await gauge.read({ home: HOME }));
    expect([raced, lines, records.map((record) => [record.alias, record.latest, record.observedAtIso])]).toEqual([
      true,
      [],
      [["plan-two", "ok", T2]],
    ]);
  });

  it("gives the conflict back after losing every bounded attempt, writing nothing of its own", async () => {
    const store = memorySingletonStore();
    const racer = memoryClaudePlanProbesPort({ store });
    const real = singletonRegister({
      seams: memorySingletonRegisterSeams({ ...claudePlanProbesDomainSeams(), store }),
    });
    const racedAt: string[] = [];
    // Concurrent spawns' gates: one lands between EVERY read and compare-and-set this writer makes.
    const racing: typeof real = {
      ...real,
      compareAndSet: async (request) => {
        const nowIso = `2026-11-03T06:2${String(racedAt.length)}:00.000Z`;
        racedAt.push(nowIso);
        await recordPlanProbes({
          home: HOME,
          nowIso,
          port: racer,
          probes: [{ alias: "plan-one", reading: ok({}), storeDir: "/s/one" }],
          storeExists: () => true,
        });
        return real.compareAndSet(request);
      },
    };
    const lines = await recordPlanProbes({
      home: HOME,
      nowIso: T2,
      port: claudePlanProbesPortOver({ register: racing }),
      probes: [{ alias: "plan-two", reading: ok({}), storeDir: "/s/two" }],
      storeExists: () => true,
    });
    const records = unwrap(await racer.read({ home: HOME }));
    expect([racedAt.length, lines.length, records.map((record) => record.alias)]).toEqual([3, 1, ["plan-one"]]);
    expect(lines[0]).toContain("another verb recorded Claude plan probes while this one was");
  });

  it("answers a port that rejects, or throws before returning, as a diagnostic rather than a failure", async () => {
    const rejecting: ClaudePlanProbesPort = {
      read: async () => ok([]),
      record: () => Promise.reject(new Error("store crashed")),
    };
    const throwing: ClaudePlanProbesPort = {
      read: async () => ok([]),
      record: () => {
        throw new Error("port defect");
      },
    };
    const sweep = { home: HOME, nowIso: T1, probes: [{ alias: "plan-two", reading: SIGNED_OUT, storeDir: "/s/two" }] };
    const said = [
      await recordPlanProbes({ ...sweep, port: rejecting, storeExists: () => true }),
      await recordPlanProbes({ ...sweep, port: throwing, storeExists: () => true }),
    ];
    const notRecorded = "the plans' probes were not recorded, so no plan-fault note can follow this sweep";
    expect(said).toEqual([
      [`${notRecorded}: the record call threw (store crashed)`],
      [`${notRecorded}: the record call threw (port defect)`],
    ]);
  });

  it("does nothing for a sweep with no plans", async () => {
    expect(
      await recordPlanProbes({ home: HOME, nowIso: T1, port: unavailableClaudePlanProbesPort(), probes: [] }),
    ).toEqual([]);
  });
});

describe("recordableProbes", () => {
  it("drops a named probe of a paused plan and one no longer configured, keeping the sweep's order", () => {
    const kept = recordableProbes({
      accounts: [
        { alias: "plan-one" },
        { alias: "plan-two", paused: { reason: "the subscription lapsed", sinceIso: T1 } },
        { alias: "plan-three" },
      ],
      probes: [
        { alias: "plan-three", reading: ok({}), storeDir: "/s/three" },
        { alias: "plan-two", reading: SIGNED_OUT, storeDir: "/s/two" },
        { alias: "plan-gone", reading: SIGNED_OUT, storeDir: "/s/gone" },
        { alias: "plan-one", reading: ok({}), storeDir: "/s/one" },
      ],
    });
    expect(kept.map((probe) => probe.alias)).toEqual(["plan-three", "plan-one"]);
  });

  it("records nothing when every plan is paused", () => {
    expect(
      recordableProbes({
        accounts: [{ alias: "plan-two", paused: { reason: "lapsed", sinceIso: T1 } }],
        probes: [{ alias: "plan-two", reading: SIGNED_OUT, storeDir: "/s/two" }],
      }),
    ).toEqual([]);
  });
});

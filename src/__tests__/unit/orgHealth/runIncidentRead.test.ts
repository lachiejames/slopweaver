import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { evaluateOrgHealth } from "../../../monitor/orgHealth.js";
import { OrgHealthErrors } from "../../../orgHealth/errors.js";
import { READ_DEADLINE_MS, READ_LOCK_STALE_MS } from "../../../orgHealth/policy.js";
import type { OrgHealthPort } from "../../../orgHealth/port.js";
import { type IncidentReadApi, runIncidentRead } from "../../../orgHealth/read.js";
import { takeReadLock } from "../../../orgHealth/readLock.js";
import type { MeasuredIncidentSnapshot } from "../../../orgHealth/types.js";
import {
  type MemoryOrgHealthStore,
  memoryOrgHealthPort,
  memoryOrgHealthStore,
  seedOrgHealthSightings,
  unavailableOrgHealthPort,
} from "../../orgHealthStoreFixture.js";
import { announcement, update } from "./incidentIoFixtures.js";
import { DECLARATION_DAY_MS, FIXING, FIXING_THREAD, fakeApi, NEVER, STILL } from "./incidentReadFixture.js";
import { NOW_MS } from "./orgIncidentFixture.js";

describe("runIncidentRead", () => {
  let home: string;
  let store: MemoryOrgHealthStore;
  let port: OrgHealthPort;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "org-health-read-"));
    store = memoryOrgHealthStore();
    port = memoryOrgHealthPort({ store });
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** One read of INC-98 at `nowMs`, over the real lock and this test's store. */
  const readFixing = async ({ nowMs }: { nowMs: number }) => {
    const fake = fakeApi({ history: [FIXING], threads: { [String(FIXING["ts"])]: FIXING_THREAD } });
    return runIncidentRead({
      clock: STILL,
      elapsed: STILL,
      home,
      nowMs,
      port,
      source: ok({ api: fake.api, channelId: "C0SYNINCIDENTS" }),
      takeLock: takeReadLock,
      wait: NEVER,
    });
  };

  it("publishes the measured snapshot a complete read built", async () => {
    unwrap(await readFixing({ nowMs: NOW_MS }));
    expect(unwrap(await port.readSnapshot({ home }))).toMatchObject({
      announcementCount: 1,
      channelId: "C0SYNINCIDENTS",
      incidents: [{ phase: "identified", ref: "INC-98" }],
      state: "measured",
    });
  });

  it("publishes unmeasurable naming why when there is no channel to read, replacing a success before it", async () => {
    unwrap(await readFixing({ nowMs: NOW_MS }));
    const failure = unwrapErr(
      await runIncidentRead({
        clock: STILL,
        elapsed: STILL,
        home,
        nowMs: NOW_MS,
        port,
        source: err(OrgHealthErrors.configAbsent({ path: "/home/profile.json" })),
        takeLock: takeReadLock,
        wait: NEVER,
      }),
    );
    expect(failure.code).toBe("CONFIG_ABSENT");
    expect(unwrap(await port.readSnapshot({ home }))).toEqual({
      attemptedIso: "2026-10-04T09:00:00.000Z",
      because: failure.message,
      schemaVersion: 1,
      state: "unmeasurable",
    });
  });

  it("pages through the real read: new at the read that first saw it, the same key through a phase move, a new one on a severity change", async () => {
    // INC-1 declared at 08:00. INC-2 declared at 06:00, a same-phase update at 07:00, then at 09:00 its root is
    // edited to Fixing with no moving update, and at 09:45 re-graded Major.
    const inc1 = announcement({ number: 1, ts: "1791100800.000100" });
    const inc2Thread = [update({ number: 2, to: "Investigating", ts: "1791097200.000001", words: "Looking." })];
    const inc2 = ({ status, editedTs, severity }: { status: string; editedTs?: string; severity?: string }) =>
      announcement({
        number: 2,
        status,
        ts: "1791093600.000200",
        ...(editedTs === undefined ? {} : { editedTs }),
        ...(severity === undefined ? {} : { severity }),
      });
    const readAt = async ({ minutes, root2 }: { minutes: number; root2: Record<string, unknown> }) => {
      const fake = fakeApi({
        history: [inc1, root2],
        threads: { "1791093600.000200": [root2, ...inc2Thread], "1791100800.000100": [inc1] },
      });
      const nowMs = NOW_MS + minutes * 60_000;
      unwrap(
        await runIncidentRead({
          clock: STILL,
          elapsed: STILL,
          home,
          nowMs,
          port,
          source: ok({ api: fake.api, channelId: "C0SYNINCIDENTS" }),
          takeLock: takeReadLock,
          wait: NEVER,
        }),
      );
      const snapshot = await port.readSnapshot({ home });
      const reading = evaluateOrgHealth({ dismissed: new Set(), nowMs, open: new Set(), shown: new Set(), snapshot });
      const measured = unwrap(snapshot) as MeasuredIncidentSnapshot;
      return [
        (reading as Extract<typeof reading, { state: "firing" }>).subjects[0]!.key,
        measured.incidents.find((incident) => incident.ref === "INC-2")!.phaseChangedIso,
      ];
    };
    // A memory that exists, so neither is a seeding read's. Both are new at the first read, which dates both pages;
    // the higher ref heads the tie.
    seedOrgHealthSightings({ home, sightings: {}, store });
    expect(await readAt({ minutes: -30, root2: inc2({ status: "Investigating" }) })).toEqual([
      "inc2-critical-20261004083000000",
      "2026-10-04T06:00:00.000Z",
    ]);
    const moved = inc2({ editedTs: "1791104400.000000", status: "Fixing" });
    expect(await readAt({ minutes: 5, root2: moved })).toEqual([
      "inc2-critical-20261004083000000",
      "2026-10-04T09:00:00.000Z",
    ]);
    const regraded = inc2({ editedTs: "1791107100.000000", severity: "Major", status: "Fixing" });
    expect(await readAt({ minutes: 50, root2: regraded })).toEqual([
      "inc2-major-20261004095000000",
      "2026-10-04T09:00:00.000Z",
    ]);
  });

  it("never pages an incident again when its sightings were lost after its page was shown", async () => {
    const readThenJudge = async ({
      minutes,
      shown,
      open,
    }: {
      minutes: number;
      shown: ReadonlySet<string>;
      open: ReadonlySet<string>;
    }) => {
      const nowMs = DECLARATION_DAY_MS + minutes * 60_000;
      unwrap(await readFixing({ nowMs }));
      return evaluateOrgHealth({
        dismissed: new Set(),
        nowMs,
        open,
        shown,
        snapshot: await port.readSnapshot({ home }),
      });
    };
    seedOrgHealthSightings({ home, sightings: {}, store });
    const paged = await readThenJudge({ minutes: 0, open: new Set(), shown: new Set() });
    const key = (paged as Extract<typeof paged, { state: "firing" }>).subjects[0]!.key;
    expect(key).toBe("inc98-critical-20260923090000000");
    store.homes.get(home)!.sightings = undefined;
    // Whether the card is still up or already taken down, the same start is not paged again.
    expect([
      (await readThenJudge({ minutes: 60, open: new Set([key]), shown: new Set() })).state,
      (await readThenJudge({ minutes: 75, open: new Set(), shown: new Set([key]) })).state,
    ]).toEqual(["clear", "clear"]);
  });

  it("never floats an incident first seen open eleven days after it was declared as new", async () => {
    seedOrgHealthSightings({ home, sightings: {}, store });
    unwrap(await readFixing({ nowMs: NOW_MS }));
    const snapshot = await port.readSnapshot({ home });
    const read = unwrap(snapshot) as MeasuredIncidentSnapshot;
    expect(read.state).toBe("measured");
    expect(read.incidents.map((one) => [one.ref, one.declaredIso, one.loud])).toEqual([
      ["INC-98", "2026-09-23T01:17:25.000Z", undefined],
    ]);
    expect(
      evaluateOrgHealth({ dismissed: new Set(), nowMs: NOW_MS, open: new Set(), shown: new Set(), snapshot }),
    ).toEqual({ monitorId: "org-health", state: "clear" });
  });

  it("leaves the sightings alone when a read fails, so it moves no instant", async () => {
    unwrap(await readFixing({ nowMs: DECLARATION_DAY_MS }));
    const before = unwrap(await port.readSightings({ home }));
    const failing = fakeApi({ history: new Error("ratelimited") });
    unwrapErr(
      await runIncidentRead({
        clock: STILL,
        elapsed: STILL,
        home,
        nowMs: DECLARATION_DAY_MS,
        port,
        source: ok({ api: failing.api, channelId: "C0SYNINCIDENTS" }),
        takeLock: takeReadLock,
        wait: NEVER,
      }),
    );
    // The first read on a home seeds the memory, so INC-98's page is dated by its declaration.
    expect(before).toEqual({
      "INC-98": {
        loud: { iso: "2026-09-23T01:17:25.000Z", kind: "new" },
        phase: "identified",
        severity: "Critical",
        sinceIso: "2026-09-23T04:33:57.000Z",
      },
    });
    expect(unwrap(await port.readSightings({ home }))).toEqual(before);
  });

  it("marks unmeasurable while another read holds the lock, and fences the holder so it can never land last", async () => {
    let release: (messages: readonly unknown[]) => void = () => undefined;
    const slow: IncidentReadApi = {
      history: () => Promise.resolve({ hasMore: false, messages: [FIXING] }),
      replies: () =>
        new Promise((resolve) => {
          release = (messages) => {
            resolve({ hasMore: false, messages });
          };
        }),
    };
    const first = runIncidentRead({
      clock: STILL,
      elapsed: STILL,
      home,
      nowMs: NOW_MS,
      port,
      source: ok({ api: slow, channelId: "C0SYNINCIDENTS" }),
      takeLock: takeReadLock,
      wait: NEVER,
    });
    await new Promise((resolve) => setImmediate(resolve));
    const later = fakeApi({ history: new Error("never asked") });
    const refused = unwrapErr(
      await runIncidentRead({
        clock: STILL,
        elapsed: STILL,
        home,
        // A replayed `--now` past the lock's staleness: the holder's lease is judged by the wall clock, so it holds.
        nowMs: NOW_MS + READ_LOCK_STALE_MS + 60_000,
        port,
        source: ok({ api: later.api, channelId: "C0SYNINCIDENTS" }),
        takeLock: takeReadLock,
        wait: NEVER,
      }),
    );
    expect([refused.code, later.historyCalls]).toEqual(["READ_UNDER_WAY", []]);
    release(FIXING_THREAD);
    // The refused read's marker moved the generation, so the holder's measured outcome is refused, not landed last.
    expect(unwrapErr(await first).code).toBe("REVISION_CONFLICT");
    expect(unwrap(await port.readSnapshot({ home }))).toMatchObject({
      attemptedIso: "2026-10-04T09:06:00.000Z",
      because: expect.stringContaining("a read is under way"),
      state: "unmeasurable",
    });
    unwrap(await readFixing({ nowMs: NOW_MS }));
    expect(unwrap(await port.readSnapshot({ home }))).toMatchObject({ state: "measured" });
  });

  it("never leaves the last success current when a holder took the lock and has not marked yet", async () => {
    unwrap(await readFixing({ nowMs: NOW_MS }));
    const held = unwrap(takeReadLock({ home, nowIso: "2026-10-04T09:00:00.000Z" }));
    const refused = unwrapErr(await readFixing({ nowMs: NOW_MS + 60_000 }));
    held.release();
    expect([refused.code, unwrap(await port.readSnapshot({ home }))]).toEqual([
      "READ_UNDER_WAY",
      expect.objectContaining({ attemptedIso: "2026-10-04T09:01:00.000Z", state: "unmeasurable" }),
    ]);
  });

  it("marks unmeasurable when the read lock cannot be taken at all, never leaving the last success current", async () => {
    unwrap(await readFixing({ nowMs: NOW_MS }));
    const fake = fakeApi({ history: [FIXING], threads: { [String(FIXING["ts"])]: FIXING_THREAD } });
    const refused = unwrapErr(
      await runIncidentRead({
        clock: STILL,
        elapsed: STILL,
        home,
        nowMs: NOW_MS + 60_000,
        port,
        source: ok({ api: fake.api, channelId: "C0SYNINCIDENTS" }),
        takeLock: () => err(OrgHealthErrors.readLockUnavailable({ detail: "the runtime directory is unavailable" })),
        wait: NEVER,
      }),
    );
    expect([refused.code, fake.historyCalls, unwrap(await port.readSnapshot({ home }))]).toEqual([
      "READ_LOCK_UNAVAILABLE",
      [],
      expect.objectContaining({
        because: expect.stringContaining("the read lock could not be taken"),
        state: "unmeasurable",
      }),
    ]);
  });

  it("keeps its deadline by the monotonic clock while the wall clock steps backward", async () => {
    let wall = NOW_MS;
    let monotonic = 0;
    const fake = fakeApi({ history: [FIXING], threads: { [String(FIXING["ts"])]: FIXING_THREAD } });
    const slow: IncidentReadApi = {
      history: async (args) => {
        const page = await fake.api.history(args);
        monotonic += READ_DEADLINE_MS + 1;
        wall -= 120_000;
        return page;
      },
      replies: fake.api.replies,
    };
    const error = unwrapErr(
      await runIncidentRead({
        clock: () => wall,
        elapsed: () => monotonic,
        home,
        nowMs: NOW_MS,
        port,
        source: ok({ api: slow, channelId: "C0SYNINCIDENTS" }),
        takeLock: takeReadLock,
        wait: NEVER,
      }),
    );
    expect([error.code, fake.repliesAsked]).toEqual(["DEADLINE_PASSED", []]);
  });

  it("refuses STORE_UNAVAILABLE before asking Slack anything when the store is down", async () => {
    const fake = fakeApi({ history: [FIXING], threads: { [String(FIXING["ts"])]: FIXING_THREAD } });
    const refused = unwrapErr(
      await runIncidentRead({
        clock: STILL,
        elapsed: STILL,
        home,
        nowMs: NOW_MS,
        port: unavailableOrgHealthPort(),
        source: ok({ api: fake.api, channelId: "C0SYNINCIDENTS" }),
        takeLock: takeReadLock,
        wait: NEVER,
      }),
    );
    expect([refused.code, fake.historyCalls]).toEqual(["STORE_UNAVAILABLE", []]);
  });

  it("leaves the marker and the sightings as they were when the measured publication fails mid-transaction", async () => {
    unwrap(await readFixing({ nowMs: DECLARATION_DAY_MS }));
    const sightings = unwrap(await port.readSightings({ home }));
    store.failNextPublish = true;
    const refused = unwrapErr(await readFixing({ nowMs: DECLARATION_DAY_MS + 60_000 }));
    expect([
      refused.code,
      unwrap(await port.readSnapshot({ home })),
      unwrap(await port.readSightings({ home })),
    ]).toEqual([
      "STORE_UNAVAILABLE",
      expect.objectContaining({ attemptedIso: "2026-09-23T09:01:00.000Z", state: "unmeasurable" }),
      sightings,
    ]);
  });

  it("publishes unmeasurable naming the read that failed", async () => {
    const fake = fakeApi({ history: new Error("ratelimited") });
    const failure = unwrapErr(
      await runIncidentRead({
        clock: STILL,
        elapsed: STILL,
        home,
        nowMs: NOW_MS,
        port,
        source: ok({ api: fake.api, channelId: "C0SYNINCIDENTS" }),
        takeLock: takeReadLock,
        wait: NEVER,
      }),
    );
    expect(unwrap(await port.readSnapshot({ home }))).toEqual({
      attemptedIso: "2026-10-04T09:00:00.000Z",
      because: failure.message,
      schemaVersion: 1,
      state: "unmeasurable",
    });
    expect(failure.message).toContain("ratelimited");
  });
});

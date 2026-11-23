// The read's file-store cases left with the file store; their store-backed successors are `runIncidentRead.test.ts`.
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { READ_DEADLINE_MS } from "../../../orgHealth/policy.js";
import { type IncidentReadApi, readOrgIncidents } from "../../../orgHealth/read.js";
import { announcement, update, WEEKLY_REPORT } from "./incidentIoFixtures.js";
import { FIXING, FIXING_THREAD, fakeApi, NEVER, STILL } from "./incidentReadFixture.js";
import { NOW_MS } from "./orgIncidentFixture.js";

/** INC-70, closed two months before NOW and never touched since. */
const LONG_CLOSED = announcement({ number: 70, status: "Closed", ts: "1785920400.000100" });

describe("readOrgIncidents", () => {
  it("refuses a thread whose root was edited between two of its replies pages, each page repeating the root", async () => {
    const before = announcement({ status: "Investigating" });
    const after = announcement({ editedTs: "1790138100.000000", severity: "Minor", status: "Fixing" });
    const moved = update({ from: "Investigating", to: "Fixing", ts: "1790138037.887319" });
    const api: IncidentReadApi = {
      history: () => Promise.resolve({ hasMore: false, messages: [before] }),
      replies: (args) =>
        Promise.resolve(
          args.cursor === undefined
            ? { hasMore: true, messages: [before], nextCursor: "page-2" }
            : { hasMore: false, messages: [after, moved] },
        ),
    };
    const error = unwrapErr(
      await readOrgIncidents({
        api,
        channelId: "C0SYNINCIDENTS",
        clock: STILL,
        nowMs: NOW_MS,
        previous: {},
        wait: NEVER,
      }),
    );
    expect([error.code, error.message]).toEqual([
      "ROOT_MOVED",
      "INC-98's announcement no longer matches between the channel read and its thread read (its status, severity moved) — the next read sees one state",
    ]);
  });

  it("refuses a thread whose second replies page exhausts its cursor without repeating the root", async () => {
    const root = announcement({ status: "Investigating" });
    const api: IncidentReadApi = {
      history: () => Promise.resolve({ hasMore: false, messages: [root] }),
      replies: (args) =>
        Promise.resolve(
          args.cursor === undefined
            ? { hasMore: true, messages: [root], nextCursor: "page-2" }
            : {
                hasMore: false,
                messages: [update({ from: "Investigating", to: "Monitoring", ts: "1790138037.887319" })],
              },
        ),
    };
    const error = unwrapErr(
      await readOrgIncidents({
        api,
        channelId: "C0SYNINCIDENTS",
        clock: STILL,
        nowMs: NOW_MS,
        previous: {},
        wait: NEVER,
      }),
    );
    expect(error.message).toContain("(page 2 of the thread read did not return the announcement)");
  });

  it("reads the channel from its first message with metadata, and opens only the threads still worth showing", async () => {
    const fake = fakeApi({
      history: [FIXING, WEEKLY_REPORT, LONG_CLOSED],
      threads: { [String(FIXING["ts"])]: FIXING_THREAD },
    });
    const read = unwrap(
      await readOrgIncidents({
        api: fake.api,
        channelId: "C0SYNINCIDENTS",
        clock: STILL,
        wait: NEVER,
        nowMs: NOW_MS,
        previous: {},
      }),
    );
    expect(fake.historyCalls).toEqual([{ includeAllMetadata: true, oldest: "0" }]);
    expect(fake.repliesAsked).toEqual(["1790126245.320409"]);
    expect([read.historyPages, read.threadsOpened, read.snapshot.announcementCount]).toEqual([1, 1, 2]);
    expect(read.snapshot.readIso).toBe("2026-10-04T09:00:00.000Z");
    expect(read.snapshot.incidents.map((one) => [one.ref, one.phase, one.phaseChangedIso])).toEqual([
      ["INC-98", "identified", "2026-09-23T04:33:57.000Z"],
    ]);
  });

  it("refuses before opening a thread when more are open than a tick affords", async () => {
    const roots = Array.from({ length: 11 }, (_, index) =>
      announcement({ number: 40 + index, ts: `${String(1790126245 + index)}.000100` }),
    );
    const fake = fakeApi({ history: roots });
    const error = unwrapErr(
      await readOrgIncidents({
        api: fake.api,
        channelId: "C0SYNINCIDENTS",
        clock: STILL,
        wait: NEVER,
        nowMs: NOW_MS,
        previous: {},
      }),
    );
    expect(error.code).toBe("BUDGET_EXCEEDED");
    expect(error.message).toContain("11 incident threads need reading and a tick affords 10");
    expect(fake.repliesAsked).toEqual([]);
  });

  it("asks Slack nothing more once a call has spent its deadline, inside the supervisor's", async () => {
    const fake = fakeApi({ history: [FIXING], threads: { [String(FIXING["ts"])]: FIXING_THREAD } });
    let now = NOW_MS;
    const slowHistory: IncidentReadApi = {
      history: async (args) => {
        const page = await fake.api.history(args);
        now += READ_DEADLINE_MS + 1;
        return page;
      },
      replies: fake.api.replies,
    };
    const error = unwrapErr(
      await readOrgIncidents({
        api: slowHistory,
        channelId: "C0SYNINCIDENTS",
        clock: () => now,
        nowMs: NOW_MS,
        previous: {},
        wait: NEVER,
      }),
    );
    expect([error.code, error.message]).toEqual([
      "DEADLINE_PASSED",
      "the read had taken 90001ms of the 90000ms it keeps inside a supervisor tick — it stopped reading Slack there",
    ]);
    expect(fake.repliesAsked).toEqual([]);
  });

  it("abandons a history page that hangs, once the time it had left runs out", async () => {
    let now = NOW_MS;
    const waited: number[] = [];
    const hung: IncidentReadApi = {
      history: () => new Promise(() => undefined),
      replies: () => Promise.reject(new Error("no thread should be asked")),
    };
    const error = unwrapErr(
      await readOrgIncidents({
        api: hung,
        channelId: "C0SYNINCIDENTS",
        clock: () => now,
        nowMs: NOW_MS,
        previous: {},
        wait: (ms) => {
          waited.push(ms);
          now += ms;
          return Promise.resolve();
        },
      }),
    );
    expect([error.code, waited]).toEqual(["DEADLINE_PASSED", [READ_DEADLINE_MS]]);
  });

  it("names the channel when its history will not read", async () => {
    const fake = fakeApi({ history: new Error("missing_scope") });
    const error = unwrapErr(
      await readOrgIncidents({
        api: fake.api,
        channelId: "C0SYNINCIDENTS",
        clock: STILL,
        wait: NEVER,
        nowMs: NOW_MS,
        previous: {},
      }),
    );
    expect(error.code).toBe("SLACK_READ_FAILED");
    expect(error.message).toContain("C0SYNINCIDENTS");
    expect(error.message).toContain("missing_scope");
  });
});

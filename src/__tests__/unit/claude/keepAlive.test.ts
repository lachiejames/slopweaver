import { describe, expect, it } from "vitest";

import {
  ACCESS_TOKEN_LIFETIME_HOURS,
  KEEP_ALIVE_INTERVAL_HOURS,
  parseStoreTouches,
  recordStoreTouch,
  storesDueForTouch,
} from "../../../claude/keepAlive.js";

const ACCOUNTS = [
  { alias: "plan-one", storeDir: "/stores/one" },
  { alias: "plan-two", storeDir: "/stores/two" },
  { alias: "plan-three", storeDir: "/stores/three" },
];
const NOW = "2026-09-05T12:00:00.000Z";

describe("the interval", () => {
  it("pins the measured access-token lifetime", () => {
    expect(ACCESS_TOKEN_LIFETIME_HOURS).toBe(8);
  });

  it("touches well inside that lifetime, so two consecutive misses are survivable", () => {
    expect(KEEP_ALIVE_INTERVAL_HOURS).toBeLessThan(ACCESS_TOKEN_LIFETIME_HOURS / 2);
    expect(KEEP_ALIVE_INTERVAL_HOURS * 2).toBeLessThan(ACCESS_TOKEN_LIFETIME_HOURS);
  });
});

describe("storesDueForTouch", () => {
  it("treats a store that has NEVER been touched as due", () => {
    expect(storesDueForTouch({ accounts: ACCOUNTS, nowIso: NOW, touches: [] })).toStrictEqual([
      "plan-one",
      "plan-two",
      "plan-three",
    ]);
  });

  it("leaves a store touched a moment ago alone", () => {
    const due = storesDueForTouch({
      accounts: ACCOUNTS,
      nowIso: NOW,
      touches: ACCOUNTS.map((a) => ({ alias: a.alias, lastTouchedIso: "2026-09-05T11:55:00.000Z" })),
    });
    expect(due).toStrictEqual([]);
  });

  it("calls a store due once the interval has elapsed", () => {
    const stale = new Date(Date.parse(NOW) - (KEEP_ALIVE_INTERVAL_HOURS + 0.1) * 3600_000).toISOString();
    const due = storesDueForTouch({
      accounts: ACCOUNTS,
      nowIso: NOW,
      touches: [
        { alias: "plan-one", lastTouchedIso: stale },
        { alias: "plan-two", lastTouchedIso: "2026-09-05T11:59:00.000Z" },
        { alias: "plan-three", lastTouchedIso: "2026-09-05T11:59:00.000Z" },
      ],
    });
    expect(due).toStrictEqual(["plan-one"]);
  });

  it("would have caught the two stores that actually died, on their real timings", () => {
    // plan-two and plan-three were last touched in the early morning; both read 401 expired by the afternoon.
    const due = storesDueForTouch({
      accounts: ACCOUNTS,
      nowIso: "2026-09-04T15:30:00.000Z",
      touches: [
        { alias: "plan-one", lastTouchedIso: "2026-09-04T15:00:00.000Z" },
        { alias: "plan-two", lastTouchedIso: "2026-09-04T06:49:05.000Z" },
        { alias: "plan-three", lastTouchedIso: "2026-09-04T06:54:24.000Z" },
      ],
    });
    expect(due).toStrictEqual(["plan-two", "plan-three"]);
  });

  it("returns aliases in configured order, which is the selection tie-break", () => {
    const due = storesDueForTouch({ accounts: ACCOUNTS, nowIso: NOW, touches: [] });
    expect(due).toStrictEqual(ACCOUNTS.map((a) => a.alias));
  });
});

describe("parseStoreTouches", () => {
  it("reads back what recordStoreTouch wrote, so the loop's own round trip is the thing tested", () => {
    const touches = recordStoreTouch({ alias: "plan-one", nowIso: NOW, touches: [] });
    expect(parseStoreTouches({ value: JSON.parse(JSON.stringify({ touches })) })).toStrictEqual([
      { alias: "plan-one", lastTouchedIso: NOW },
    ]);
  });

  it("treats a missing file as nothing touched, which makes every store due", () => {
    expect(parseStoreTouches({ value: undefined })).toStrictEqual([]);
  });

  it("keeps the usable entries and drops the rest, rather than refusing the whole file", () => {
    const parsed = parseStoreTouches({
      value: { touches: [{ alias: "plan-one", lastTouchedIso: NOW }, { lastTouchedIso: NOW }, "nonsense", 7] },
    });
    expect(parsed).toStrictEqual([{ alias: "plan-one", lastTouchedIso: NOW }]);
  });

  it("keeps an entry whose instant is missing, which is a store with no evidence it is alive", () => {
    expect(parseStoreTouches({ value: { touches: [{ alias: "plan-two" }] } })).toStrictEqual([{ alias: "plan-two" }]);
    expect(
      storesDueForTouch({
        accounts: [{ alias: "plan-two", storeDir: "/stores/two" }],
        nowIso: NOW,
        touches: parseStoreTouches({ value: { touches: [{ alias: "plan-two" }] } }),
      }),
    ).toStrictEqual(["plan-two"]);
  });
});

describe("recordStoreTouch", () => {
  it("replaces the entry already standing for that store rather than appending a second one", () => {
    const first = recordStoreTouch({ alias: "plan-one", nowIso: "2026-09-05T06:00:00.000Z", touches: [] });
    const second = recordStoreTouch({ alias: "plan-one", nowIso: NOW, touches: first });
    expect(second).toStrictEqual([{ alias: "plan-one", lastTouchedIso: NOW }]);
  });

  it("leaves every other store's record alone", () => {
    const touches = recordStoreTouch({
      alias: "plan-two",
      nowIso: NOW,
      touches: [{ alias: "plan-one", lastTouchedIso: "2026-09-05T06:00:00.000Z" }],
    });
    expect(touches).toStrictEqual([
      { alias: "plan-one", lastTouchedIso: "2026-09-05T06:00:00.000Z" },
      { alias: "plan-two", lastTouchedIso: NOW },
    ]);
  });
});

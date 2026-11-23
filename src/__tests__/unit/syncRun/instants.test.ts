import { describe, expect, it } from "vitest";

import type { SyncRunEvent } from "../../../syncRun/event.js";
import { lastActivityIsoOf, lastCommittedIsoOf } from "../../../syncRun/instants.js";

const STARTED_AT = "2026-10-03T00:00:00.000Z";

const committed = ({ atIso, written }: { atIso: string; written: number }): SyncRunEvent => ({
  atIso,
  container: "slack/C1",
  kinds: { message: { offered: 5, written } },
  label: "#a",
  runId: "r1",
  type: "committed",
  v: 1,
});

const progress = ({ atIso }: { atIso: string }): SyncRunEvent => ({
  atIso,
  done: 1,
  item: "#general",
  metrics: {},
  phase: "channel",
  runId: "r1",
  total: 40,
  type: "progress",
  v: 1,
});

describe("lastActivityIsoOf", () => {
  it("dates a run by its newest row of any kind, whatever order the file holds them in", () => {
    const events = [
      progress({ atIso: "2026-10-03T00:05:00.000Z" }),
      committed({ atIso: "2026-10-03T00:03:00.000Z", written: 2 }),
    ];

    expect(lastActivityIsoOf({ events, startedAtIso: STARTED_AT })).toBe("2026-10-03T00:05:00.000Z");
  });

  it("falls to the start row's instant when no later row exists", () => {
    expect(lastActivityIsoOf({ events: [], startedAtIso: STARTED_AT })).toBe(STARTED_AT);
  });
});

describe("lastCommittedIsoOf", () => {
  it("dates the newest rows by the newest commit that wrote any, never a later progress row or an empty commit", () => {
    const events = [
      committed({ atIso: "2026-10-03T00:04:00.000Z", written: 3 }),
      committed({ atIso: "2026-10-03T00:02:00.000Z", written: 1 }),
      committed({ atIso: "2026-10-03T00:06:00.000Z", written: 0 }),
      progress({ atIso: "2026-10-03T00:08:00.000Z" }),
    ];

    expect(lastCommittedIsoOf({ events })).toBe("2026-10-03T00:04:00.000Z");
  });

  it("says null when no commit wrote anything", () => {
    const events = [committed({ atIso: "2026-10-03T00:04:00.000Z", written: 0 })];

    expect([lastCommittedIsoOf({ events }), lastCommittedIsoOf({ events: [] })]).toEqual([null, null]);
  });
});

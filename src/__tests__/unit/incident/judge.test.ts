import { describe, expect, it } from "vitest";

import type { IncidentChannel } from "../../../incident/channel.js";
import { judgeIncidentChannels } from "../../../incident/judge.js";

const NOW_S = Date.parse("2026-10-04T05:00:00.000Z") / 1000;

const LIVE: IncidentChannel = { createdEpochSeconds: NOW_S - 3600, id: "C0LIVE", name: "inc-2026-10-04-checkout-down" };
const PAST: IncidentChannel = {
  createdEpochSeconds: Date.parse("2026-09-23T01:17:24.000Z") / 1000,
  id: "C0SYN000004",
  name: "inc-2026-09-23-payment-checkout-regression",
};
const DRILL: IncidentChannel = {
  createdEpochSeconds: Date.parse("2026-08-21T12:52:49.000Z") / 1000,
  id: "C0SYN000031",
  name: "inc-2026-08-21-test-incident",
};
const UNDATED: IncidentChannel = { id: "C0NODATE", name: "inc-2026-10-04-undated" };
const GENERAL: IncidentChannel = { createdEpochSeconds: NOW_S - 60, id: "C0GEN", name: "general" };

describe("judgeIncidentChannels", () => {
  it("judges incidents and drills newest first, undated last, and leaves every other channel out", () => {
    const judged = judgeIncidentChannels({
      channels: [UNDATED, DRILL, PAST, GENERAL, LIVE],
      nowEpochSeconds: NOW_S,
      sinceEpochSeconds: undefined,
    });

    expect(judged.map(({ id, verdict, live, why }) => ({ id, live, verdict, why }))).toEqual([
      { id: "C0LIVE", live: true, verdict: "incident", why: undefined },
      { id: "C0SYN000004", live: false, verdict: "incident", why: "opened 267h ago, outside the 48h live window" },
      { id: "C0SYN000031", live: false, verdict: "drill", why: 'names itself "test"' },
      { id: "C0NODATE", live: false, verdict: "incident", why: "no created time" },
    ]);
    expect(judged[1]!.openedIso).toBe("2026-09-23T01:17:24.000Z");
  });

  it("keeps only channels opened at or after --since, dropping an undated one", () => {
    const judged = judgeIncidentChannels({
      channels: [UNDATED, DRILL, PAST, LIVE],
      nowEpochSeconds: NOW_S,
      sinceEpochSeconds: PAST.createdEpochSeconds!,
    });

    expect(judged.map((channel) => channel.id)).toEqual(["C0LIVE", "C0SYN000004"]);
  });

  it("judges an empty corpus as empty", () => {
    expect(judgeIncidentChannels({ channels: [], nowEpochSeconds: NOW_S, sinceEpochSeconds: undefined })).toEqual([]);
  });
});

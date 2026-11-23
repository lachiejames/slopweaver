import { describe, expect, it } from "vitest";

import type { StructureBronzeRow } from "../../../corpus/structures/types.js";
import {
  CLOCK_SKEW_SECONDS,
  classifyIncidentChannel,
  type IncidentChannel,
  incidentsCreatorOf,
  LIVE_INCIDENT_WINDOW_HOURS,
  latestIncidentChannels,
  liveAdmission,
} from "../../../incident/channel.js";

/** The incidents.io app user, as `#incidents` and every incident channel name it. */
const APP = "U0SYN7INCIDENTS";
/** When the incident channel opened. */
const OPENED = 1_790_126_160;

const channel = (over: Partial<IncidentChannel> = {}): IncidentChannel => ({
  createdEpochSeconds: OPENED,
  creator: APP,
  id: "C0SYN000004",
  name: "inc-2026-09-23-payment-checkout-regression",
  topic: "INC-98",
  ...over,
});

const row = ({
  sourceId,
  name,
  attrs,
  fetchedAtIso = "2026-09-23T02:00:00.000Z",
}: {
  sourceId: string;
  name: string;
  attrs: StructureBronzeRow["attrs"];
  fetchedAtIso?: string;
}): StructureBronzeRow => ({
  attrs,
  fetchedAtIso,
  identity: { name, nativeId: sourceId },
  kind: "channel",
  provenance: [],
  raw: {},
  relations: [],
  source: "slack",
  sourceId,
  version: 1,
  warnings: [],
});

describe("classifyIncidentChannel", () => {
  it("reads a dated inc- channel as an incident, with every evidence line in order", () => {
    const verdict = classifyIncidentChannel({ channel: channel(), incidentsCreator: APP });
    expect(verdict).toEqual({
      evidence: [
        "name inc-2026-09-23-payment-checkout-regression matches inc-YYYY-MM-DD-<slug>",
        "creator U0SYN7INCIDENTS is the #incidents creator U0SYN7INCIDENTS",
        "created 1790126160",
        "topic INC-98",
        "open, public, not joined",
      ],
      kind: "incident",
    });
  });

  it("reads the underscore-dated convention a couple of real incidents use", () => {
    const verdict = classifyIncidentChannel({
      channel: channel({ name: "inc-2026_09_23-api-slow-load" }),
      incidentsCreator: APP,
    });
    expect(verdict.kind).toBe("incident");
  });

  it("refuses a date that mixes its separators", () => {
    const verdict = classifyIncidentChannel({
      channel: channel({ name: "inc-2026_09-23-api-slow-load" }),
      incidentsCreator: APP,
    });
    expect(verdict.kind).toBe("not-incident");
  });

  it("reads an incident re-titled with an older incident's name as one incident", () => {
    const verdict = classifyIncidentChannel({
      channel: channel({ name: "inc-2026-09-08-inc-2026-09-06-report-delay" }),
      incidentsCreator: APP,
    });
    expect(verdict.kind).toBe("incident");
  });

  it.each([
    ["inc-2026-02-07-test-incident", "test"],
    ["inc-2026-02-07-another-test", "test"],
    ["inc-2026-08-21-testing-again", "testing"],
    ["inc-2026-01-06-tutorial-daisy-whale", "tutorial"],
    ["inc-1-this-is-an-example-incident", "example"],
  ])("reads %s as a drill naming itself %s", (name, token) => {
    const verdict = classifyIncidentChannel({ channel: channel({ name }), incidentsCreator: APP });
    expect(verdict).toEqual({
      evidence: expect.arrayContaining([`drill: names itself "${token}"`]),
      kind: "drill",
      token,
    });
  });

  it("reads a drill word inside a longer word as no drill", () => {
    const verdict = classifyIncidentChannel({
      channel: channel({ name: "inc-2026-09-01-latest-contest-results" }),
      incidentsCreator: APP,
    });
    expect(verdict.kind).toBe("incident");
  });

  it("never reads a drill word outside an inc- channel as a drill", () => {
    const verdict = classifyIncidentChannel({ channel: channel({ name: "test-channel" }), incidentsCreator: APP });
    expect(verdict.kind).toBe("not-incident");
  });

  it("keeps a channel some other user opened an incident, and prints the difference", () => {
    const verdict = classifyIncidentChannel({ channel: channel({ creator: "U0HUMAN" }), incidentsCreator: APP });
    expect(verdict.kind).toBe("incident");
    expect(verdict.evidence[1]).toBe("creator U0HUMAN is not the #incidents creator U0SYN7INCIDENTS");
  });

  it("says so when neither creator is known, and prints no topic line without a topic", () => {
    const bare: IncidentChannel = { id: "C1", name: "inc-2026-09-23-x" };
    const verdict = classifyIncidentChannel({ channel: bare, incidentsCreator: undefined });
    expect(verdict.evidence).toEqual([
      "name inc-2026-09-23-x matches inc-YYYY-MM-DD-<slug>",
      "creator unknown",
      "created time unknown",
      "open, public, not joined",
    ]);
  });

  it("names an unknown #incidents creator beside a known channel creator", () => {
    const verdict = classifyIncidentChannel({ channel: channel(), incidentsCreator: undefined });
    expect(verdict.evidence[1]).toBe("creator U0SYN7INCIDENTS; the #incidents creator is unknown");
  });

  it("prints archived, private and joined", () => {
    const verdict = classifyIncidentChannel({
      channel: channel({ isArchived: true, isMember: true, isPrivate: true }),
      incidentsCreator: APP,
    });
    expect(verdict.evidence[4]).toBe("archived, private, joined");
  });
});

describe("incidentsCreatorOf", () => {
  it("reads the creator of #incidents", () => {
    const channels = [channel(), { creator: APP, id: "C0SYNINCIDENTS", name: "incidents" }];
    expect(incidentsCreatorOf({ channels })).toBe(APP);
  });

  it("is undefined when the batch carries no #incidents", () => {
    expect(incidentsCreatorOf({ channels: [channel()] })).toBeUndefined();
  });
});

describe("liveAdmission", () => {
  const now = OPENED + 3600;

  it("admits a fresh open channel", () => {
    expect(liveAdmission({ channel: channel(), nowEpochSeconds: now })).toEqual({ admit: true });
  });

  it("leaves readability to the probe: a private unjoined channel is admitted here", () => {
    const closed = channel({ isPrivate: true });
    expect(liveAdmission({ channel: closed, nowEpochSeconds: now })).toEqual({ admit: true });
  });

  it("refuses an archived channel before anything else", () => {
    const { createdEpochSeconds: _dropped, ...undated } = channel({ isArchived: true });
    expect(liveAdmission({ channel: undated, nowEpochSeconds: now })).toEqual({ admit: false, why: "archived" });
  });

  it("refuses a channel with no created time rather than reading it as fresh", () => {
    const { createdEpochSeconds: _dropped, ...undated } = channel();
    expect(liveAdmission({ channel: undated, nowEpochSeconds: now })).toEqual({
      admit: false,
      why: "no created time",
    });
  });

  it("admits ordinary clock drift and refuses a creation time further in the future", () => {
    const ahead = OPENED - CLOCK_SKEW_SECONDS;
    expect(liveAdmission({ channel: channel(), nowEpochSeconds: ahead })).toEqual({ admit: true });
    expect(liveAdmission({ channel: channel(), nowEpochSeconds: ahead - 1 })).toEqual({
      admit: false,
      why: "created 301s ahead of this clock",
    });
  });

  it("admits a channel exactly at the window's edge and refuses one a second past it", () => {
    const edge = OPENED + LIVE_INCIDENT_WINDOW_HOURS * 3600;
    expect(liveAdmission({ channel: channel(), nowEpochSeconds: edge })).toEqual({ admit: true });
    expect(liveAdmission({ channel: channel(), nowEpochSeconds: edge + 1 })).toEqual({
      admit: false,
      why: "opened 48h ago, outside the 48h live window",
    });
  });
});

describe("latestIncidentChannels", () => {
  it("projects a channel row's origin, privacy and membership", () => {
    const rows = [
      row({
        attrs: {
          archived: false,
          created: OPENED,
          creator: APP,
          isMember: true,
          membershipResolved: true,
          private: true,
          topic: "INC-98",
        },
        name: "inc-2026-09-23-payment-checkout-regression",
        sourceId: "C0SYN000004",
      }),
    ];
    expect(latestIncidentChannels({ rows })).toEqual([
      {
        createdEpochSeconds: OPENED,
        creator: APP,
        id: "C0SYN000004",
        isMember: true,
        isPrivate: true,
        name: "inc-2026-09-23-payment-checkout-regression",
        topic: "INC-98",
      },
    ]);
  });

  it("judges a channel by its newest capture, so a live snapshot then an archived one reads archived", () => {
    const name = "inc-2026-09-23-payment-checkout-regression";
    const rows = [
      row({ attrs: { archived: false, created: OPENED }, name, sourceId: "C0SYN000004" }),
      row({
        attrs: { archived: true, created: OPENED },
        fetchedAtIso: "2026-09-25T00:00:00.000Z",
        name,
        sourceId: "C0SYN000004",
      }),
    ];
    expect(latestIncidentChannels({ rows })).toEqual([
      { createdEpochSeconds: OPENED, id: "C0SYN000004", isArchived: true, name },
    ]);
  });

  it("drops an empty topic or creator, a zero created time, and a row with no name", () => {
    const rows = [
      row({ attrs: { created: 0, creator: "", topic: "" }, name: "inc-2026-09-23-x", sourceId: "C1" }),
      { ...row({ attrs: {}, name: "unused", sourceId: "C2" }), identity: { nativeId: "C2" } },
    ];
    expect(latestIncidentChannels({ rows })).toEqual([{ id: "C1", name: "inc-2026-09-23-x" }]);
  });

  it("ignores a row that is not a Slack channel", () => {
    const team = { ...row({ attrs: {}, name: "inc-2026-09-23-x", sourceId: "T1" }), kind: "team" as const };
    expect(latestIncidentChannels({ rows: [team] })).toEqual([]);
  });
});

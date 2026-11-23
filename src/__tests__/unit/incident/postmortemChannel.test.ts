/*
 * The binding between a postmortem card's channel and the incident it references, judged against the org-health
 * snapshot: bound, or refused with the reason the snapshot gives.
 */
import { describe, expect, it } from "vitest";

import { postmortemChannelUnbound } from "../../../incident/postmortemChannel.js";
import type { IncidentSnapshot, OrgIncident } from "../../../orgHealth/types.js";

const CHANNEL_ID = "C0SYN000004";

const INCIDENT: OrgIncident = {
  channelId: CHANNEL_ID,
  declaredIso: "2026-09-23T01:00:00.000Z",
  homepageUrl: "https://app.incident.io/acme/incidents/98",
  phase: "resolved",
  phaseChangedIso: "2026-09-23T06:00:00.000Z",
  phaseProvenance: "update",
  ref: "INC-98",
  severity: "Major",
  status: "Closed",
  title: "Payment checkout regression",
};

/** A measured snapshot keeping `incidents`. */
function measured({ incidents }: { incidents: readonly OrgIncident[] }): IncidentSnapshot {
  return {
    announcementCount: incidents.length,
    channelId: "C0SYNINCIDENTS",
    incidents,
    readIso: "2026-09-24T01:00:00.000Z",
    schemaVersion: 1,
    state: "measured",
  };
}

describe("postmortemChannelUnbound", () => {
  it("binds a channel the referenced incident's announcement names", () => {
    expect(
      postmortemChannelUnbound({
        channelId: CHANNEL_ID,
        reference: "INC-98",
        snapshot: measured({ incidents: [INCIDENT] }),
      }),
    ).toBe(undefined);
  });

  it("refuses another incident's channel, naming the referenced incident's own", () => {
    const snapshot = measured({ incidents: [INCIDENT, { ...INCIDENT, channelId: "C0SYNBBBBBBBB", ref: "INC-97" }] });

    expect(postmortemChannelUnbound({ channelId: CHANNEL_ID, reference: "INC-97", snapshot })).toEqual({
      channelId: CHANNEL_ID,
      code: "POSTMORTEM_CHANNEL_UNBOUND",
      message:
        "incident postmortem: channel C0SYN000004 cannot be bound to INC-97 — INC-97's own channel is C0SYNBBBBBBBB",
      ref: "INC-97",
    });
  });

  it.each<[string, IncidentSnapshot | null, string]>([
    [
      "no read has run",
      null,
      "no incident read has run — `slopweaver org-health read` writes the snapshot this binds against",
    ],
    [
      "the last read was unmeasurable",
      { attemptedIso: "2026-09-24T01:00:00.000Z", because: "rate limited", schemaVersion: 1, state: "unmeasurable" },
      "the last incident read could not see the channel whole (rate limited)",
    ],
    [
      "the snapshot keeps no such incident",
      measured({ incidents: [] }),
      "the snapshot read 2026-09-24T01:00:00.000Z keeps no INC-98, and it remembers a resolved incident for 7 days",
    ],
    [
      "the incident names no channel",
      measured({ incidents: [{ ...INCIDENT, channelId: undefined }] }),
      "INC-98's announcement names no channel",
    ],
  ])("refuses when %s", (_case, snapshot, why) => {
    expect(postmortemChannelUnbound({ channelId: CHANNEL_ID, reference: "INC-98", snapshot })!.message).toBe(
      `incident postmortem: channel C0SYN000004 cannot be bound to INC-98 — ${why}`,
    );
  });
});

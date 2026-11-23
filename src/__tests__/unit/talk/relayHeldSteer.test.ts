import { describe, expect, it } from "vitest";

import type { DraftChannelSteer } from "../../../outbound/slack/draftRegister.js";
import type { RelaySteer } from "../../../talk/relayChannelSteer.js";
import { STILL_SPEAKING_HOLD } from "../../../talk/relayCutHold.js";
import { heldSteerLead } from "../../../talk/relayHeldSteer.js";

const LAUNCH = { id: "C0SYN000001", name: "proj-launch-room" };
const ALERTS = { id: "C0SYN000006", name: "dev-alerts" };
const SECURITY = { id: "C0SYN000007", name: "sec-review" };
const AT = "2026-10-12T00:20:00.000Z";

/** A planned steer on `sd-359bafb2`, parked for the launch channel, to `channels`. */
function steerTo({ channels }: { channels: readonly { id: string; name: string }[] }): RelaySteer {
  const event = { anchor: "talk:x", channels, from: LAUNCH, heard: "move it", id: "sd-359bafb2", tsIso: AT };
  return { draftId: "sd-359bafb2", event: { ...event, kind: "steered" } };
}

/** The steer governing the lineage, allowing `channels`. */
function governingFor({ channels }: { channels: readonly { id: string; name: string }[] }): DraftChannelSteer {
  return { anchor: "talk:y", channels, from: LAUNCH, heard: "earlier", tsIso: "2026-10-12T00:16:00.000Z" };
}

describe("heldSteerLead", () => {
  it("records every steer from a relay stated whole, widening or not", () => {
    const governing = governingFor({ channels: [ALERTS] });
    expect(heldSteerLead({ governing, hold: undefined, steer: steerTo({ channels: [SECURITY] }) })).toBe(undefined);
  });

  it("records a held steer away from the row's channel when no steer governs the lineage yet", () => {
    const steer = steerTo({ channels: [ALERTS] });
    expect(heldSteerLead({ governing: undefined, hold: STILL_SPEAKING_HOLD, steer })).toBe(undefined);
  });

  it("records a held steer naming only channels the governing steer already allows", () => {
    const governing = governingFor({ channels: [ALERTS, SECURITY] });
    const steer = steerTo({ channels: [SECURITY] });
    expect(heldSteerLead({ governing, hold: STILL_SPEAKING_HOLD, steer })).toBe(undefined);
  });

  it("holds a held steer adding a channel the governing steer refuses, naming what still governs", () => {
    const governing = governingFor({ channels: [ALERTS] });
    const steer = steerTo({ channels: [ALERTS, SECURITY] });
    expect(heldSteerLead({ governing, hold: STILL_SPEAKING_HOLD, steer })).toBe(
      `CHANNEL: the steer on sd-359bafb2 was NOT recorded, so the owner's earlier word for #dev-alerts still governs (${STILL_SPEAKING_HOLD})`,
    );
  });

  // A whole take-back recorded between the read and the append made a held one look narrowing.
  it("holds a held take-back to the row's own channel, governed or not, even where the governing steer allows it", () => {
    const steer = steerTo({ channels: [LAUNCH] });
    const lead = `CHANNEL: the take-back on sd-359bafb2 was NOT recorded, so any earlier steer still refuses (${STILL_SPEAKING_HOLD})`;
    expect([
      heldSteerLead({ governing: undefined, hold: STILL_SPEAKING_HOLD, steer }),
      heldSteerLead({ governing: governingFor({ channels: [ALERTS] }), hold: STILL_SPEAKING_HOLD, steer }),
      heldSteerLead({ governing: governingFor({ channels: [LAUNCH] }), hold: STILL_SPEAKING_HOLD, steer }),
    ]).toEqual([lead, lead, lead]);
  });
});

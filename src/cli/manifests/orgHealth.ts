/**
 * Lazy manifest for the `org-health` noun — the organisation's own incidents, read the way a status page shows them.
 *
 * Three verbs. `read` is the lane's only live read; the `org-health` monitor (`monitor check --only org-health`) judges
 * the snapshot it writes and floats the loud note. `status` is the quiet channel, read on demand. `ack` is the owner's
 * acknowledgement of one open incident, a local row and nothing sent. The channel lives in `profile.json`, not behind a configure verb.
 */
import { ORG_HEALTH_ACK_USAGE, ORG_HEALTH_READ_USAGE, ORG_HEALTH_STATUS_USAGE } from "../commands/orgHealth/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const orgHealthManifest: Readonly<Record<string, VerbManifestEntry>> = {
  ack: lazy({
    load: () => import("../commands/orgHealth/ackRun.js").then((m) => m.orgHealthAckCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // LOCAL: one row appended under the home. Nothing reaches incident.io, Slack or any person, so no door.
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver org-health ack --ref INC-33",
      parseRejectIsIoFree: true,
      summary:
        "Acknowledge an open incident locally, quieting org-health status about it until its severity or phase moves",
      usage: ORG_HEALTH_ACK_USAGE,
    },
  }),
  read: lazy({
    load: () => import("../commands/orgHealth/readRun.js").then((m) => m.orgHealthReadCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // A READ, not a write: nothing leaves for Slack, so it does not go through the admit door. It writes the
      // snapshot under the home, which is why the effect is `local-state` rather than none.
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver org-health read --json",
      parseRejectIsIoFree: true,
      summary: "Read the incident channel whole and write the snapshot the org-health monitor and status judge",
      usage: ORG_HEALTH_READ_USAGE,
    },
  }),
  status: lazy({
    load: () => import("../commands/orgHealth/statusRun.js").then((m) => m.orgHealthStatusCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // Reads one local file and writes nothing.
      effect: "none",
      example: "slopweaver org-health status --json",
      parseRejectIsIoFree: true,
      summary:
        "Say how many incidents are ongoing and whether any is past investigating, and whether the fleet is looking",
      usage: ORG_HEALTH_STATUS_USAGE,
    },
  }),
};

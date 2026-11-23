/** The Slack integration's manifest — strings, its atlas row and `import()` thunks only. */
import { SLACK_ATLAS_REGISTRATION } from "../../atlas/slackApi/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The slack row of the integration registry. */
export const SLACK_INTEGRATION = {
  browserWrite: {
    ordinal: 0,
    row: {
      door: "slopweaver slack read-thread / slack post / slack as-me",
      hosts: ["slack.com", "slack-edge.com"],
      policy: "read-before-write",
      provider: "Slack",
    },
  },
  connection: {
    connectWith: "slopweaver secrets set slack-bot-token",
    credentialSets: [["slack-bot-token"], ["slack-user-token"]],
    ordinal: 5,
  },
  corpus: {
    allSourcesSweep: true,
    alwaysPrivate: false,
    containerScoped: true,
    identityRoster: true,
    missingTokenHint: "set SLACK_USER_TOKEN (or SLACK_BOT_TOKEN) or $SLOPWEAVER_HOME/secrets/slack-user-token",
    ordinal: 1,
    progressPhase: true,
    resyncDemand: true,
    upfrontTokenGate: true,
  },
  features: {
    atlas: SLACK_ATLAS_REGISTRATION,
    connect: async () => (await import("../../connect/slack.js")).SLACK_REQUIRED_USER_SCOPES,
    ingest: async () => (await import("../../corpus/slack/fetch.js")).resolveSlackReadToken,
    listen: async () => (await import("../../live/listen/socket.js")).consumeMentions,
    read: async () => (await import("../../live/slack/readThread.js")).threadDirectoryKey,
    // Not a send entry such as `runCompositeSend`: naming one here is a write passed as a value, which
    // `unit/outbound/slack/prLeadSeams/callSites.test.ts` refuses, so the evidence is the transport guard every send runs.
    write: async () => (await import("../../corpus/slack/writeGuards.js")).guardWriteTransport,
  },
  id: "slack",
  name: "Slack",
  noun: { kind: "source-reading" },
  routing: [
    {
      capability: {
        availability: { kind: "available" },
        command: ["slopweaver", "connect", "slack", "--check"],
        coverage: {
          detail:
            "whether this install's Slack token reaches the workspace, and the exact scopes it holds. The " +
            "READING is the separate act, and every one of these needs a LINK or an id — a question carrying " +
            "none belongs to the corpus. `slopweaver slack read-thread <message-link>` is one thread, " +
            "complete by default, with exact residue and navigable permalinks; `slopweaver slack read-file " +
            "<F…|link>` is a canvas, a huddle's notes and the huddle TRANSCRIPT behind them, UNREDACTED; " +
            "`slopweaver slack probe --method <read-only method>` reports a response SHAPE — field names, " +
            "counts, timing — and never a message body, which is the instrument behind an API claim",
          kind: "bounded",
        },
        effect: "read",
        freshness: { detail: "read directly from Slack when the planned command runs", kind: "live" },
        id: "slack-live",
        owner: "slopweaver",
        sourceClass: "provider",
        terms: ["thread", "slack", "channel", "huddle", "canvas", "dm", "slack thread", "slack message"],
        truthMode: "current",
        what: "what a named Slack thread, file or huddle transcript says right now — including the replies and edits landed since the last corpus load",
      },
      ordinal: 18,
    },
  ],
} as const satisfies IntegrationManifest;

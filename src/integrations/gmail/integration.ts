/** The Gmail integration's manifest — strings, its atlas row and `import()` thunks only. */
import type { IntegrationManifest } from "../manifest.js";

/** The gmail row of the integration registry. */
export const GMAIL_INTEGRATION = {
  connection: { connectWith: "slopweaver gmail connect", credentialSets: [["gmail-oauth.json"]], ordinal: 0 },
  corpus: {
    allSourcesSweep: false,
    alwaysPrivate: true,
    containerScoped: true,
    identityRoster: false,
    ordinal: 6,
    progressPhase: true,
    resyncDemand: true,
    upfrontTokenGate: false,
  },
  features: {
    connect: async () => (await import("../../connect/gmail.js")).classifyGmail,
    ingest: async () => (await import("../../corpus/gmail/ingest.js")).isEpochWide,
    read: async () => (await import("../../live/gmail/read.js")).MAX_LIST_LIMIT,
    write: async () => (await import("../../live/gmail/compose.js")).encodeHeaderValue,
  },
  id: "gmail",
  name: "Gmail",
  noun: { kind: "source-reading" },
  routing: [
    {
      capability: {
        availability: { kind: "available" },
        // The mailbox this install is bound to, not a search: `gmail list --query` is Gmail search syntax and
        // ANDs its words, so a whole natural-language question returns an empty page that reads as absence.
        command: ["slopweaver", "gmail", "connect", "--status"],
        coverage: {
          detail:
            "which mailbox this install is bound to, and what it was granted. READING is the separate act: `slopweaver gmail list --query \"<gmail search>\"` (metadata only, one page) and `gmail read <id>` for a body or a whole thread. The query is Gmail's own syntax and ANDs every word, so compose it from the nouns of the question and treat one empty result as one query rather than as absence. An ATTACHMENT's own WORDS are two hops and are not this leg: `gmail read` lists its filename, `slopweaver gmail attachment <message-id> --name <file>` saves the bytes, and the `attachments` row is what reads them",
          kind: "bounded",
        },
        effect: "read",
        freshness: { detail: "read directly from Gmail when the planned command runs", kind: "live" },
        id: "gmail",
        owner: "slopweaver",
        sourceClass: "provider",
        terms: [
          "email",
          "emails",
          "mail",
          "inbox",
          "gmail",
          "invite",
          "invitation",
          "attachment",
          "attachments",
          "mailbox",
        ],
        truthMode: "current",
        what: "the owner's own mailbox — who sent what, when, with which attachment, and the invitations and account mail no other source ever records",
      },
      meetingRecords: true,
      ordinal: 11,
    },
  ],
} as const satisfies IntegrationManifest;

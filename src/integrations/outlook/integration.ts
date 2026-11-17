/** The Outlook integration's manifest — strings, its atlas row and `import()` thunks only. */
import type { IntegrationManifest } from "../manifest.js";

/** The outlook row of the integration registry. */
export const OUTLOOK_INTEGRATION = {
  connection: { connectWith: "slopweaver outlook connect", credentialSets: [["outlook-oauth.json"]], ordinal: 3 },
  corpus: {
    allSourcesSweep: false,
    alwaysPrivate: true,
    containerScoped: true,
    identityRoster: false,
    ordinal: 11,
    progressPhase: false,
    resyncDemand: true,
    upfrontTokenGate: false,
  },
  features: {
    connect: async () => (await import("../../connect/outlook.js")).redactClientId,
    ingest: async () => (await import("../../corpus/outlook/ingest.js")).outlookMailIngestJob,
    read: async () => (await import("../../live/outlook/apiRead.js")).MAX_COLLECTION_PAGES,
    write: async () => (await import("../../live/outlook/apiWrite.js")).writeMethods,
  },
  id: "outlook",
  name: "Outlook",
  noun: { kind: "source-reading" },
  routing: [
    {
      capability: {
        availability: { kind: "available" },
        // A scope read for the reason the Gmail row gives: `outlook list --query` is Graph's `$search` (KQL), so a
        // whole question substituted into it filters to nothing and reads as absence.
        command: ["slopweaver", "outlook", "connect", "--status"],
        coverage: {
          detail:
            "which personal Outlook mailbox this install is bound to, and what it was granted — `not connected` is the common answer, and means this leg cannot answer at all. READING is the separate act: `slopweaver outlook list --query \"<kql>\"` (summaries only, one page of at most 100, newest sent first, at most 1,000 matches) and `outlook read <id>` for a body, `--thread` for the whole conversation. The query is Graph's KQL (`from:`, `subject:`, free words), so compose it from the nouns of the question and treat one empty result as one query rather than as absence. `refresh --source outlook` keeps a history copy of every folder bar drafts, outbox, junk and deleted mail, so an older thread may already be in the history leg, but this row reads the mailbox as it is now. An ATTACHMENT's own WORDS are two hops: `outlook read` lists it by name and id, `slopweaver outlook attachment <message-id> --name <file>` saves the bytes, and the `attachments` row is what reads them. The same account's DIARY is `slopweaver outlook-calendar list --from <date> --days <n>` (one window, expanded into occurrences) and `outlook-calendar read <event-id>`; it needs the separate calendar consent, `outlook connect --calendar`",
          kind: "bounded",
        },
        effect: "read",
        freshness: { detail: "read directly from Microsoft Graph when the planned command runs", kind: "live" },
        id: "outlook",
        owner: "slopweaver",
        sourceClass: "provider",
        terms: ["email", "emails", "mail", "inbox", "outlook", "hotmail", "attachment", "attachments", "mailbox"],
        truthMode: "current",
        what: "the owner's personal Outlook mailbox — who sent what, when, with which attachment — read live, on an install that has connected one",
      },
      meetingRecords: true,
      ordinal: 12,
    },
  ],
} as const satisfies IntegrationManifest;

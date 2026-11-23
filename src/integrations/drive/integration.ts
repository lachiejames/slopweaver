/** The Google Drive integration's manifest — strings, its atlas row and `import()` thunks only. */
import type { IntegrationManifest } from "../manifest.js";

/** The drive row of the integration registry. */
export const DRIVE_INTEGRATION = {
  connection: { connectWith: "slopweaver drive connect", credentialSets: [["drive-oauth.json"]], ordinal: 2 },
  features: {
    read: async () => (await import("../../live/drive/read.js")).MAX_LIST_LIMIT,
  },
  id: "drive",
  name: "Google Drive",
  noun: { kind: "source-reading" },
  routing: [
    {
      capability: {
        availability: { kind: "available" },
        // A SCOPE read, deliberately not the question. `drive list --query` takes a Drive query EXPRESSION —
        // measured, `slopweaver drive list --query "pentest"` answers Google's `Invalid Value` — so a
        // materialised question token would either fail outright or, worse, AND every word of a sentence into a
        // filter that matches nothing and reads as absence. Turning a question into search terms is the visible
        // session's judgement; this row's job is to be SEEN, and to say where to look and how.
        command: ["slopweaver", "drive", "drives"],
        coverage: {
          detail:
            "the shared drives this account can see, so a search can name one. SEARCHING is the separate act: `slopweaver drive list --query \"name contains 'x'\"` or `--query \"fullText contains 'x'\"`, and a SHARED drive is a separate corpus that `--drive <id>` must name — a plain `drive list` never reaches one, however much the browser makes it look like one Drive. Metadata only; `drive read <id>` is a file's body. One empty query is one query, never evidence the file is not there",
          kind: "bounded",
        },
        effect: "read",
        freshness: { detail: "read directly from Google Drive when the planned command runs", kind: "live" },
        id: "drive",
        owner: "slopweaver",
        sourceClass: "provider",
        // Shares the meeting-record words with both mailbox rows on purpose. A meeting transcript is a document
        // somebody keeps: Meet mails it, Drive files it, and a bot turn once checked only this machine's disk and the
        // store, said no transcript existed, and never opened the mail or Drive door that held three.
        terms: [
          "file",
          "files",
          "document",
          "documents",
          "doc",
          "docs",
          "pdf",
          "spreadsheet",
          "sheet",
          "slides",
          "deck",
          "report",
          "drive",
          "shared drive",
          "folder",
          "google doc",
        ],
        truthMode: "current",
        what: "the files the owner's Google Drive holds — their own and every shared drive they can see — by name, body text, folder, owner and modified date",
      },
      meetingRecords: true,
      ordinal: 10,
    },
  ],
} as const satisfies IntegrationManifest;

/** The Notion integration's manifest — strings, its atlas row and `import()` thunks only. */
import { NOTION_ATLAS_REGISTRATION } from "../../atlas/notion/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The notion row of the integration registry. */
export const NOTION_INTEGRATION = {
  browserWrite: {
    ordinal: 3,
    row: {
      door: "slopweaver notion read / page / verify",
      hosts: ["notion.so", "notion.site"],
      policy: "read-before-write",
      provider: "Notion",
    },
  },
  connection: { connectWith: "slopweaver secrets set notion-token", credentialSets: [["notion-token"]], ordinal: 7 },
  corpus: {
    allSourcesSweep: true,
    alwaysPrivate: false,
    containerScoped: true,
    identityRoster: true,
    missingTokenHint: "set NOTION_TOKEN or $SLOPWEAVER_HOME/secrets/notion-token",
    ordinal: 3,
    progressPhase: true,
    resyncDemand: true,
    upfrontTokenGate: true,
  },
  features: {
    atlas: NOTION_ATLAS_REGISTRATION,
    connect: async () => (await import("../../connect/notion.js")).classifyNotion,
    ingest: async () => (await import("../../corpus/notion/fetch.js")).isDataSourceRowShadow,
    read: async () => (await import("../../live/notion/read.js")).parseNotionReadAddress,
    write: async () => (await import("../../corpus/notion/writeApi.js")).writtenPageOf,
  },
  id: "notion",
  name: "Notion",
  noun: { kind: "source-reading" },
  routing: [
    {
      capability: {
        availability: { kind: "available" },
        command: ["slopweaver", "connect", "notion", "--check"],
        coverage: {
          detail:
            "whether this install's Notion credential reaches the provider, and the exact scopes it holds. The " +
            "READING is the separate act: `slopweaver notion read <id-or-url>` is ONE named page or database as " +
            "the provider has it now. There is NO search here, so a page nobody can name is not reachable " +
            "through this leg — the corpus is. A page read returns its first 100 top-level blocks and " +
            "`--after <cursor>` continues past that ceiling; a database's ROWS are not traversed at all",
          kind: "bounded",
        },
        effect: "read",
        freshness: { detail: "read directly from Notion when the planned command runs", kind: "live" },
        id: "notion-live",
        owner: "slopweaver",
        sourceClass: "provider",
        terms: ["notion", "sop", "runbook", "wiki", "page", "notion page", "notion database"],
        truthMode: "current",
        what: "the current contents of one named Notion page or database — the SOPs, runbooks and proposals this org writes down",
      },
      ordinal: 17,
    },
  ],
  sharedRead: true,
} as const satisfies IntegrationManifest;

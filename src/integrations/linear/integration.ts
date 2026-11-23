/** The Linear integration's manifest — strings, its atlas row and `import()` thunks only. */
import { LINEAR_ATLAS_REGISTRATION } from "../../atlas/linear/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The linear row of the integration registry. */
export const LINEAR_INTEGRATION = {
  browserWrite: {
    ordinal: 2,
    row: {
      door: "slopweaver linear read / issue / comment / project",
      hosts: ["linear.app"],
      policy: "read-before-write",
      provider: "Linear",
    },
  },
  connection: { connectWith: "slopweaver secrets set linear-token", credentialSets: [["linear-token"]], ordinal: 6 },
  corpus: {
    allSourcesSweep: true,
    alwaysPrivate: false,
    containerScoped: true,
    identityRoster: true,
    missingTokenHint: "set LINEAR_TOKEN or $SLOPWEAVER_HOME/secrets/linear-token",
    ordinal: 2,
    progressPhase: true,
    resyncDemand: true,
    upfrontTokenGate: true,
  },
  features: {
    atlas: LINEAR_ATLAS_REGISTRATION,
    connect: async () => (await import("../../connect/linear.js")).classifyLinear,
    ingest: async () => (await import("../../corpus/linear/fetch.js")).fetchLinearActivity,
    read: async () => (await import("../../live/linear/read.js")).parseLinearReadAddress,
    write: async () => (await import("../../corpus/linear/write.js")).makeLinearSendContext,
  },
  id: "linear",
  name: "Linear",
  noun: { kind: "source-reading" },
  routing: [
    {
      capability: {
        availability: { kind: "available" },
        command: ["slopweaver", "connect", "linear", "--check"],
        coverage: {
          detail:
            "whether this install's Linear credential reaches the provider, and the exact scopes it holds. The " +
            "READING is the separate act: `slopweaver linear read <id-or-url>` is ONE named issue, project or " +
            "document as the provider has it now; `slopweaver linear query --assignee me --state-type started` " +
            "answers a FACET question from the local corpus and then verifies the page it cites against live " +
            "Linear (`--no-verify` skips that and SAYS so); `slopweaver linear search <term>` runs Linear's own " +
            "search; `linear states` is a team's workflow state ids",
          kind: "bounded",
        },
        effect: "read",
        freshness: { detail: "read directly from Linear when the planned command runs", kind: "live" },
        id: "linear-live",
        owner: "slopweaver",
        sourceClass: "provider",
        terms: ["ticket", "tickets", "linear", "cycle", "sprint", "assignee", "backlog", "initiative", "milestone"],
        truthMode: "current",
        what: "the current state of one named Linear issue, project or document, and the cycle, team and assignee facets a query answers",
      },
      ordinal: 16,
    },
  ],
  sharedRead: true,
} as const satisfies IntegrationManifest;

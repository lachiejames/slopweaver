/** The Hex integration's manifest — strings, its atlas row and `import()` thunks only. */
import { HEX_ATLAS_REGISTRATION } from "../../atlas/hex/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The hex row of the integration registry. */
export const HEX_INTEGRATION = {
  connection: { connectWith: "slopweaver secrets set hex-api-token", credentialSets: [["hex-api-token"]], ordinal: 10 },
  features: {
    atlas: HEX_ATLAS_REGISTRATION,
    read: async () => (await import("../../hex/reads.js")).HEX_PAGE_MAX,
  },
  id: "hex",
  name: "Hex",
  noun: { kind: "source-reading" },
  routing: [
    {
      capability: {
        availability: { kind: "available" },
        // Hex mints no read-only token, so `hex verify` answers who the token is and what role it CARRIES.
        command: ["slopweaver", "hex", "verify"],
        coverage: {
          detail:
            "who this install's Hex token is and what role it carries. The READING is the separate act: " +
            "`slopweaver hex projects --query <words>` finds the notebook somebody has usually already written, " +
            "`hex project <id> --tables` names the warehouse tables its cells query, `hex cells --project <id> " +
            "--sql-only` is the SQL itself, `hex output` is the rows a cell last produced — printed and stored " +
            "NOWHERE, because Hex is read and never ingested — and `hex runs` is how a reader dates them. This " +
            "is the leg for a question further back than Datadog's fifteen days",
          kind: "bounded",
        },
        effect: "read",
        freshness: { detail: "read directly from Hex when the planned command runs", kind: "live" },
        id: "hex",
        owner: "slopweaver",
        sourceClass: "provider",
        terms: ["warehouse", "how many", "affected", "notebook", "notebooks", "hex", "bigquery", "data app", "cohort"],
        truthMode: "current",
        what: "the masked, access-controlled view over the org's warehouse — who was affected, how many, and over what window, out of a notebook somebody already wrote",
      },
      ordinal: 20,
    },
  ],
} as const satisfies IntegrationManifest;

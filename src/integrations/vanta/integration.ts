/** The Vanta integration's manifest — strings, its atlas row and `import()` thunks only. */
import { VANTA_ATLAS_REGISTRATION } from "../../atlas/vanta/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The vanta row of the integration registry. */
export const VANTA_INTEGRATION = {
  accessReview: {
    ordinal: 3,
    role: "roster-spine",
    spec: {
      display: "Vanta",
      emailPath: ["emailAddress"],
      displayPath: ["name", "display"],
      holds: [{ label: "employment status", whenValue: ["CURRENT"] }],
      kind: "person",
      levels: [
        { label: "employment status", path: ["employment", "status"] },
        { label: "employment end date", path: ["employment", "endDate"] },
        { label: "job title", path: ["employment", "jobTitle"] },
      ],
      platform: "vanta",
      surfaceFamily: null,
    },
  },
  browserWrite: {
    ordinal: 4,
    row: {
      door: "slopweaver atlas vanta shot --control <id> (photographs ONE control at its own address and refuses an id the atlas cannot place — a picture of the controls INDEX proves nothing about one control) / atlas vanta vulnerabilities (--html for a screenshot-able findings list) / atlas vanta render [--out <path>] (screenshot-able HTML of what the atlas ALREADY STORED, reaching Vanta not at all — so `atlas vanta walk` is what photographs a live page into it first, and render alone shows you nothing nobody walked) / atlas vanta read / atlas vanta sync / write vanta deactivate",
      hosts: ["vanta.com"],
      policy: "read-before-write",
      provider: "Vanta",
    },
  },
  connection: {
    connectWith: "slopweaver secrets set vanta-client-id and vanta-client-secret",
    credentialSets: [["vanta-client-id", "vanta-client-secret"]],
    ordinal: 9,
  },
  features: {
    atlas: VANTA_ATLAS_REGISTRATION,
  },
  id: "vanta",
  name: "Vanta",
} as const satisfies IntegrationManifest;

/** The 1Password integration's manifest — strings, its atlas row and `import()` thunks only. */
import { ONEPASSWORD_ATLAS_REGISTRATION } from "../../atlas/onepassword/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The onepassword row of the integration registry. */
export const ONEPASSWORD_INTEGRATION = {
  accessReview: {
    ordinal: 2,
    role: "access-level",
    spec: {
      display: "1Password",
      emailPath: ["email"],
      displayPath: ["name"],
      holds: [{ label: "state", whenValue: ["ACTIVE"] }],
      kind: "user",
      levels: [
        { label: "state", path: ["state"] },
        { label: "type", path: ["type"] },
        { label: "last auth", path: ["last_auth_at"] },
      ],
      platform: "onepassword",
      surfaceFamily: null,
    },
  },
  features: {
    atlas: ONEPASSWORD_ATLAS_REGISTRATION,
  },
  id: "onepassword",
  name: "1Password",
  noun: { kind: "not-a-source", reason: "syncs the onepassword atlas; `atlas onepassword` is the read" },
} as const satisfies IntegrationManifest;

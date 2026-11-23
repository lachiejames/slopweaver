/** The JumpCloud integration's manifest — strings, its atlas row and `import()` thunks only. */
import { JUMPCLOUD_ATLAS_REGISTRATION } from "../../atlas/jumpcloud/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The jumpcloud row of the integration registry. */
export const JUMPCLOUD_INTEGRATION = {
  accessReview: {
    ordinal: 0,
    role: "access-level",
    spec: {
      display: "JumpCloud",
      emailPath: ["email"],
      displayPath: ["displayname"],
      holds: [{ label: "state", whenValue: ["ACTIVATED"] }],
      kind: "systemusers",
      levels: [
        { label: "state", path: ["state"] },
        { label: "suspended", path: ["suspended"] },
        { label: "console role", path: ["admin", "roleName"] },
        { label: "mfa configured", path: ["mfa", "configured"] },
        { label: "totp enrolled", path: ["totp_enabled"] },
        { label: "mfa enrollment", path: ["mfaEnrollment", "overallStatus"] },
        { label: "department", path: ["department"] },
        { label: "job title", path: ["jobTitle"] },
      ],
      platform: "jumpcloud",
      surfaceFamily: "v1-systemusers-get",
    },
  },
  browserWrite: {
    ordinal: 6,
    row: {
      door: null,
      hosts: ["jumpcloud.com"],
      policy: "refuse-every-write",
      provider: "JumpCloud",
    },
  },
  features: {
    atlas: JUMPCLOUD_ATLAS_REGISTRATION,
  },
  id: "jumpcloud",
  name: "JumpCloud",
} as const satisfies IntegrationManifest;

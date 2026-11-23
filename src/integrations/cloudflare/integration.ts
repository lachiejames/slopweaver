/** The Cloudflare integration's manifest — strings, its atlas row and `import()` thunks only. */
import { CLOUDFLARE_ATLAS_REGISTRATION } from "../../atlas/cloudflare/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The cloudflare row of the integration registry. */
export const CLOUDFLARE_INTEGRATION = {
  accessReview: {
    ordinal: 1,
    role: "access-level",
    spec: {
      display: "Cloudflare Access",
      emailPath: ["email"],
      displayPath: ["name"],
      holds: [
        { label: "access seat", whenValue: ["true"] },
        { label: "gateway seat", whenValue: ["true"] },
      ],
      kind: "access-user",
      levels: [
        { label: "access seat", path: ["accessSeat"] },
        { label: "gateway seat", path: ["gatewaySeat"] },
        { label: "last successful login", path: ["lastSuccessfulLogin"] },
      ],
      platform: "cloudflare",
      surfaceFamily: null,
    },
  },
  features: {
    atlas: CLOUDFLARE_ATLAS_REGISTRATION,
  },
  id: "cloudflare",
  name: "Cloudflare",
  noun: { kind: "not-a-source", reason: "syncs the cloudflare atlas; `atlas cloudflare` is the read" },
} as const satisfies IntegrationManifest;

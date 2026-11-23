/** The Prisma Data Platform integration's manifest — strings, its atlas row and `import()` thunks only. */
import { PRISMA_DATA_PLATFORM_ATLAS_REGISTRATION } from "../../atlas/prismaDataPlatform/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The prisma-data-platform row of the integration registry. */
export const PRISMA_DATA_INTEGRATION = {
  features: {
    atlas: PRISMA_DATA_PLATFORM_ATLAS_REGISTRATION,
  },
  id: "prisma-data-platform",
  name: "Prisma Data Platform",
} as const satisfies IntegrationManifest;

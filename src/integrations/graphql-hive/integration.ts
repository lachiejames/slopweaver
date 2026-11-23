/** The GraphQL Hive integration's manifest — strings, its atlas row and `import()` thunks only. */
import { GRAPHQL_HIVE_ATLAS_REGISTRATION } from "../../atlas/graphqlHive/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The graphql-hive row of the integration registry. */
export const GRAPHQL_HIVE_INTEGRATION = {
  features: {
    atlas: GRAPHQL_HIVE_ATLAS_REGISTRATION,
  },
  id: "graphql-hive",
  name: "GraphQL Hive",
} as const satisfies IntegrationManifest;

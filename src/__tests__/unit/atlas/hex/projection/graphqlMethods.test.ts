/*
 * `projectHexGraphqlMethods`: the forty-eight GraphQL operations the shipped client bundle names, each with its
 * observational flag, its exclusion sentence by kind, and the withholding of a computed-result query.
 */
import { describe, expect, it } from "vitest";

import { HEX_CLIENT_SURFACE } from "../../../../../atlas/hex/generated/clientSurface.js";
import type { HexAtlasEntity } from "../../../../../atlas/hex/model.js";
import { projectHexGraphqlMethods } from "../../../../../atlas/hex/projection.js";
import { AT, apiEntity, ORIGIN } from "./harness.js";

/** The reason the projection stores on a GraphQL operation whose name says it returns a computed result. */
const WITHHELD_GRAPHQL_REASON =
  "this operation's name says it returns a computed result — a cell's output content or a preview of " +
  "one — which by the owner's rule is customer data this atlas never stores. The " +
  "operation is catalogued as callable and its body is never fetched or described";

describe("projectHexGraphqlMethods", () => {
  const projected = projectHexGraphqlMethods({ at: AT });
  const byProviderId = ({ providerId }: { providerId: string }): HexAtlasEntity =>
    projected.find((entity) => entity.providerId === providerId)!;

  it("projects exactly the forty-eight client operations, sorted by provider id", () => {
    expect(projected.map((entity) => entity.providerId)).toEqual([
      "GRAPHQL AcquireLock",
      "GRAPHQL AuthorizeCliDevice",
      "GRAPHQL CalcPreview",
      "GRAPHQL DataConnectionOAuthMigrationProgress",
      "GRAPHQL DataConnectionRefresh",
      "GRAPHQL DataConnectionRefreshProgress",
      "GRAPHQL DataSourceColumnById",
      "GRAPHQL DataSourceSchemaTables",
      "GRAPHQL DataSourceTableById",
      "GRAPHQL FetchBigQueryAccessTokenForSuccessView",
      "GRAPHQL FetchDatabricksAccessTokenForSuccessView",
      "GRAPHQL FetchSnowflakeAccessTokenForSuccessView",
      "GRAPHQL GetCompletions",
      "GRAPHQL GetCompletionsV2",
      "GRAPHQL GetDataConnectionDetailsForSqlCompletionProvider",
      "GRAPHQL GetDataConnectionInfoForDataSourceTooltip",
      "GRAPHQL GetDataConnectionStatusForSchemaBrowser",
      "GRAPHQL GetHexVersion",
      "GRAPHQL GetOrgDataConnectionsForSqlCell",
      "GRAPHQL GetPersonaForWorkspacePicker",
      "GRAPHQL GetPossibleSecretsGraph",
      "GRAPHQL GetSchemasForSqlCell",
      "GRAPHQL GetSharedProjectDataConnectionsForSqlCell",
      "GRAPHQL GetSnowflakeOAuthConnectionById",
      "GRAPHQL ObjectPinned",
      "GRAPHQL OrgDetails",
      "GRAPHQL OrgsClient",
      "GRAPHQL OrgsPickerClient",
      "GRAPHQL OutputContentById",
      "GRAPHQL PinnedSchemas",
      "GRAPHQL PinnedSemanticDatasets",
      "GRAPHQL PinnedSemanticViews",
      "GRAPHQL PinnedTables",
      "GRAPHQL PinSchema",
      "GRAPHQL PinTable",
      "GRAPHQL PreemptLock",
      "GRAPHQL ProductVersions",
      "GRAPHQL PromoSignupView",
      "GRAPHQL RefreshSchema",
      "GRAPHQL SearchSchemaElements",
      "GRAPHQL SearchSchemaForSqlCompletionProvider",
      "GRAPHQL SsoLoginWorkspaces",
      "GRAPHQL TestJoinConfig",
      "GRAPHQL TestUniqueKeyConfig",
      "GRAPHQL TrackInlineCompletionEventDisplayed",
      "GRAPHQL TrackInlineCompletionEventReviewed",
      "GRAPHQL UpdateLastSeenDate",
      "GRAPHQL WorkspaceAdmins",
    ]);
  });

  it("carries each client operation's own name and kind into its detail, across all forty-eight", () => {
    const operations = HEX_CLIENT_SURFACE.graphqlOperations.toSorted((left, right) =>
      `GRAPHQL ${left.name}`.localeCompare(`GRAPHQL ${right.name}`),
    );
    expect(new Set(operations.map((operation) => operation.kind)).size).toBe(3);
    expect(projected).toEqual(
      operations.map((operation) =>
        expect.objectContaining({
          channels: expect.objectContaining({
            api: expect.objectContaining({
              detail: expect.objectContaining({
                observational: operation.kind === "query",
                operationId: operation.name,
              }),
            }),
          }),
          providerId: `GRAPHQL ${operation.name}`,
        }),
      ),
    );
  });

  it("projects a mutation as non-observational with the mutation exclusion sentence", () => {
    expect(byProviderId({ providerId: "GRAPHQL AcquireLock" })).toEqual(
      apiEntity({
        deepLink: "https://app.hex.tech/graphql?op=AcquireLock",
        deepLinkStatus: "provider-provided",
        detail: {
          disposition: "entity",
          evidence: "client-bundle",
          excludedBecause: "a GraphQL mutation changes state or opens a stream — this atlas only ever reads",
          host: ORIGIN,
          observational: false,
          operationId: "AcquireLock",
          parameters: [],
          responseFields: [],
          securitySchemes: [],
          withheldBecause: null,
        },
        endpoint: "GRAPHQL AcquireLock",
        kind: "method",
        providerId: "GRAPHQL AcquireLock",
      }),
    );
  });

  it("projects a query as observational with no exclusion", () => {
    expect(byProviderId({ providerId: "GRAPHQL OrgDetails" })).toEqual(
      apiEntity({
        deepLink: "https://app.hex.tech/graphql?op=OrgDetails",
        deepLinkStatus: "provider-provided",
        detail: {
          disposition: "entity",
          evidence: "client-bundle",
          excludedBecause: null,
          host: ORIGIN,
          observational: true,
          operationId: "OrgDetails",
          parameters: [],
          responseFields: [],
          securitySchemes: [],
          withheldBecause: null,
        },
        endpoint: "GRAPHQL OrgDetails",
        kind: "method",
        providerId: "GRAPHQL OrgDetails",
      }),
    );
  });

  it("projects a subscription as non-observational with the subscription exclusion sentence", () => {
    expect(byProviderId({ providerId: "GRAPHQL ObjectPinned" })).toEqual(
      apiEntity({
        deepLink: "https://app.hex.tech/graphql?op=ObjectPinned",
        deepLinkStatus: "provider-provided",
        detail: {
          disposition: "entity",
          evidence: "client-bundle",
          excludedBecause: "a GraphQL subscription changes state or opens a stream — this atlas only ever reads",
          host: ORIGIN,
          observational: false,
          operationId: "ObjectPinned",
          parameters: [],
          responseFields: [],
          securitySchemes: [],
          withheldBecause: null,
        },
        endpoint: "GRAPHQL ObjectPinned",
        kind: "method",
        providerId: "GRAPHQL ObjectPinned",
      }),
    );
  });

  it("withholds a query whose name says it returns a computed result, yet still observes it", () => {
    expect(byProviderId({ providerId: "GRAPHQL CalcPreview" })).toEqual(
      apiEntity({
        deepLink: "https://app.hex.tech/graphql?op=CalcPreview",
        deepLinkStatus: "provider-provided",
        detail: {
          disposition: "withheld",
          evidence: "client-bundle",
          excludedBecause: null,
          host: ORIGIN,
          observational: true,
          operationId: "CalcPreview",
          parameters: [],
          responseFields: [],
          securitySchemes: [],
          withheldBecause: WITHHELD_GRAPHQL_REASON,
        },
        endpoint: "GRAPHQL CalcPreview",
        kind: "method",
        providerId: "GRAPHQL CalcPreview",
      }),
    );
  });
});

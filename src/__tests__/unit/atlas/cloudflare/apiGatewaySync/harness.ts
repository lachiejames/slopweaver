/*
 * The fixtures more than one `syncApiGatewayKind` test file reads: the account, zone and instants a run is
 * stamped at, the kind scope its gaps hang off, and one case per declared API Gateway subtype naming where it is
 * read, what it serves and what an earlier run stored. The fake client lives beside it in `servedClient.ts`, and
 * the stored-file and view helpers in `zoneView.ts`. A plain module, not a `*.test.ts`, so no test registers
 * twice. It was split out when the API Gateway sync suite became one file per behaviour.
 */
import type { CloudflareEntity } from "../../../../../atlas/cloudflare/model.js";
import {
  CLOUDFLARE_API_GATEWAY_SUBTYPES,
  type CloudflareApiGatewaySubtype,
  projectCloudflareApiGatewayConfiguration,
  projectCloudflareApiGatewayLabel,
  projectCloudflareApiGatewayOperation,
  projectCloudflareApiGatewaySettings,
  projectCloudflareDiscoveryOperation,
  projectCloudflareDiscoverySchemaCollection,
  projectCloudflareSchemaCollection,
  projectCloudflareUserSchema,
} from "../../../../../atlas/cloudflare/projection/apiGateway.js";

export const AT = "2026-02-01T00:00:00.000Z";
export const STORED_AT = "2026-01-01T00:00:00.000Z";
export const ACCOUNT_ID: string = "a".repeat(32);
export const ZONE_ID: string = "z".repeat(32);
const ZONE_BASE = `/client/v4/zones/${ZONE_ID}/api_gateway`;
export const KIND_SCOPE: string = `zone/${ZONE_ID}/api-gateway`;

/**
 * What one subtype's endpoint serves: a paged list's items, the single `result` payload of an enveloped
 * response, or a body the SDK hands back whole (its schema-validation `get` does not unwrap `result`).
 */
export type Wire =
  | { readonly shape: "list"; readonly items: readonly unknown[] }
  | { readonly shape: "single"; readonly result: unknown }
  | { readonly shape: "bare"; readonly body: unknown };

/** Everything the tests need to know about one subtype: where it is read, what it serves and what was stored. */
interface SubtypeCase {
  readonly subtype: CloudflareApiGatewaySubtype;
  readonly path: string;
  readonly operation: string;
  readonly wire: Wire;
  readonly providerId: string;
  /** The one detail field whose value tells the stored entity from the freshly read one. */
  readonly markerField: string;
  readonly oldMarker: unknown;
  readonly newMarker: unknown;
  /** The entity an earlier run stored for this subtype in the given zone, at `STORED_AT`. */
  readonly stored: (args: { zoneId: string }) => CloudflareEntity;
}

/** One case per declared subtype; the `Record` key type makes a missing subtype a compile error. */
export const CASES: Record<CloudflareApiGatewaySubtype, SubtypeCase> = {
  configuration: {
    markerField: "authIdCharacteristics",
    newMarker: [{ name: "authorization", type: "header" }],
    oldMarker: [{ name: "x-old-key", type: "header" }],
    operation: "api-gateway-configurations-get",
    path: `${ZONE_BASE}/configuration`,
    providerId: "configuration",
    stored: ({ zoneId }) =>
      projectCloudflareApiGatewayConfiguration({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        authIdCharacteristics: [{ name: "x-old-key", type: "header" }],
        zoneId,
      }),
    subtype: "configuration",
    wire: { result: { auth_id_characteristics: [{ name: "authorization", type: "header" }] }, shape: "single" },
  },
  "discovery-operation": {
    markerField: "endpoint",
    newMarker: "/discovered/new",
    oldMarker: "/discovered/old",
    operation: "api-gateway-discovery-operations-list",
    path: `${ZONE_BASE}/discovery/operations`,
    providerId: "discovery-operation:disc-1",
    stored: ({ zoneId }) =>
      projectCloudflareDiscoveryOperation({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        raw: { endpoint: "/discovered/old", host: "api.example.test", id: "disc-1", method: "GET", state: "review" },
        zoneId,
      }),
    subtype: "discovery-operation",
    wire: {
      items: [{ endpoint: "/discovered/new", host: "api.example.test", id: "disc-1", method: "GET", state: "review" }],
      shape: "list",
    },
  },
  "discovery-schema": {
    markerField: "timestamp",
    newMarker: "2026-02-01T00:00:00Z",
    oldMarker: "2025-12-01T00:00:00Z",
    operation: "api-gateway-discovery-get",
    path: `${ZONE_BASE}/discovery`,
    providerId: "discovery-schema",
    stored: ({ zoneId }) =>
      projectCloudflareDiscoverySchemaCollection({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        schemas: [{ path: "/old" }],
        timestamp: "2025-12-01T00:00:00Z",
        zoneId,
      }),
    subtype: "discovery-schema",
    wire: { result: { schemas: [{ path: "/a" }], timestamp: "2026-02-01T00:00:00Z" }, shape: "single" },
  },
  label: {
    markerField: "description",
    newMarker: "fresh label",
    oldMarker: "stale label",
    operation: "api-gateway-labels-list",
    path: `${ZONE_BASE}/labels`,
    providerId: "label:public",
    stored: ({ zoneId }) =>
      projectCloudflareApiGatewayLabel({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        raw: { description: "stale label", name: "public" },
        zoneId,
      }),
    subtype: "label",
    wire: { items: [{ description: "fresh label", name: "public" }], shape: "list" },
  },
  operation: {
    markerField: "endpoint",
    newMarker: "/orders/new",
    oldMarker: "/orders/old",
    operation: "api-gateway-operations-list",
    path: `${ZONE_BASE}/operations`,
    providerId: "operation:op-1",
    stored: ({ zoneId }) =>
      projectCloudflareApiGatewayOperation({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        raw: { endpoint: "/orders/old", host: "api.example.test", method: "POST", operation_id: "op-1" },
        zoneId,
      }),
    subtype: "operation",
    wire: {
      items: [{ endpoint: "/orders/new", host: "api.example.test", method: "POST", operation_id: "op-1" }],
      shape: "list",
    },
  },
  schema: {
    markerField: "timestamp",
    newMarker: "2026-02-01T00:00:00Z",
    oldMarker: "2025-12-01T00:00:00Z",
    operation: "api-gateway-schemas-list",
    path: `${ZONE_BASE}/schemas`,
    providerId: "schema",
    stored: ({ zoneId }) =>
      projectCloudflareSchemaCollection({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        raw: { timestamp: "2025-12-01T00:00:00Z" },
        schemas: [{ path: "/old" }],
        zoneId,
      }),
    subtype: "schema",
    wire: { result: { schemas: [{ path: "/b" }], timestamp: "2026-02-01T00:00:00Z" }, shape: "single" },
  },
  settings: {
    markerField: "validationDefaultMitigationAction",
    newMarker: "log",
    oldMarker: "none",
    operation: "api-gateway-settings-schema-validation-get",
    path: `${ZONE_BASE}/settings/schema_validation`,
    providerId: "settings",
    stored: ({ zoneId }) =>
      projectCloudflareApiGatewaySettings({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        raw: { validation_default_mitigation_action: "none" },
        zoneId,
      }),
    subtype: "settings",
    wire: { body: { validation_default_mitigation_action: "log" }, shape: "bare" },
  },
  "user-schema": {
    markerField: "name",
    newMarker: "orders-v2.json",
    oldMarker: "orders-v1.json",
    operation: "api-gateway-user-schemas-list",
    path: `${ZONE_BASE}/user_schemas`,
    providerId: "user-schema:sch-1",
    stored: ({ zoneId }) =>
      projectCloudflareUserSchema({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        raw: { name: "orders-v1.json", schema_id: "sch-1" },
        zoneId,
      }),
    subtype: "user-schema",
    wire: { items: [{ name: "orders-v2.json", schema_id: "sch-1" }], shape: "list" },
  },
};

/** Every case, in the declared subtype order. */
export const ALL_CASES: readonly SubtypeCase[] = CLOUDFLARE_API_GATEWAY_SUBTYPES.map((subtype) => CASES[subtype]);

/**
 * What each endpoint the GCP audit-log reader calls is allowed to answer — one strict boundary per endpoint.
 *
 * Proto3's JSON mapping makes every field optional (a default value is omitted) and an `int64` a decimal
 * STRING. A field the reader never reads is declared `unread`, so the key set stays known without the value
 * being trusted or kept; a field Google adds fails that one call with the field named, never reads as absence.
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";

/** A declared key whose value the reader never reads. */
const unread = z.unknown().optional();

/** A Resource Manager v3 `Project`. */
const projectWire = z.strictObject({
  createTime: unread,
  deleteTime: unread,
  displayName: z.string().optional(),
  etag: unread,
  labels: unread,
  name: z.string(),
  parent: z.string().optional(),
  projectId: z.string(),
  state: z.string().optional(),
  tags: unread,
  updateTime: unread,
});

/** `SearchProjectsResponse`. */
export const SEARCH_PROJECTS = defineBoundary({
  endpoint: "GET cloudresourcemanager v3 projects:search",
  schema: z.strictObject({ nextPageToken: z.string().optional(), projects: z.array(projectWire).optional() }),
});

/** A Resource Manager v3 `Folder`. */
const folderWire = z.strictObject({
  configuredCapabilities: unread,
  createTime: unread,
  deleteTime: unread,
  displayName: z.string().optional(),
  etag: unread,
  managementProject: unread,
  // `folders/{id}` by the API's contract; parsed to that shape so the reader can search it as a container.
  name: z.templateLiteral(["folders/", z.string()]),
  parent: z.string().optional(),
  state: z.string().optional(),
  tags: unread,
  updateTime: unread,
});

/** `SearchFoldersResponse`. */
export const SEARCH_FOLDERS = defineBoundary({
  endpoint: "GET cloudresourcemanager v3 folders:search",
  schema: z.strictObject({ folders: z.array(folderWire).optional(), nextPageToken: z.string().optional() }),
});

/** One `AuthorizationInfo` row: the permission Google checked, on what, and whether it was granted. */
const authorizationWire = z.strictObject({
  granted: z.boolean().optional(),
  permission: z.string().optional(),
  permissionType: unread,
  resource: z.string().optional(),
  resourceAttributes: unread,
});

/**
 * The `AuditLog` payload, every documented key declared. The request and response bodies are declared and never
 * read: `trim.ts` keeps the named fields only, so a body reaches memory for one page and never reaches disk. A
 * partial-response mask cannot cut them earlier — `protoPayload` is an `Any`, and `entries:list` answered every
 * `fields` mask reaching inside it with HTTP 400 "Request contains an invalid argument" (measured).
 */
const auditPayloadWire = z.strictObject({
  "@type": z.string().optional(),
  authenticationInfo: z
    .strictObject({
      authoritySelector: unread,
      loggableShortLivedCredential: unread,
      oauthInfo: unread,
      principalEmail: z.string().optional(),
      principalSubject: unread,
      serviceAccountDelegationInfo: unread,
      serviceAccountKeyName: unread,
      serviceDelegationHistory: unread,
      thirdPartyPrincipal: unread,
    })
    .optional(),
  authorizationInfo: z.array(authorizationWire).optional(),
  metadata: unread,
  methodName: z.string().optional(),
  numResponseItems: unread,
  policyViolationInfo: unread,
  request: unread,
  requestMetadata: z
    .strictObject({
      callerIp: z.string().optional(),
      callerNetwork: unread,
      callerSuppliedUserAgent: z.string().optional(),
      destinationAttributes: unread,
      requestAttributes: unread,
    })
    .optional(),
  resourceLocation: unread,
  resourceName: z.string().optional(),
  resourceOriginalState: unread,
  response: unread,
  serviceData: unread,
  serviceName: z.string().optional(),
  status: z.strictObject({ code: z.number().optional(), details: unread, message: unread }).optional(),
});

/** One `LogEntry`, every documented key declared. */
const entryWire = z.strictObject({
  apphub: unread,
  apphubDestination: unread,
  apphubSource: unread,
  errorGroups: unread,
  httpRequest: unread,
  insertId: z.string().optional(),
  jsonPayload: unread,
  labels: unread,
  logName: z.string(),
  operation: unread,
  protoPayload: auditPayloadWire.optional(),
  receiveTimestamp: unread,
  resource: z
    .strictObject({ labels: z.record(z.string(), z.string()).optional(), type: z.string().optional() })
    .optional(),
  severity: unread,
  sourceLocation: unread,
  spanId: unread,
  split: unread,
  textPayload: unread,
  timestamp: z.string(),
  trace: unread,
  traceSampled: unread,
});

/** One `LogEntry`, as the trimmer receives it. */
export type GcpLogEntryWire = z.output<typeof entryWire>;

/** `ListLogEntriesResponse`. */
export const LIST_ENTRIES = defineBoundary({
  endpoint: "POST logging v2 entries:list",
  schema: z.strictObject({ entries: z.array(entryWire).optional(), nextPageToken: z.string().optional() }),
});

/** A `LogBucket`. */
const bucketWire = z.strictObject({
  analyticsEnabled: z.boolean().optional(),
  cmekSettings: unread,
  createTime: unread,
  description: unread,
  indexConfigs: unread,
  lifecycleState: z.string().optional(),
  locked: z.boolean().optional(),
  name: z.string(),
  restrictedFields: unread,
  retentionDays: z.number().optional(),
  updateTime: unread,
});

/** `ListBucketsResponse`. */
export const LIST_BUCKETS = defineBoundary({
  endpoint: "GET logging v2 locations/-/buckets",
  schema: z.strictObject({ buckets: z.array(bucketWire).optional(), nextPageToken: z.string().optional() }),
});

/** A `LogSink`. */
const sinkWire = z.strictObject({
  bigqueryOptions: unread,
  createTime: unread,
  description: unread,
  destination: z.string(),
  disabled: z.boolean().optional(),
  exclusions: unread,
  filter: z.string().optional(),
  includeChildren: z.boolean().optional(),
  interceptChildren: z.boolean().optional(),
  name: z.string(),
  outputVersionFormat: unread,
  resourceName: unread,
  updateTime: unread,
  writerIdentity: unread,
});

/** `ListSinksResponse`. */
export const LIST_SINKS = defineBoundary({
  endpoint: "GET logging v2 sinks",
  schema: z.strictObject({ nextPageToken: z.string().optional(), sinks: z.array(sinkWire).optional() }),
});

/** An IAM `Role`. */
export const GET_ROLE = defineBoundary({
  endpoint: "GET iam v1 roles",
  schema: z.strictObject({
    deleted: z.boolean().optional(),
    description: unread,
    etag: z.string().optional(),
    includedPermissions: z.array(z.string()).optional(),
    name: z.string(),
    stage: z.string().optional(),
    title: z.string().optional(),
  }),
});

/** One `AuditConfig` on an allow policy: which audit log types a service records. */
const auditConfigWire = z.strictObject({
  auditLogConfigs: z
    .array(z.strictObject({ exemptedMembers: z.array(z.string()).optional(), logType: z.string() }))
    .optional(),
  service: z.string(),
});

/** An allow `Policy`. */
export const GET_IAM_POLICY = defineBoundary({
  endpoint: "POST cloudresourcemanager getIamPolicy",
  schema: z.strictObject({
    auditConfigs: z.array(auditConfigWire).optional(),
    bindings: z
      .array(
        z.strictObject({
          condition: z
            .strictObject({
              description: z.string().optional(),
              expression: z.string(),
              title: z.string().optional(),
            })
            .optional(),
          members: z.array(z.string()),
          role: z.string(),
        }),
      )
      .optional(),
    etag: z.string().optional(),
    version: z.number().optional(),
  }),
});

/**
 * What each endpoint the GCP door calls is allowed to answer — one strict boundary per endpoint.
 *
 * Proto3's JSON mapping makes every field optional and an `int64` a decimal STRING. A field the door never reads
 * is declared `unread`, so the key set stays known without the value being trusted; a field Google adds fails
 * that one call with the field named, never reads as absence. A Cloud Run template's unread keys are carried
 * through VERBATIM when a deploy writes the template back, which is why the template is parsed rather than
 * kept opaque: every key it holds is one this file named.
 *
 * The field lists are Google's REST reference (Cloud Run v2 Service, RevisionTemplate, Container, EnvVar) and the live answers of a real project measured through this door.
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";

/** A declared key whose value the door never reads. */
const unread = z.unknown().optional();

/** One environment variable on a container. `value` is carried, never printed. */
const envVarWire = z.strictObject({ name: z.string(), value: z.string().optional(), valueSource: unread });

/** One Cloud Run container, every documented key declared. */
const containerWire = z.strictObject({
  args: unread,
  baseImageUri: unread,
  buildInfo: unread,
  command: unread,
  dependsOn: unread,
  env: z.array(envVarWire).optional(),
  image: z.string(),
  livenessProbe: unread,
  name: z.string().optional(),
  ports: unread,
  readinessProbe: unread,
  resources: unread,
  sandboxLauncher: unread,
  sourceCode: unread,
  startupProbe: unread,
  volumeMounts: unread,
  workingDir: unread,
});

/** A Cloud Run v2 `RevisionTemplate`, every documented key declared. */
const revisionTemplateWire = z.strictObject({
  annotations: unread,
  client: unread,
  clientVersion: unread,
  containers: z.array(containerWire).optional(),
  encryptionKey: unread,
  encryptionKeyRevocationAction: unread,
  encryptionKeyShutdownDuration: unread,
  executionEnvironment: unread,
  gpuZonalRedundancyDisabled: unread,
  healthCheckDisabled: unread,
  labels: unread,
  maxInstanceRequestConcurrency: unread,
  nodeSelector: unread,
  revision: unread,
  scaling: unread,
  serviceAccount: z.string().optional(),
  serviceMesh: unread,
  sessionAffinity: unread,
  timeout: unread,
  volumes: unread,
  vpcAccess: unread,
});

/** A Cloud Run template as the door reads and writes it back. */
export type RunTemplate = z.output<typeof revisionTemplateWire>;

/** A Cloud Run v2 `Condition`, the two keys the door prints. */
const conditionWire = z.strictObject({
  executionReason: unread,
  lastTransitionTime: unread,
  message: z.string().optional(),
  reason: unread,
  revisionReason: unread,
  severity: unread,
  state: z.string().optional(),
  type: unread,
});

/** A Cloud Run v2 `Service`, every documented key declared. */
const runServiceWire = z.strictObject({
  annotations: unread,
  binaryAuthorization: unread,
  buildConfig: unread,
  client: unread,
  clientVersion: unread,
  conditions: unread,
  createTime: z.string().optional(),
  creator: z.string().optional(),
  customAudiences: unread,
  defaultUriDisabled: unread,
  deleteTime: unread,
  description: unread,
  etag: z.string(),
  expireTime: unread,
  generation: z.string().optional(),
  iapEnabled: unread,
  ingress: z.string().optional(),
  invokerIamDisabled: unread,
  labels: unread,
  lastModifier: z.string().optional(),
  latestCreatedRevision: z.string().optional(),
  latestReadyRevision: z.string().optional(),
  launchStage: unread,
  multiRegionSettings: unread,
  name: z.string(),
  observedGeneration: unread,
  reconciling: z.boolean().optional(),
  satisfiesPzs: unread,
  scaling: unread,
  sshEnabled: unread,
  template: revisionTemplateWire,
  terminalCondition: conditionWire.optional(),
  threatDetectionEnabled: unread,
  traffic: unread,
  trafficStatuses: unread,
  uid: unread,
  updateTime: z.string().optional(),
  uri: z.string().optional(),
  urls: unread,
});

/** `GET run v2 services/{service}`. */
export const RUN_SERVICE = defineBoundary({ endpoint: "GET run v2 services/{service}", schema: runServiceWire });

/** A Cloud Run service as read. */
export type RunService = z.output<typeof runServiceWire>;

/** A binding's IAM condition, every documented key declared and carried. */
const conditionExprWire = z.strictObject({
  description: z.string().optional(),
  expression: z.string(),
  location: z.string().optional(),
  title: z.string().optional(),
});

/** One IAM binding. */
const bindingWire = z.strictObject({
  condition: conditionExprWire.optional(),
  members: z.array(z.string()).optional(),
  role: z.string(),
});

/** An IAM `Policy`. `auditConfigs` is carried through a set unchanged and never read. */
const policyWire = z.strictObject({
  auditConfigs: unread,
  bindings: z.array(bindingWire).optional(),
  etag: z.string().optional(),
  version: z.number().int().optional(),
});

/** An IAM policy as read and written. */
export type IamPolicy = z.output<typeof policyWire>;

/** One IAM binding as read and written. */
export type IamBinding = z.output<typeof bindingWire>;

/** `getIamPolicy` / `setIamPolicy`, on any resource the door binds. */
export const IAM_POLICY = defineBoundary({ endpoint: "getIamPolicy|setIamPolicy", schema: policyWire });

/** A `google.longrunning.Operation`. Its `metadata` and `response` are opaque; the door re-reads the resource. */
export const OPERATION = defineBoundary({
  endpoint: "longrunning operation",
  schema: z.strictObject({
    done: z.boolean().optional(),
    error: z
      .strictObject({ code: z.number().int().optional(), details: unread, message: z.string().optional() })
      .optional(),
    metadata: unread,
    name: z.string(),
    response: unread,
  }),
});

/** A Secret Manager `Secret`. */
export const SECRET = defineBoundary({
  endpoint: "GET secretmanager v1 secrets/{secret}",
  schema: z.strictObject({
    annotations: unread,
    createTime: z.string().optional(),
    customerManagedEncryption: unread,
    etag: z.string().optional(),
    expireTime: unread,
    labels: unread,
    name: z.string(),
    replication: unread,
    rotation: unread,
    tags: unread,
    topics: unread,
    ttl: unread,
    versionAliases: unread,
    versionDestroyTtl: unread,
  }),
});

/** A Secret Manager `SecretVersion`. */
const secretVersionWire = z.strictObject({
  clientSpecifiedPayloadChecksum: unread,
  createTime: z.string().optional(),
  customerManagedEncryption: unread,
  destroyTime: unread,
  etag: z.string().optional(),
  name: z.string(),
  replicationStatus: unread,
  scheduledDestroyTime: unread,
  state: z.string().optional(),
});

/** A secret version as read. */
export type SecretVersion = z.output<typeof secretVersionWire>;

/** `GET secretmanager v1 versions/{version}`, `:addVersion` and `:disable`. */
export const SECRET_VERSION = defineBoundary({
  endpoint: "secretmanager v1 secret version",
  schema: secretVersionWire,
});

/** `GET secretmanager v1 secrets/{secret}/versions`. */
export const SECRET_VERSIONS = defineBoundary({
  endpoint: "GET secretmanager v1 secrets/{secret}/versions",
  schema: z.strictObject({
    nextPageToken: z.string().optional(),
    totalSize: unread,
    versions: z.array(secretVersionWire).optional(),
  }),
});

/** `GET secretmanager v1 versions/{version}:access`. The payload is read and checked, never printed. */
export const SECRET_ACCESS = defineBoundary({
  endpoint: "GET secretmanager v1 versions/{version}:access",
  schema: z.strictObject({
    name: z.string(),
    payload: z.strictObject({ data: z.string().optional(), dataCrc32c: z.string().optional() }),
  }),
});

/** An IAM `ServiceAccount`. */
export const SERVICE_ACCOUNT = defineBoundary({
  endpoint: "iam v1 serviceAccounts/{account}",
  schema: z.strictObject({
    description: z.string().optional(),
    disabled: z.boolean().optional(),
    displayName: z.string().optional(),
    email: z.string(),
    etag: unread,
    name: z.string(),
    oauth2ClientId: unread,
    projectId: unread,
    uniqueId: z.string().optional(),
  }),
});

/** A Service Usage `Service`. */
export const API_SERVICE = defineBoundary({
  endpoint: "GET serviceusage v1 services/{service}",
  schema: z.strictObject({ config: unread, name: z.string(), parent: unread, state: z.string().optional() }),
});

/** An Artifact Registry `Repository`. */
export const REPOSITORY = defineBoundary({
  endpoint: "GET artifactregistry v1 repositories/{repository}",
  schema: z.strictObject({
    cleanupPolicies: unread,
    cleanupPolicyDryRun: unread,
    createTime: z.string().optional(),
    description: z.string().optional(),
    disallowUnspecifiedMode: unread,
    dockerConfig: unread,
    format: z.string().optional(),
    kmsKeyName: unread,
    labels: unread,
    mavenConfig: unread,
    mode: unread,
    name: z.string(),
    registryUri: z.string().optional(),
    remoteRepositoryConfig: unread,
    satisfiesPzi: unread,
    satisfiesPzs: unread,
    sizeBytes: unread,
    updateTime: unread,
    virtualRepositoryConfig: unread,
    vulnerabilityScanningConfig: unread,
  }),
});

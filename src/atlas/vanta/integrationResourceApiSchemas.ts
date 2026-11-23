/**
 * The row shape of `GET /v1/integrations/{integrationId}/resource-kinds/{resourceKind}/resources` — every
 * resource an integration exposes to Vanta, an AWS role, a GitHub pull request and a JumpCloud computer
 * alike.
 *
 * ## The tag does not name the arm, so the FIELD SET does
 *
 * The published document declares the row as `AnyResource`: an `anyOf` over eleven arms, every one
 * `additionalProperties: false`, every one referencing one shared sixteen-value `responseType` enum rather
 * than a literal of its own, and no `discriminator` object. MEASURED on this tenant: the tag and
 * the arm disagree in both directions — `gcp:GCPComputeInstance` answers `responseType: "ComputeInstance"`,
 * an enum value no arm is named for, with the fields of `CloudInfrastructure`; `aws:AwsAccount` answers
 * `"Account"` with the fields of `AwsAccount`. So `z.discriminatedUnion("responseType", …)` cannot be
 * written from the document, and a map from tag to arm would be a guess the next integration breaks.
 *
 * What CAN be written is a union of the eleven strict arms, and it is unambiguous for a reason worth stating
 * rather than trusting: every arm's one optional field is the same `deletedDate`, and no two arms share a
 * REQUIRED set, so under `.strict()` at most one arm accepts any row. The shape decides the arm.
 *
 * ## A row no single arm accepts is stored, and named; a key no arm declares is refused
 *
 * The fan-out is all-or-nothing per kind, so one row a strict union refused would cost every row of the kind.
 * That is not hypothetical: the whole-API probe once read an `onepassword:OnePasswordAccount` row
 * missing fields the `Account` arm requires, and a real page of 25 could not reproduce it. So the
 * boundary reads ONE strict object over the union of every arm's keys, the arm-specific ones optional, and
 * `vantaUndeclaredResourceFields` names the field set of any row no single arm accepts, which
 * `childCensus.ts` turns into a `schema-drift` gap. A recombination of known fields arrives visible and
 * stored; a field no arm declares at all is drift the boundary refuses by name, because no arm here could say
 * what it means.
 *
 * Transcribed from the document served at `generated/specLock.ts`'s pinned URL; reproduce
 * with `jq '.components.schemas.AnyResource' manage-vanta.json`.
 */
import { z } from "zod";

/** Every value the document's shared `ResourceResponseType` enum declares. */
const VANTA_RESOURCE_RESPONSE_TYPES = [
  "Account",
  "AutoScalingGroup",
  "ClusterDeployment",
  "ComputeInstance",
  "ContainerCluster",
  "ContainerRepository",
  "Database",
  "Device",
  "GitRepository",
  "KubernetesCluster",
  "LoadBalancer",
  "PaaS",
  "Resource",
  "Queue",
  "ServerlessFunction",
  "StorageBucket",
] as const;

/** The nine fields every arm requires, plus the one optional field every arm shares. */
const resourceBase = {
  connectionId: z.string().nullable(),
  creationDate: z.string(),
  deletedDate: z.string().nullable().optional(),
  description: z.string().nullable(),
  displayName: z.string(),
  inScope: z.boolean(),
  owner: z.string().nullable(),
  resourceId: z.string(),
  resourceKind: z.string(),
  responseType: z.enum(VANTA_RESOURCE_RESPONSE_TYPES),
};

/** What `Account` and `AwsAccount` add to the base. */
const accountFields = {
  accountName: z.string(),
  groups: z.array(z.string()),
  isDeactivated: z.boolean(),
  isMfaEnabled: z.boolean().nullable(),
  roles: z.array(z.string()),
};

/** Every arm of `AnyResource`, keyed by the document's own schema name, each strict. */
export const VANTA_RESOURCE_ARMS = {
  Account: z.object({ ...resourceBase, ...accountFields }).strict(),
  AwsAccount: z
    .object({
      ...resourceBase,
      ...accountFields,
      accessKeys: z.array(z.object({ accessKeyId: z.string(), status: z.string() }).strict()),
      awsAccountNumber: z.string(),
      awsUserAccountId: z.string(),
    })
    .strict(),
  CloudInfrastructure: z.object({ ...resourceBase, account: z.string(), region: z.string() }).strict(),
  ContainerRepository: z
    .object({ ...resourceBase, account: z.string(), isAutoscanEnabled: z.boolean().nullable(), region: z.string() })
    .strict(),
  Database: z
    .object({
      ...resourceBase,
      account: z.string(),
      areBackupsEnabled: z.boolean().nullable(),
      containsEphi: z.boolean().nullable(),
      containsUserData: z.boolean().nullable(),
      isEncrypted: z.boolean(),
    })
    .strict(),
  Device: z
    .object({
      ...resourceBase,
      containsEphi: z.boolean().nullable(),
      containsUserData: z.boolean().nullable(),
      isEncrypted: z.boolean().nullable(),
      operatingSystemName: z.string(),
    })
    .strict(),
  OrganizationSubunit: z.object({ ...resourceBase, accountId: z.string().nullable() }).strict(),
  PaaS: z
    .object({ ...resourceBase, containsEphi: z.boolean().nullable(), containsUserData: z.boolean().nullable() })
    .strict(),
  Queue: z
    .object({
      ...resourceBase,
      account: z.string(),
      containsEphi: z.boolean().nullable(),
      containsUserData: z.boolean().nullable(),
      region: z.string(),
    })
    .strict(),
  Resource: z.object(resourceBase).strict(),
  StorageBucket: z
    .object({
      ...resourceBase,
      account: z.string(),
      containsEphi: z.boolean().nullable(),
      containsUserData: z.boolean().nullable(),
      isEncrypted: z.boolean(),
      isVersioned: z.boolean().nullable(),
      region: z.string(),
    })
    .strict(),
} as const;

/** The document's name for one arm of `AnyResource`. */
export type VantaResourceArm = keyof typeof VANTA_RESOURCE_ARMS;

/**
 * One integration resource, as the boundary reads it: ONE strict object whose keys are every arm's keys, the
 * nine base fields required and every arm-specific field optional. MEASURED across every row the
 * generation stores, in every field set those rows carry: every row carries the nine base fields, and no row carries a key
 * outside the union below. A key Vanta adds to ANY arm refuses the page by name; a row whose key set no
 * single arm declares is still read, and {@link vantaUndeclaredResourceFields} names it as `schema-drift`.
 *
 * `responseType` is a string here rather than the document's enum, deliberately and as the one relaxation: a
 * tag outside the enum changes no field a reader uses, so no strict arm accepts the row and
 * {@link vantaUndeclaredResourceFields} names it as `schema-drift`, stored and visible, where the enum would
 * refuse every row of the kind. An unknown KEY is a field nothing reads, so it refuses. Which arm a row fits
 * is {@link vantaResourceArmsAccepting}'s question, asked of the strict arms, which keep the enum.
 */
export const vantaIntegrationResourceDtoSchema = z.strictObject({
  ...resourceBase,
  accessKeys: z.array(z.strictObject({ accessKeyId: z.string(), status: z.string() })).optional(),
  account: z.string().optional(),
  accountId: z.string().nullable().optional(),
  accountName: z.string().optional(),
  areBackupsEnabled: z.boolean().nullable().optional(),
  awsAccountNumber: z.string().optional(),
  awsUserAccountId: z.string().optional(),
  containsEphi: z.boolean().nullable().optional(),
  containsUserData: z.boolean().nullable().optional(),
  groups: z.array(z.string()).optional(),
  isAutoscanEnabled: z.boolean().nullable().optional(),
  isDeactivated: z.boolean().optional(),
  isEncrypted: z.boolean().nullable().optional(),
  isMfaEnabled: z.boolean().nullable().optional(),
  isVersioned: z.boolean().nullable().optional(),
  operatingSystemName: z.string().optional(),
  region: z.string().optional(),
  responseType: z.string(),
  roles: z.array(z.string()).optional(),
});

export type VantaIntegrationResourceDto = z.infer<typeof vantaIntegrationResourceDtoSchema>;

/**
 * Every declared arm that accepts one row — exactly one for any row the document describes.
 *
 * @param row the row as Vanta returned it
 * @returns the accepting arms' names, in the document's order
 */
export function vantaResourceArmsAccepting({ row }: { row: unknown }): readonly VantaResourceArm[] {
  return Object.entries(VANTA_RESOURCE_ARMS)
    .filter(([, schema]) => schema.safeParse(row).success)
    .map(([name]) => name)
    .filter((name): name is VantaResourceArm => name in VANTA_RESOURCE_ARMS);
}

/**
 * The sorted field names of a row no declared arm accepts — the shape a `schema-drift` gap names — or
 * `null` for a row the document describes. Field NAMES only, never a value.
 *
 * @param row the row as Vanta returned it
 * @returns the undeclared shape's field names, or `null`
 */
export function vantaUndeclaredResourceFields({ row }: { row: unknown }): readonly string[] | null {
  if (vantaResourceArmsAccepting({ row }).length > 0 || typeof row !== "object" || row === null) {
    return null;
  }
  return Object.keys(row).toSorted();
}

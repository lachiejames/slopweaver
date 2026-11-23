/**
 * The GitHub atlas's generation documents — one kind file per kind, and the manifest that grades them — and
 * the builders every surface publishes through. The entity schemas these documents hold stay in
 * `entities.ts`; this module only assembles them into what `store.ts` writes.
 *
 * ## Coverage and gaps live in the kind FILE, not the manifest
 *
 * The manifest grades whether a kind was written; the file carries what the atlas knows it does NOT know
 * about that kind. Keeping them together is what lets `atlas github coverage` answer per kind without a
 * second document to keep in step, and it is the shape every sibling atlas already writes.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";

import { coverageCellSchemaFor, gapSchemaFor, manifestSchemaFor } from "../kit/generationSchemas.js";

import {
  githubActionsPolicySchema,
  githubAdminPageSchema,
  githubAppInstallationSchema,
  githubCodeScanningDefaultSetupSchema,
  githubCodeSecurityConfigurationSchema,
  githubCustomPropertyDefinitionSchema,
  githubCustomRepositoryRoleSchema,
  githubDeployKeySchema,
  githubEnvironmentSchema,
  githubOrganizationSettingsSchema,
  githubRepositoryLabelSchema,
  githubRepositorySecuritySettingsSchema,
  githubRepositorySettingsSchema,
  githubRestOperationSchema,
  githubRulesetSchema,
  githubSecretNameSchema,
  githubVariableNameSchema,
  githubWebhookSchema,
  githubWebRequestSchema,
  isoSchema,
} from "./entities.js";
import {
  GITHUB_GAP_CONDITIONS,
  GITHUB_KINDS,
  GITHUB_SCHEMA_VERSION,
  GITHUB_SURFACES,
  type GithubKind,
} from "./model.js";

/**
 * One coverage cell and one gap, as this atlas stores them.
 *
 * Built from `kit/generationSchemas.ts` rather than written out, because the SHAPE is the kit's — it is
 * what `kit/store.ts` and `kit/coverage.ts` operate on — and only three fields are this platform's: which
 * surfaces, which gap conditions, which kinds. Taking those as arguments keeps the stored documents exactly
 * as strict as if they were spelled here, which a shared schema widening `surface` to `z.string()` would
 * not: that would let another atlas's surface name into a GitHub generation and be caught by nothing.
 */
const githubCoverageCellSchema = coverageCellSchemaFor({ surfaces: GITHUB_SURFACES });

export type GithubCoverageCell = z.infer<typeof githubCoverageCellSchema>;

/** One gap, as this atlas stores it. See {@link githubCoverageCellSchema} on why it is built rather than written. */
const githubGapSchema = gapSchemaFor({
  conditions: GITHUB_GAP_CONDITIONS,
  kinds: GITHUB_KINDS,
  surfaces: GITHUB_SURFACES,
});

export type GithubGap = z.infer<typeof githubGapSchema>;

/** What every kind file carries besides its own entities. */
const kindFileEnvelope = {
  coverage: z.array(githubCoverageCellSchema),
  gaps: z.array(githubGapSchema),
  schemaVersion: z.literal(GITHUB_SCHEMA_VERSION),
  updatedAt: isoSchema,
};

/**
 * One kind file on disk, discriminated by its own kind.
 *
 * A union rather than one loose shape, so a rulesets file cannot hold a webhook and a mis-routed projection
 * fails to publish rather than writing a plausible-looking lie. The kit only requires each entity to carry
 * an `id`; everything stricter here is this platform's own decision.
 *
 * The arms are written out rather than produced by a helper over `kindFileEnvelope`, and the sibling
 * CrowdStrike file records why: with `kind: z.literal(someTypeParameter)` every arm widens to
 * `kind: string`, the union loses its DISCRIMINANT, and narrowing a file on its kind leaves `entities` as
 * the union of every array — so each reader needs a cast to reach a field. The helper compiles; it just
 * silently costs the type its whole value.
 */
export const githubKindFileSchema = z.discriminatedUnion("kind", [
  z
    .object({ ...kindFileEnvelope, entities: z.array(githubRestOperationSchema), kind: z.literal("rest-operation") })
    .strict(),
  z
    .object({
      ...kindFileEnvelope,
      entities: z.array(githubOrganizationSettingsSchema),
      kind: z.literal("organization-settings"),
    })
    .strict(),
  z
    .object({
      ...kindFileEnvelope,
      entities: z.array(githubRepositorySettingsSchema),
      kind: z.literal("repository-settings"),
    })
    .strict(),
  z
    .object({ ...kindFileEnvelope, entities: z.array(githubActionsPolicySchema), kind: z.literal("actions-policy") })
    .strict(),
  z
    .object({
      ...kindFileEnvelope,
      entities: z.array(githubCodeSecurityConfigurationSchema),
      kind: z.literal("code-security-configuration"),
    })
    .strict(),
  z
    .object({
      ...kindFileEnvelope,
      entities: z.array(githubRepositorySecuritySettingsSchema),
      kind: z.literal("repository-security-settings"),
    })
    .strict(),
  z
    .object({
      ...kindFileEnvelope,
      entities: z.array(githubCodeScanningDefaultSetupSchema),
      kind: z.literal("code-scanning-default-setup"),
    })
    .strict(),
  z.object({ ...kindFileEnvelope, entities: z.array(githubRulesetSchema), kind: z.literal("ruleset") }).strict(),
  z.object({ ...kindFileEnvelope, entities: z.array(githubWebhookSchema), kind: z.literal("webhook") }).strict(),
  z.object({ ...kindFileEnvelope, entities: z.array(githubSecretNameSchema), kind: z.literal("secret-name") }).strict(),
  z
    .object({ ...kindFileEnvelope, entities: z.array(githubVariableNameSchema), kind: z.literal("variable-name") })
    .strict(),
  z
    .object({ ...kindFileEnvelope, entities: z.array(githubEnvironmentSchema), kind: z.literal("environment") })
    .strict(),
  z.object({ ...kindFileEnvelope, entities: z.array(githubDeployKeySchema), kind: z.literal("deploy-key") }).strict(),
  z
    .object({
      ...kindFileEnvelope,
      entities: z.array(githubCustomPropertyDefinitionSchema),
      kind: z.literal("custom-property-definition"),
    })
    .strict(),
  z
    .object({
      ...kindFileEnvelope,
      entities: z.array(githubCustomRepositoryRoleSchema),
      kind: z.literal("custom-repository-role"),
    })
    .strict(),
  z
    .object({
      ...kindFileEnvelope,
      entities: z.array(githubAppInstallationSchema),
      kind: z.literal("github-app-installation"),
    })
    .strict(),
  z
    .object({
      ...kindFileEnvelope,
      entities: z.array(githubRepositoryLabelSchema),
      kind: z.literal("repository-label"),
    })
    .strict(),
  z.object({ ...kindFileEnvelope, entities: z.array(githubAdminPageSchema), kind: z.literal("admin-page") }).strict(),
  z.object({ ...kindFileEnvelope, entities: z.array(githubWebRequestSchema), kind: z.literal("web-request") }).strict(),
]);

export type GithubKindFile = z.infer<typeof githubKindFileSchema>;

/** Every entity shape this atlas stores, as one union — what a projection returns before it is filed. */
export type GithubEntity = GithubKindFile["entities"][number];

/** The manifest, written last, that grades every kind file beside it. Kit-shaped; see the coverage cell. */
export const githubManifestSchema = manifestSchemaFor({
  kinds: GITHUB_KINDS,
  schemaVersion: GITHUB_SCHEMA_VERSION,
});

export type GithubManifest = z.infer<typeof githubManifestSchema>;

/**
 * An empty kind file, for a generation that has nothing for a kind yet.
 *
 * @param kind the kind this file is for
 * @param updatedAt this run's ISO timestamp
 * @returns the empty file
 */
export function emptyGithubKindFile({
  kind,
  updatedAt,
}: {
  kind: GithubKindFile["kind"];
  updatedAt: string;
}): GithubKindFile {
  return { coverage: [], entities: [], gaps: [], kind, schemaVersion: GITHUB_SCHEMA_VERSION, updatedAt };
}

/**
 * An empty file for every kind, so a freshly installed generation is complete rather than partial.
 *
 * Built from {@link GITHUB_KINDS} rather than spelled out, because this atlas's kind list is long enough
 * that a literal would be the thing that goes stale when a kind is added.
 *
 * @param at this run's ISO timestamp
 * @returns one empty file per kind
 */
export function emptyGithubKindFiles({ at }: { at: string }): Readonly<Record<GithubKind, GithubKindFile>> {
  const entries = GITHUB_KINDS.map((kind) => [kind, emptyGithubKindFile({ kind, updatedAt: at })] as const);
  // `as`: built from the platform's own exhaustive kind list, which Object.fromEntries widens to string.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return Object.fromEntries(entries) as Record<GithubKind, GithubKindFile>;
}

/**
 * Assemble one kind's file from its parts, refusing a mis-routed entity.
 *
 * The parse is the point rather than a formality: {@link githubKindFileSchema} is a discriminated union, so
 * a webhook that reached the ruleset fold fails HERE rather than being written into `rulesets.json` and
 * read back forever as a ruleset. Both surfaces publish through this one function, because two copies of it
 * were two places for that guard to drift.
 *
 * @param kind the kind this file is for
 * @param entities the merged entity list
 * @param coverage the kind's coverage cells after this run
 * @param gaps the kind's gaps after this run
 * @param at this run's ISO timestamp
 * @returns the file, or why the assembled document is not storable
 */
export function assembleGithubKindFile({
  kind,
  entities,
  coverage,
  gaps,
  at,
}: {
  kind: GithubKindFile["kind"];
  entities: readonly GithubEntity[];
  coverage: readonly GithubCoverageCell[];
  gaps: readonly GithubGap[];
  at: string;
}): Result<GithubKindFile> {
  const parsed = githubKindFileSchema.safeParse({
    coverage,
    entities,
    gaps,
    kind,
    schemaVersion: GITHUB_SCHEMA_VERSION,
    updatedAt: at,
  });
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    parsed.error.issues
      .slice(0, 6)
      .map(
        (issue) =>
          `the ${kind} file this run assembled is not storable — ${issue.path.map(String).join(".")}: ${issue.message}`,
      ),
  );
}

/**
 * A manifest grading every kind as never synced — the starting point of a fresh generation.
 *
 * @param updatedAt this run's ISO timestamp
 * @returns the manifest
 */
export function initialGithubManifest({ updatedAt }: { updatedAt: string }): GithubManifest {
  const entries = GITHUB_KINDS.map(
    (kind) => [kind, { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null }] as const,
  );
  // `as`: built from the platform's own exhaustive kind list, which Object.fromEntries widens to string.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const kinds = Object.fromEntries(entries) as GithubManifest["kinds"];
  return { kinds, schemaVersion: GITHUB_SCHEMA_VERSION, updatedAt };
}

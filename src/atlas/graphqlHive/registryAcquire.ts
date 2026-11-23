/**
 * The registry half of a sync: whether the content query may run at all, and what it read when it did.
 *
 * ## The half is graded, never thrown
 *
 * The introspection is mandatory and its failure fails the run. This half is not: an install with no
 * access token, no organisation slug, or a schema that no longer declares the root field the content query
 * names is the ORDINARY state, so each of those answers a typed outcome carrying the reason a reader can
 * act on rather than an error. `syncGrading.ts` turns the outcome into coverage cells and gaps.
 *
 * ## A reason exists exactly when the half did not sync
 *
 * {@link HiveRegistryHalf} is a union on `outcome`, so a `synced` half carries no reason and every other
 * outcome carries one. That is the shape the publish needs: a gap or a coverage cell for a half that did
 * not run always has a sentence to say, without a placeholder standing in for one that went missing.
 */
import { type HiveClientDeps, hiveGraphql } from "./client.js";
import { type HiveApiError, isHiveCredentialGap } from "./errors.js";
import {
  HIVE_REGISTRY_QUERY,
  HIVE_REGISTRY_ROOT_FIELD,
  type HiveRegistrySurface,
  hiveRegistryVariables,
  reduceHiveRegistry,
  registryQuerySupport,
} from "./registryRead.js";
import type { HiveSchemaSurface } from "./schemaRead.js";

/** Whether the registry half of a run happened, and if not, why not. */
export type HiveRegistryOutcome = "synced" | "not-configured" | "unsupported" | "failed";

/** What the registry half produced: the surface it read, and the reason whenever it did not sync. */
export type HiveRegistryHalf =
  | { readonly outcome: "synced"; readonly reason: null; readonly registry: HiveRegistrySurface }
  | {
      readonly outcome: Exclude<HiveRegistryOutcome, "synced">;
      readonly reason: string;
      readonly registry: HiveRegistrySurface;
    };

/**
 * Run the registry half against this run's own introspection.
 *
 * @param schema this run's introspected surface, which decides whether the content query is declared at all
 * @param deps the transport and the token
 * @param organizationSlugs which organisations to read; the API declares no list field, so a run that names
 *   none can reach no content at all — see `registryRead.ts`
 * @returns the registry read and how the half went, with the reason whenever it did not sync
 */
export async function acquireHiveRegistry({
  schema,
  deps,
  organizationSlugs,
}: {
  schema: HiveSchemaSurface;
  deps: HiveClientDeps;
  organizationSlugs: readonly string[];
}): Promise<HiveRegistryHalf> {
  const support = registryQuerySupport({ surface: schema });
  if (!support.supported) {
    return {
      outcome: "unsupported",
      reason:
        `Hive's schema declares no root \`${HIVE_REGISTRY_ROOT_FIELD}\` field, so this build's content ` +
        `query cannot be sent. The ${String(support.declaredQueryFields.length)} root Query field(s) it ` +
        `does declare are stored as \`operation\` entities — read them with ` +
        "`slopweaver atlas graphql-hive read --kind operation`",
      registry: emptyRegistry(),
    };
  }
  const missing = missingInputs({ organizationSlugs, token: deps.token });
  if (missing !== null) {
    return { outcome: "not-configured", reason: missing, registry: emptyRegistry() };
  }
  return readRegistry({ deps, organizationSlugs });
}

/** The empty registry, for a run whose content half did not happen. */
function emptyRegistry(): HiveRegistrySurface {
  return { organizations: [], projects: [], targets: [] };
}

/**
 * What the content half is missing, or `null` when it can run.
 *
 * Two inputs rather than one, and the message says both, because Hive's public API declares no list field:
 * a token alone cannot enumerate anything, so an organisation slug is as load-bearing as the credential.
 */
function missingInputs({
  token,
  organizationSlugs,
}: {
  token: string | null;
  organizationSlugs: readonly string[];
}): string | null {
  if (token === null) {
    return (
      "no registry access token is configured, so the registry's own organisations, projects and targets " +
      "have never been read. Create one in the console under an organisation's Settings → Access Tokens, " +
      "then run: slopweaver secrets set graphql-hive-token"
    );
  }
  if (organizationSlugs.length === 0) {
    return (
      "no organisation was named, and Hive's public API declares no list field at all — its three root " +
      "Query fields each take a reference, so nothing can be enumerated. Pass --organization <slug> (it " +
      "repeats) or set $HIVE_ORGANIZATION_SLUG"
    );
  }
  return null;
}

/**
 * Read every named organisation, folding the results into one surface.
 *
 * One request per organisation, because the API has no way to ask for several. The first failure stops the
 * pass and is reported as the registry half's outcome: a partial content read published as `synced` would
 * be the exact "green build that lies" this atlas grades against.
 */
async function readRegistry({
  deps,
  organizationSlugs,
}: {
  deps: HiveClientDeps;
  organizationSlugs: readonly string[];
}): Promise<HiveRegistryHalf> {
  const organizations: HiveRegistrySurface["organizations"][number][] = [];
  const projects: HiveRegistrySurface["projects"][number][] = [];
  const targets: HiveRegistrySurface["targets"][number][] = [];
  for (const organizationSlug of organizationSlugs) {
    const content = await hiveGraphql({
      deps,
      query: HIVE_REGISTRY_QUERY,
      variables: hiveRegistryVariables({ organizationSlug }),
    });
    if (content.isErr()) {
      return registryFailure({ error: content.error });
    }
    const read = reduceHiveRegistry({ data: content.value });
    if (read.organizations.length === 0) {
      return {
        outcome: "failed",
        reason: `${HIVE_REGISTRY_ROOT_FIELD} answered null for the organisation named — this token cannot see it`,
        registry: emptyRegistry(),
      };
    }
    organizations.push(...read.organizations);
    projects.push(...read.projects);
    targets.push(...read.targets);
  }
  return { outcome: "synced", reason: null, registry: { organizations, projects, targets } };
}

/** Grade a failed content query, keeping "nothing is configured" apart from "something is broken". */
function registryFailure({ error }: { error: HiveApiError }): HiveRegistryHalf {
  return {
    outcome: isHiveCredentialGap({ error }) ? "not-configured" : "failed",
    reason: error.message,
    registry: emptyRegistry(),
  };
}

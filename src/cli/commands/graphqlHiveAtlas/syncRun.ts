/**
 * `slopweaver atlas graphql-hive sync [--json] [--home <dir>]` — introspect Hive's own GraphQL schema and,
 * when a registry access token exists, read what the registry holds.
 *
 * ## This verb IS the door
 *
 * Doctrine rule 3's own resolution: a `slopweaver` verb that reaches a provider is the door, rather than a
 * way around one. Hive is reached here and nowhere else — the endpoint is a constant in
 * `atlas/graphqlHive/client.ts` and no flag names a host, so a run cannot be pointed at a different
 * registry by its command line.
 *
 * ## Why an unconfigured token is EXIT_EXPECTED_EMPTY rather than an error
 *
 * The owner's access to Hive is an SSO assignment, which signs a browser in and mints no API token. So the
 * surface map syncs and the registry's content does not, and that combination is the ordinary starting
 * state. Reporting it as a failure would train a reader to ignore this verb's exit code; reporting it as
 * success would hide a real, actionable gap. The third code says exactly what happened.
 *
 * The MANDATORY half is the introspection, and its failure is `EXIT_ERROR` however many pages were
 * published. This verb decided its own exit code rather than leaning on the kit back when the kit's
 * `hasUsableCoverage` was existential; that predicate is gone and `kit/mandatoryKinds.ts` now refuses a
 * mixed generation at publish time, but the exit code stays this verb's own — the two answer different
 * questions.
 */
import { type HiveClientDeps, type HiveFetch } from "../../../atlas/graphqlHive/client.js";
import { resolveHiveToken } from "../../../atlas/graphqlHive/credential.js";
import { hiveAtlasPaths } from "../../../atlas/graphqlHive/store.js";
import { type HiveSyncOutcome, syncHiveApiSurface } from "../../../atlas/graphqlHive/sync.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { flagValue, type ParsedFlagTail, parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Hive atlas verb sits: past the runtime, the script, the `atlas` noun and the platform. */
export const HIVE_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const HIVE_SYNC_USAGE =
  "usage: slopweaver atlas graphql-hive sync [--organization <slug[,slug]>] [--json] [--home <dir>]";

/**
 * The production HTTP seam: one `fetch`, and nothing a caller can steer.
 *
 * It takes the URL the client owns, never one assembled here, which is what keeps "no endpoint outside this
 * atlas's two documents is reachable" a property of the code rather than a convention.
 *
 * @returns the fetch implementation the client drives
 *
 * @internal
 */
export function productionHiveFetch(): HiveFetch {
  return async ({ url, headers, body }) => {
    const response = await fetch(url, { body, headers: { ...headers }, method: "POST" });
    return { status: response.status, text: await response.text() };
  };
}

/**
 * The exit code one sync earned.
 *
 * @param outcome what the sync published
 * @returns `EXIT_OK` when both halves ran, `EXIT_EXPECTED_EMPTY` when the registry half is unconfigured or
 *   unsupported, and `EXIT_ERROR` when it was attempted and broke
 */
export function exitCodeForHiveSync({ outcome }: { outcome: HiveSyncOutcome }): number {
  if (outcome.registry === "synced") {
    return EXIT_OK;
  }
  return outcome.registry === "failed" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
}

/**
 * The lines one sync prints.
 *
 * @param outcome what the sync published
 * @returns the report, one line each, ending without a trailing newline
 */
export function renderHiveSyncLines({ outcome }: { outcome: HiveSyncOutcome }): readonly string[] {
  const lines = [
    `graphql-hive api surface — ${String(outcome.operationCount)} operation(s) and ` +
      `${String(outcome.typeCount)} type(s) from one introspection`,
    `registry (${outcome.registry}) — ${String(outcome.organizationCount)} organisation(s), ` +
      `${String(outcome.projectCount)} project(s), ${String(outcome.targetCount)} target(s), ` +
      `${String(outcome.schemasStored)} composed schema(s) stored`,
    `console page map — ${String(outcome.pageCount)} declared address(es), none witnessed until a walk runs`,
  ];
  return outcome.registryReason === null ? lines : [...lines, `  ${outcome.registryReason}`];
}

/**
 * The environment variable consulted when `--organization` names none.
 *
 * @internal
 */
export const HIVE_ORGANIZATION_ENV = "HIVE_ORGANIZATION_SLUG";

/**
 * Split an organisation list into slugs.
 *
 * A comma-separated value rather than a repeatable flag, because `parseFlagTail` keeps one value per key.
 * Blank entries are dropped rather than sent, since an empty selector would ask Hive about an organisation
 * whose slug is the empty string.
 *
 * @param value the raw flag or environment value, or `null` when neither was set
 * @returns the slugs, in the order given, with blanks removed
 */
export function splitOrganizationSlugs({ value }: { value: string | null }): readonly string[] {
  if (value === null) {
    return [];
  }
  return value
    .split(",")
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0);
}

/** What the flag tail resolved to. */
interface SyncOptions {
  readonly home: string;
  readonly json: boolean;
  readonly organizationSlugs: readonly string[];
}

/** Parse the flag tail this verb accepts. */
function parseSyncOptions({
  rest,
  env,
}: {
  rest: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
}): Result<SyncOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "organization"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({
    home: resolveHome({ named: parsed.value.values["home"] }),
    json: parsed.value.flags.has("json"),
    organizationSlugs: splitOrganizationSlugs({ value: organizationSelector({ env, parsed: parsed.value }) }),
  });
}

/** The organisation list asked for: `--organization` when passed, else the environment's, else none named. */
function organizationSelector({
  parsed,
  env,
}: {
  parsed: ParsedFlagTail;
  env: Readonly<Record<string, string | undefined>>;
}): string | null {
  const flagged = flagValue({ name: "organization", parsed });
  if (flagged !== null) {
    return flagged;
  }
  const configured = env[HIVE_ORGANIZATION_ENV];
  if (configured === undefined) {
    return null;
  }
  return configured;
}

/**
 * Run the GraphQL Hive sync.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function graphqlHiveAtlasSyncCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: HIVE_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: HIVE_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ env: process.env, rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: HIVE_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson, organizationSlugs } = options.value;
  const token = resolveHiveToken({ env: process.env, home });
  // A missing token is not a reason to skip the introspection: the surface map needs no credential at all,
  // and refusing the whole run would make an SSO-only install unable to hold Hive's API surface.
  const deps: HiveClientDeps = { fetch: productionHiveFetch(), token: token.isOk() ? token.value : null };
  const published = await syncHiveApiSurface({
    at: new Date().toISOString(),
    deps,
    organizationSlugs,
    paths: hiveAtlasPaths({ home }),
  });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  if (asJson) {
    logger.out({ line: JSON.stringify(published.value, null, 1) });
  } else {
    renderHiveSyncLines({ outcome: published.value }).forEach((line) => {
      logger.out({ line });
    });
  }
  return exitCodeForHiveSync({ outcome: published.value });
}

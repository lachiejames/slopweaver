/**
 * The `pages-project` entity shape — project metadata plus its parent-scoped deployments and custom domains,
 * per the plan's own grouping (`pages-project` deliberately owns both child collections rather than each
 * getting its own top-level kind). Deployments are cursor-exhausted by the SDK's own `V4PagePaginationArray`,
 * the same trusted mechanism every other cursor-paginated reader in this atlas relies on. Domains are a
 * `SinglePage` read with no further cursor — the same shape `gateway-list` items had — so `domainsComplete`
 * compares the read against the project's OWN `domains` name list (returned alongside project metadata,
 * never a second guess) rather than assuming completeness. That declared list always includes the project's
 * built-in `*.pages.dev` subdomain alongside every custom domain, but the `domains.list()` read never returns
 * that default subdomain at all — a live run found a project's declared list one longer than its read for
 * exactly this reason. `declaredDomainNames` excludes the project's own `subdomain`
 * before the comparison; see `projectCloudflarePagesProject`'s own comment at the exact line.
 *
 * The comparison is COVER, never count: complete means every declared name is among the names read. The
 * declared list carries only the domains a project currently serves, while `domains.list()` also returns a
 * `deactivated` or `error` one, so a read may legitimately be a superset. Measured live:
 * one project declared none and read one `deactivated`, another declared one and read it plus one in
 * `error` — count equality called both incomplete and failed every `pages-project` pass
 * (`slopweaver atlas cloudflare coverage --kind pages-project` printed the two reasons). A truncated page still
 * drops a declared, served name, so the check still catches the incompleteness it exists for.
 *
 * The SDK's own `PagesSecretTextEnvVar` interface declares `value: string` for an encrypted environment
 * variable — the same class of risk `projection/access.ts`'s `client_secret` redaction guards against.
 * `redactPagesSecretTextValues` strips `value` from any object shaped `{ type: "secret_text", ... }`, at any
 * nesting depth, unconditionally — never trusting that a project/deployment read already omits it.
 */
import { absentAsEmpty, unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/**
 * Strip `value` from any object shaped like an encrypted Pages environment variable, recursively — see this
 * file's header.
 *
 * @param value the raw value to sanitise
 * @returns the same shape with every secret-text value redacted
 */
function redactPagesSecretTextValues({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactPagesSecretTextValues({ value: item }));
  }
  if (isRecord(value)) {
    if (value["type"] === "secret_text") {
      return { ...value, value: null };
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, redactPagesSecretTextValues({ value: entryValue })]),
    );
  }
  return value;
}

/**
 * Redact an open config bucket (an SDK response's remaining fields, spread out from the stable ones a
 * projection already extracted) without a final unsafe cast — `Object.fromEntries` over a `Record`'s own
 * entries is already exactly `Record<string, unknown>`, so no assertion is needed to hand it back typed.
 *
 * @param value the open config bucket to sanitise
 * @returns the same bucket with every secret-text value redacted
 */
function redactPagesConfigBucket({
  value,
}: {
  value: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [key, redactPagesSecretTextValues({ value: entryValue })]),
  );
}

/** The raw shape `client.pages.projects.list()` returns for one project. */
export interface CloudflareRawPagesProject {
  readonly id: string;
  readonly name: string;
  readonly domains?: readonly string[];
  readonly subdomain?: string;
  readonly framework?: string;
  readonly framework_version?: string;
  readonly production_branch: string;
  readonly uses_functions?: boolean | null;
  readonly latest_deployment?: { readonly id?: string } | null;
  readonly canonical_deployment?: { readonly id?: string } | null;
  readonly [key: string]: unknown;
}

/** The raw shape `client.pages.projects.deployments.list()` returns for one deployment. */
interface CloudflareRawPagesDeployment {
  readonly id: string;
  readonly short_id?: string;
  readonly environment?: string;
  readonly url?: string;
  readonly created_on?: string;
  readonly modified_on?: string;
  readonly aliases?: readonly string[] | null;
  readonly latest_stage?: { readonly name?: string; readonly status?: string };
  readonly [key: string]: unknown;
}

/** The raw shape `client.pages.projects.domains.list()` returns for one domain. */
interface CloudflareRawPagesDomain {
  readonly name: string;
  readonly domain_id?: string;
  readonly status?: string;
  readonly certificate_authority?: string;
  readonly zone_tag?: string;
  readonly validation_data?: { readonly method?: string; readonly status?: string };
  readonly verification_data?: { readonly status?: string };
}

/** One raw child item, before normalization — a project's deployment and domain reads are fanned out and
 * folded back into ONE combined attempt, so a project's own children are tagged by which read produced them. */
export type CloudflarePagesRawChildItem =
  | { readonly itemKind: "deployment"; readonly deployment: CloudflareRawPagesDeployment }
  | { readonly itemKind: "domain"; readonly domain: CloudflareRawPagesDomain };

/** One deployment, as stored. */
interface CloudflarePagesDeploymentDetail {
  readonly id: string;
  readonly shortId: string | null;
  readonly environment: string | null;
  readonly url: string | null;
  readonly createdOn: string | null;
  readonly modifiedOn: string | null;
  readonly aliases: readonly string[];
  readonly latestStageName: string | null;
  readonly latestStageStatus: string | null;
  readonly config: Readonly<Record<string, unknown>>;
}

/** One custom domain, as stored. */
export interface CloudflarePagesDomainDetail {
  readonly name: string;
  readonly domainId: string | null;
  readonly status: string | null;
  readonly certificateAuthority: string | null;
  readonly zoneTag: string | null;
  readonly validationStatus: string | null;
  readonly verificationStatus: string | null;
}

/** One normalized child item — the stored counterpart of {@link CloudflarePagesRawChildItem}. */
export type CloudflarePagesChildItem =
  | { readonly itemKind: "deployment"; readonly deployment: CloudflarePagesDeploymentDetail }
  | { readonly itemKind: "domain"; readonly domain: CloudflarePagesDomainDetail };

/** The detail this atlas stores for the `pages-project` kind. */
export interface CloudflarePagesProjectDetail {
  readonly kind: "pages-project";
  readonly name: string;
  readonly subdomain: string | null;
  readonly framework: string | null;
  readonly frameworkVersion: string | null;
  readonly productionBranch: string;
  readonly usesFunctions: boolean | null;
  readonly latestDeploymentId: string | null;
  readonly canonicalDeploymentId: string | null;
  readonly config: Readonly<Record<string, unknown>>;
  readonly deployments: readonly CloudflarePagesDeploymentDetail[];
  readonly declaredDomainNames: readonly string[];
  readonly domains: readonly CloudflarePagesDomainDetail[];
  /** Whether every `declaredDomainNames` entry was among `domains` the run that produced them — see this
   * file's header. */
  readonly domainsComplete: boolean;
}

/**
 * Narrow a stored entity's `detail` into this domain's shape — the same pattern
 * `projection/accessPolicy.ts`'s `isCloudflareAccessPolicyDetail` established for a `z.unknown()` disk field.
 *
 * @param value the entity's `detail` field, read back from disk
 * @returns true when `value` is a genuine `CloudflarePagesProjectDetail`
 */
export function isCloudflarePagesProjectDetail(value: unknown): value is CloudflarePagesProjectDetail {
  return (
    isRecord(value) &&
    value["kind"] === "pages-project" &&
    typeof value["name"] === "string" &&
    typeof value["productionBranch"] === "string" &&
    Array.isArray(value["deployments"]) &&
    Array.isArray(value["declaredDomainNames"]) &&
    Array.isArray(value["domains"]) &&
    typeof value["domainsComplete"] === "boolean"
  );
}

/**
 * Split a stored project's own deployments/domains back into the combined, tagged child-item shape
 * `reconcileParentFanout`'s `extractStoredChildren` needs.
 *
 * @param detail the stored project detail
 * @returns every deployment and domain, tagged by which collection it came from
 */
export function extractCloudflarePagesChildren({
  detail,
}: {
  detail: CloudflarePagesProjectDetail;
}): readonly CloudflarePagesChildItem[] {
  return [
    ...detail.deployments.map((deployment): CloudflarePagesChildItem => ({ deployment, itemKind: "deployment" })),
    ...detail.domains.map((domain): CloudflarePagesChildItem => ({ domain, itemKind: "domain" })),
  ];
}

/**
 * Normalize one raw child item into its stored shape, redacting any secret-text environment variable value
 * inside a deployment's own open config bucket.
 *
 * @param raw the raw child item, from a project's combined deployments/domains read
 * @returns the item, as stored
 */
export function normalizeCloudflarePagesChildItem({
  raw,
}: {
  raw: CloudflarePagesRawChildItem;
}): CloudflarePagesChildItem {
  if (raw.itemKind === "domain") {
    const domain = raw.domain;
    return {
      domain: {
        certificateAuthority: unsetFieldAsNull({ key: "certificate_authority", record: domain }),
        domainId: unsetFieldAsNull({ key: "domain_id", record: domain }),
        name: domain.name,
        status: unsetFieldAsNull({ key: "status", record: domain }),
        validationStatus: unsetFieldAsNull({ key: "status", record: domain.validation_data }),
        verificationStatus: unsetFieldAsNull({ key: "status", record: domain.verification_data }),
        zoneTag: unsetFieldAsNull({ key: "zone_tag", record: domain }),
      },
      itemKind: "domain",
    };
  }
  const deployment = raw.deployment;
  // Each omitted name beyond `id` and `aliases` is read from `deployment` itself below; destructuring only
  // leaves the rest as open config.
  const {
    id,
    short_id: _shortId,
    environment: _environment,
    url: _url,
    created_on: _createdOn,
    modified_on: _modifiedOn,
    aliases,
    latest_stage: _latestStage,
    ...config
  } = deployment;
  return {
    deployment: {
      aliases: absentAsEmpty({ value: aliases }),
      config: redactPagesConfigBucket({ value: config }),
      createdOn: unsetFieldAsNull({ key: "created_on", record: deployment }),
      environment: unsetFieldAsNull({ key: "environment", record: deployment }),
      id,
      latestStageName: unsetFieldAsNull({ key: "name", record: deployment.latest_stage }),
      latestStageStatus: unsetFieldAsNull({ key: "status", record: deployment.latest_stage }),
      modifiedOn: unsetFieldAsNull({ key: "modified_on", record: deployment }),
      shortId: unsetFieldAsNull({ key: "short_id", record: deployment }),
      url: unsetFieldAsNull({ key: "url", record: deployment }),
    },
    itemKind: "deployment",
  };
}

/**
 * The declared custom domains a read did not return — the cover check `domainsComplete` is, per this file's
 * header. Names compare case-insensitively, as DNS names do.
 *
 * @param declared the project's own declared custom domain names, its `*.pages.dev` subdomain already excluded
 * @param read the domains `domains.list()` returned, served or not
 * @returns every declared name absent from the read, in declared order
 */
export function missingDeclaredPagesDomains({
  declared,
  read,
}: {
  declared: readonly string[];
  read: readonly CloudflarePagesDomainDetail[];
}): readonly string[] {
  const readNames = new Set(read.map((domain) => domain.name.toLowerCase()));
  return declared.filter((name) => !readNames.has(name.toLowerCase()));
}

/**
 * Split this run's combined child items back into their two collections.
 *
 * @param children this project's combined, tagged deployments/domains
 * @returns the deployments and domains, each already unwrapped from their tag
 */
function splitCloudflarePagesChildren({ children }: { children: readonly CloudflarePagesChildItem[] }): {
  deployments: readonly CloudflarePagesDeploymentDetail[];
  domains: readonly CloudflarePagesDomainDetail[];
} {
  return {
    deployments: children
      .filter(
        (item): item is Extract<CloudflarePagesChildItem, { itemKind: "deployment" }> => item.itemKind === "deployment",
      )
      .map((item) => item.deployment),
    domains: children
      .filter((item): item is Extract<CloudflarePagesChildItem, { itemKind: "domain" }> => item.itemKind === "domain")
      .map((item) => item.domain),
  };
}

/**
 * Project one Pages project's metadata and resolved children into a `pages-project` entity.
 *
 * @param raw the project's own metadata, from the inventory read
 * @param children this project's deployments and domains, already normalized — either freshly read this run
 *   or preserved from what was already stored, when this run's own read for this one project failed
 * @param accountId the account this project was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflarePagesProject({
  raw,
  children,
  accountId,
  at,
}: {
  raw: CloudflareRawPagesProject;
  children: readonly CloudflarePagesChildItem[];
  accountId: string;
  at: string;
}): CloudflareEntity {
  // The underscored names are read from `raw` itself below; destructuring only leaves the rest as open config.
  const {
    id,
    name,
    domains,
    subdomain,
    framework: _framework,
    framework_version: _frameworkVersion,
    production_branch,
    uses_functions: _usesFunctions,
    latest_deployment: _latestDeployment,
    canonical_deployment: _canonicalDeployment,
    ...config
  } = raw;
  const { deployments, domains: domainDetails } = splitCloudflarePagesChildren({ children });
  // `raw.domains` always includes the project's built-in `*.pages.dev` subdomain alongside every custom domain,
  // but `domains.list()` — what `domainDetails` came from — never lists that default subdomain, since it isn't a
  // "custom domain" a caller added. Comparing the two directly would report every project with zero custom
  // domains as permanently incomplete; excluding the subdomain makes the comparison mean what its name says. A
  // live run measured exactly this mismatch, project by project, before the exclusion.
  const declaredDomainNames = absentAsEmpty({ value: domains }).filter((domainName) => domainName !== subdomain);
  const detail: CloudflarePagesProjectDetail = {
    canonicalDeploymentId: unsetFieldAsNull({ key: "id", record: raw.canonical_deployment }),
    config: redactPagesConfigBucket({ value: config }),
    declaredDomainNames,
    deployments,
    domains: domainDetails,
    domainsComplete: missingDeclaredPagesDomains({ declared: declaredDomainNames, read: domainDetails }).length === 0,
    framework: unsetFieldAsNull({ key: "framework", record: raw }),
    frameworkVersion: unsetFieldAsNull({ key: "framework_version", record: raw }),
    kind: "pages-project",
    latestDeploymentId: unsetFieldAsNull({ key: "id", record: raw.latest_deployment }),
    name,
    productionBranch: production_branch,
    subdomain: unsetFieldAsNull({ key: "subdomain", record: raw }),
    usesFunctions: unsetFieldAsNull({ key: "uses_functions", record: raw }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: id }, kind: "pages-project" }),
    kind: "pages-project",
    lastSeenAt: at,
    providerId: id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "pages-projects-fanout" },
    state: "observed",
  };
}

/**
 * The `worker-script` entity shape — one script's metadata plus its settings/bindings, source content,
 * deployments, versions, schedules, secret descriptors and `*.workers.dev` subdomain state, per the plan's
 * own grouping. Every one of these eight reads is fanned out and folded as ONE atomic per-script attempt
 * (mirroring `projection/pages.ts`'s combined deployments+domains shape, generalized to more collections) —
 * a failure in any single read fails the whole script's read, rather than partially preserving some
 * collections while losing others.
 *
 * Deployments (`deployments.list`) are paged by hand, every page's `result.deployments` validated at runtime
 * because the SDK's own 7.2.0 pager reads `result.items` instead, and the total read must equal the declared
 * `total_count` (`readers/workerScript.ts`'s `readAllDeployments`). Secrets (`secrets.list`) are a
 * `SinglePage` with no declared count to compare against (unlike `gateway-list`'s own items). Versions
 * (`versions.list`) are cursor-exhausted by the SDK's own `V4PagePagination` — its wire shape nests items
 * under `result.items` rather than treating `result` itself as the array the way `V4PagePaginationArray`
 * does everywhere else in this atlas, but the SDK's own `for await` iteration already accounts for that; it
 * is the same trusted, SDK-owned exhaustion every other cursor-paginated reader here relies on.
 *
 * Source content is stored VERBATIM, by the owner's own explicit choice (matching the plan's literal
 * wording) — see the header of `readers/workerScript.ts` for why that is a real, accepted risk rather than
 * an oversight: arbitrary Worker source code is exactly the kind of place a developer pastes a hardcoded
 * secret, unlike every other structured field this atlas stores.
 *
 * The bindings array (from `scriptAndVersionSettings.get`) is a 32-variant discriminated union; every GET
 * response variant this atlas has checked declares only `{name, type}` for `secret_text`/`secret_key` — no
 * live secret material is reachable through any read this kind uses. `redactWorkerBindings` still strips
 * `text`/`key_base64`/`key_jwk` defensively, at any nesting depth, unconditionally — never trusting that
 * stays true across SDK versions or account/plan tiers, the same posture `projection/pages.ts`'s
 * `redactPagesSecretTextValues` and `projection/access.ts`'s `redactSensitiveConfig` already take.
 */
import { absentAsEmpty, unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";
import type { CloudflareRawWorkerDeployment } from "./workerDeployment.js";

/**
 * Strip `text`/`key_base64`/`key_jwk` from any object shaped like a live Workers secret binding,
 * recursively — see this file's header.
 *
 * @param value the raw value to sanitise
 * @returns the same shape with every live secret field redacted
 */
function redactWorkerBindingSecrets({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactWorkerBindingSecrets({ value: item }));
  }
  if (isRecord(value)) {
    if (value["type"] === "secret_text" || value["type"] === "secret_key") {
      const { text: _text, key_base64: _keyBase64, key_jwk: _keyJwk, ...rest } = value;
      return rest;
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, redactWorkerBindingSecrets({ value: entryValue })]),
    );
  }
  return value;
}

/**
 * Redact a bindings array without a final unsafe cast — see `projection/pages.ts`'s
 * `redactPagesConfigBucket` for why this shape avoids the assertion `redactWorkerBindingSecrets`'s own
 * `unknown` return type would otherwise need.
 *
 * @param bindings the raw bindings array to sanitise
 * @returns the same array with every live secret field redacted
 */
function redactWorkerBindings({ bindings }: { bindings: readonly unknown[] }): readonly unknown[] {
  return bindings.map((binding) => redactWorkerBindingSecrets({ value: binding }));
}

/** The raw shape `client.workers.scripts.list()` returns for one script — `id` IS the script's name. */
export interface CloudflareRawWorkerScript {
  readonly id: string;
  readonly tag?: string;
  readonly created_on?: string;
  readonly modified_on?: string;
  readonly usage_model?: string;
  readonly compatibility_date?: string;
  readonly compatibility_flags?: readonly string[];
  readonly has_assets?: boolean;
  readonly has_modules?: boolean;
  readonly logpush?: boolean;
  readonly tags?: readonly string[] | null;
  readonly migration_tag?: string;
  readonly last_deployed_from?: string;
  readonly [key: string]: unknown;
}

/** One version, as returned by the cursor-exhausted `versions.list`. */
interface CloudflareRawWorkerVersion {
  readonly id?: string;
  readonly number?: number;
  readonly metadata?: { readonly author_email?: string; readonly created_on?: string; readonly [key: string]: unknown };
}

/** One cron schedule, as returned by `schedules.get`. */
interface CloudflareRawWorkerSchedule {
  readonly cron: string;
  readonly created_on?: string;
  readonly modified_on?: string;
}

/** One secret descriptor, as returned by `secrets.list` — metadata only, never a live value. */
interface CloudflareRawWorkerSecret {
  readonly name: string;
  readonly type: string;
  readonly [key: string]: unknown;
}

/** The combined, per-script read this kind fans out atomically — everything but the script's own metadata
 * (which comes from the parent inventory read directly). */
export interface CloudflareRawWorkerScriptBundle {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly bindings: readonly unknown[];
  readonly content: string | null;
  readonly deployments: readonly CloudflareRawWorkerDeployment[];
  readonly versions: readonly CloudflareRawWorkerVersion[];
  readonly schedules: readonly CloudflareRawWorkerSchedule[];
  readonly secrets: readonly CloudflareRawWorkerSecret[];
  readonly subdomainEnabled: boolean | null;
  readonly subdomainPreviewsEnabled: boolean | null;
}

/** One deployment, as stored. */
interface CloudflareWorkerDeploymentDetail {
  readonly id: string;
  readonly createdOn: string | null;
  readonly source: string | null;
  readonly strategy: string | null;
  readonly versions: readonly { readonly percentage: number; readonly versionId: string }[];
  readonly message: string | null;
  readonly triggeredBy: string | null;
  readonly authorEmail: string | null;
}

/** One version, as stored. */
interface CloudflareWorkerVersionDetail {
  readonly id: string | null;
  readonly number: number | null;
  readonly authorEmail: string | null;
  readonly createdOn: string | null;
}

/** One cron schedule, as stored. */
interface CloudflareWorkerScheduleDetail {
  readonly cron: string;
  readonly createdOn: string | null;
  readonly modifiedOn: string | null;
}

/** One secret descriptor, as stored — metadata only. */
interface CloudflareWorkerSecretDetail {
  readonly name: string;
  readonly type: string;
}

/** The full combined bundle, as stored — this kind's `TChild`, one per script. */
export interface CloudflareWorkerScriptBundleDetail {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly bindings: readonly unknown[];
  readonly content: string | null;
  readonly deployments: readonly CloudflareWorkerDeploymentDetail[];
  readonly versions: readonly CloudflareWorkerVersionDetail[];
  readonly schedules: readonly CloudflareWorkerScheduleDetail[];
  readonly secrets: readonly CloudflareWorkerSecretDetail[];
  readonly subdomainEnabled: boolean | null;
  readonly subdomainPreviewsEnabled: boolean | null;
}

/** The detail this atlas stores for the `worker-script` kind. */
export interface CloudflareWorkerScriptDetail extends CloudflareWorkerScriptBundleDetail {
  readonly kind: "worker-script";
  readonly name: string;
  readonly tag: string | null;
  readonly createdOn: string | null;
  readonly modifiedOn: string | null;
  readonly usageModel: string | null;
  readonly compatibilityDate: string | null;
  readonly compatibilityFlags: readonly string[];
  readonly hasAssets: boolean | null;
  readonly hasModules: boolean | null;
  readonly logpush: boolean | null;
  readonly tags: readonly string[];
  readonly migrationTag: string | null;
  readonly lastDeployedFrom: string | null;
  readonly config: Readonly<Record<string, unknown>>;
}

/**
 * Narrow a stored entity's `detail` into this domain's shape — the same pattern
 * `projection/accessPolicy.ts`'s `isCloudflareAccessPolicyDetail` established for a `z.unknown()` disk field.
 *
 * @param value the entity's `detail` field, read back from disk
 * @returns true when `value` is a genuine `CloudflareWorkerScriptDetail`
 */
export function isCloudflareWorkerScriptDetail(value: unknown): value is CloudflareWorkerScriptDetail {
  return (
    isRecord(value) &&
    value["kind"] === "worker-script" &&
    typeof value["name"] === "string" &&
    Array.isArray(value["deployments"]) &&
    Array.isArray(value["versions"]) &&
    Array.isArray(value["schedules"]) &&
    Array.isArray(value["secrets"]) &&
    Array.isArray(value["bindings"])
  );
}

/**
 * Read a stored `worker-script` entity's bundle back out as this kind's `TChild` — always a one-element
 * list, since exactly one bundle exists per script.
 *
 * @param detail the stored entity's own detail
 * @returns the one-element bundle list `reconcileParentFanout` expects
 */
export function extractCloudflareWorkerScriptBundle({
  detail,
}: {
  detail: CloudflareWorkerScriptDetail;
}): readonly CloudflareWorkerScriptBundleDetail[] {
  const {
    settings,
    bindings,
    content,
    deployments,
    versions,
    schedules,
    secrets,
    subdomainEnabled,
    subdomainPreviewsEnabled,
  } = detail;
  return [
    {
      bindings,
      content,
      deployments,
      schedules,
      secrets,
      settings,
      subdomainEnabled,
      subdomainPreviewsEnabled,
      versions,
    },
  ];
}

/**
 * The compatibility flags a script opts into: an omitted list means it opts into none.
 *
 * @param script the raw script
 * @returns the script's own list, or an empty one when it opts into none
 */
function workerScriptCompatibilityFlags({ script }: { script: CloudflareRawWorkerScript }): readonly string[] {
  const flags = unsetFieldAsNull({ key: "compatibility_flags", record: script });
  if (flags === null) {
    return [];
  }
  return flags;
}

/**
 * The tags a script carries: an omitted or null list means it has none.
 *
 * @param script the raw script
 * @returns the script's own list, or an empty one when it has no tags
 */
function workerScriptTags({ script }: { script: CloudflareRawWorkerScript }): readonly string[] {
  const tags = unsetFieldAsNull({ key: "tags", record: script });
  if (tags === null) {
    return [];
  }
  return tags;
}

/**
 * Normalize the combined raw per-script read into its stored bundle shape, redacting the bindings array.
 *
 * @param raw the combined raw read for one script
 * @returns the bundle, as stored
 */
export function normalizeCloudflareWorkerScriptBundle({
  raw,
}: {
  raw: CloudflareRawWorkerScriptBundle;
}): CloudflareWorkerScriptBundleDetail {
  return {
    bindings: redactWorkerBindings({ bindings: raw.bindings }),
    content: raw.content,
    deployments: raw.deployments.map((deployment) => ({
      authorEmail: unsetFieldAsNull({ key: "author_email", record: deployment }),
      createdOn: unsetFieldAsNull({ key: "created_on", record: deployment }),
      id: deployment.id,
      message: unsetFieldAsNull({ key: "workers/message", record: deployment.annotations }),
      source: unsetFieldAsNull({ key: "source", record: deployment }),
      strategy: unsetFieldAsNull({ key: "strategy", record: deployment }),
      triggeredBy: unsetFieldAsNull({ key: "workers/triggered_by", record: deployment.annotations }),
      versions: absentAsEmpty({ value: deployment.versions }).map((version) => ({
        percentage: version.percentage,
        versionId: version.version_id,
      })),
    })),
    schedules: raw.schedules.map((schedule) => ({
      createdOn: unsetFieldAsNull({ key: "created_on", record: schedule }),
      cron: schedule.cron,
      modifiedOn: unsetFieldAsNull({ key: "modified_on", record: schedule }),
    })),
    secrets: raw.secrets.map((secret) => ({ name: secret.name, type: secret.type })),
    settings: raw.settings,
    subdomainEnabled: raw.subdomainEnabled,
    subdomainPreviewsEnabled: raw.subdomainPreviewsEnabled,
    versions: raw.versions.map((version) => ({
      authorEmail: unsetFieldAsNull({ key: "author_email", record: version.metadata }),
      createdOn: unsetFieldAsNull({ key: "created_on", record: version.metadata }),
      id: unsetFieldAsNull({ key: "id", record: version }),
      number: unsetFieldAsNull({ key: "number", record: version }),
    })),
  };
}

/**
 * Project one script's metadata plus its resolved bundle into a `worker-script` entity.
 *
 * @param raw the script's own metadata, from the inventory read
 * @param bundle this script's combined settings/bindings/content/deployments/versions/schedules/secrets/
 *   subdomain read, already normalized — either freshly read this run or preserved from what was already
 *   stored, when this run's own read for this one script failed
 * @param accountId the account this script was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareWorkerScript({
  raw,
  bundle,
  accountId,
  at,
}: {
  raw: CloudflareRawWorkerScript;
  bundle: CloudflareWorkerScriptBundleDetail;
  accountId: string;
  at: string;
}): CloudflareEntity {
  // Every omitted name beyond `id` is read from `raw` itself below; destructuring only leaves the rest as open
  // config.
  const {
    id,
    tag: _tag,
    created_on: _createdOn,
    modified_on: _modifiedOn,
    usage_model: _usageModel,
    compatibility_date: _compatibilityDate,
    compatibility_flags: _compatibilityFlags,
    has_assets: _hasAssets,
    has_modules: _hasModules,
    logpush: _logpush,
    tags: _tags,
    migration_tag: _migrationTag,
    last_deployed_from: _lastDeployedFrom,
    ...config
  } = raw;
  const detail: CloudflareWorkerScriptDetail = {
    ...bundle,
    compatibilityDate: unsetFieldAsNull({ key: "compatibility_date", record: raw }),
    compatibilityFlags: workerScriptCompatibilityFlags({ script: raw }),
    config,
    createdOn: unsetFieldAsNull({ key: "created_on", record: raw }),
    hasAssets: unsetFieldAsNull({ key: "has_assets", record: raw }),
    hasModules: unsetFieldAsNull({ key: "has_modules", record: raw }),
    kind: "worker-script",
    lastDeployedFrom: unsetFieldAsNull({ key: "last_deployed_from", record: raw }),
    logpush: unsetFieldAsNull({ key: "logpush", record: raw }),
    migrationTag: unsetFieldAsNull({ key: "migration_tag", record: raw }),
    modifiedOn: unsetFieldAsNull({ key: "modified_on", record: raw }),
    name: id,
    tag: unsetFieldAsNull({ key: "tag", record: raw }),
    tags: workerScriptTags({ script: raw }),
    usageModel: unsetFieldAsNull({ key: "usage_model", record: raw }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: id }, kind: "worker-script" }),
    kind: "worker-script",
    lastSeenAt: at,
    providerId: id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "workers-scripts-fanout" },
    state: "observed",
  };
}

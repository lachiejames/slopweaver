/**
 * The projections for GitHub's CONFIGURATION kinds — what every organisation and repository setting is
 * currently set to.
 *
 * Split from `projection.ts` on size alone; the two share `projectionBase.ts`'s readers and provenance, and
 * the rules are that module's header. Two things specific to this half are worth stating here:
 *
 * **Two fields are read in order to be DESTROYED.** A webhook's `config.url` is reduced to an origin and a
 * path shape, because a webhook URL routinely carries its own credential; a deploy key's `key` is reduced
 * to a fingerprint. Both are `privacy.ts`'s, and both are the case where refusing to read the field would
 * have cost the atlas its question rather than protecting anything.
 *
 * **A variable's VALUE is read and dropped.** GitHub returns it and `entities.ts` has no field to put it
 * in — a variable is where an operator puts what a secret felt heavy for, and an atlas whose subject is the
 * surface has no question its value answers.
 */
import { isRecord } from "../../lib/parsers.js";

import type {
  GithubCodeScanningDefaultSetup,
  GithubCodeSecurityConfiguration,
  GithubDeployKey,
  GithubRuleset,
  GithubSecretName,
  GithubVariableName,
  GithubWebhook,
} from "./entities.js";
import type { GithubScopeLevel } from "./model.js";
import { deployKeyFingerprint, reduceWebhookDestination } from "./privacy.js";
import {
  bool,
  idsOf,
  iso,
  nested,
  type ProjectionContext,
  providerIdOf,
  scopedOf,
  str,
  strings,
} from "./projectionBase.js";

/**
 * Project one code security configuration.
 *
 * @param raw one configuration from the listing
 * @param scopeRef the organisation login
 * @param context the run's provenance
 * @returns the stored configuration, or `null` when it carries no name
 */
export function projectGithubCodeSecurityConfiguration({
  raw,
  scopeRef,
  context,
}: {
  raw: unknown;
  scopeRef: string;
  context: ProjectionContext;
}): GithubCodeSecurityConfiguration | null {
  if (!isRecord(raw)) {
    return null;
  }
  const name = str({ key: "name", raw });
  if (name === null) {
    return null;
  }
  return {
    ...scopedOf({
      context,
      deepLink: str({ key: "html_url", raw }),
      kind: "code-security-configuration",
      providerId: providerIdOf({ fallback: name, raw }),
      scopeLevel: "organization",
      scopeRef,
    }),
    advancedSecurity: str({ key: "advanced_security", raw }),
    codeScanningDefaultSetup: str({ key: "code_scanning_default_setup", raw }),
    dependabotAlerts: str({ key: "dependabot_alerts", raw }),
    dependabotSecurityUpdates: str({ key: "dependabot_security_updates", raw }),
    dependencyGraph: str({ key: "dependency_graph", raw }),
    dependencyGraphAutosubmitAction: str({ key: "dependency_graph_autosubmit_action", raw }),
    description: str({ key: "description", raw }),
    enforcement: str({ key: "enforcement", raw }),
    name,
    privateVulnerabilityReporting: str({ key: "private_vulnerability_reporting", raw }),
    secretScanning: str({ key: "secret_scanning", raw }),
    secretScanningNonProviderPatterns: str({ key: "secret_scanning_non_provider_patterns", raw }),
    secretScanningPushProtection: str({ key: "secret_scanning_push_protection", raw }),
    secretScanningValidityChecks: str({ key: "secret_scanning_validity_checks", raw }),
    targetType: str({ key: "target_type", raw }),
  };
}

/**
 * Project one repository's code-scanning default setup.
 *
 * @param raw the response body
 * @param scopeRef the `owner/repo` coordinate
 * @param context the run's provenance
 * @returns the stored setup, or `null` when it carries no state
 */
export function projectGithubCodeScanningDefaultSetup({
  raw,
  scopeRef,
  context,
}: {
  raw: unknown;
  scopeRef: string;
  context: ProjectionContext;
}): GithubCodeScanningDefaultSetup | null {
  if (!isRecord(raw)) {
    return null;
  }
  const state = str({ key: "state", raw });
  if (state === null) {
    return null;
  }
  return {
    ...scopedOf({
      context,
      deepLink: null,
      kind: "code-scanning-default-setup",
      providerId: scopeRef,
      scopeLevel: "repository",
      scopeRef,
    }),
    languages: strings({ key: "languages", raw }),
    querySuite: str({ key: "query_suite", raw }),
    runnerLabel: str({ key: "runner_label", raw }),
    runnerType: str({ key: "runner_type", raw }),
    schedule: str({ key: "schedule", raw }),
    state,
    updatedAt: iso({ key: "updated_at", raw }),
  };
}

/**
 * Project one ruleset.
 *
 * `rules` and `conditions` become their own TYPE and KEY names rather than the whole payload: what a
 * reader wants is which kinds of rule are enforced and on what, and the payload also carries actor lists
 * whose members belong to the corpus.
 *
 * @param raw one ruleset from the listing
 * @param scopeLevel which level of GitHub's hierarchy owns it
 * @param scopeRef the organisation login or `owner/repo` coordinate
 * @param context the run's provenance
 * @returns the stored ruleset, or `null` when it carries no name or no enforcement — both declared required
 */
export function projectGithubRuleset({
  raw,
  scopeLevel,
  scopeRef,
  context,
}: {
  raw: unknown;
  scopeLevel: GithubScopeLevel;
  scopeRef: string;
  context: ProjectionContext;
}): GithubRuleset | null {
  if (!isRecord(raw)) {
    return null;
  }
  const name = str({ key: "name", raw });
  // GitHub declares `enforcement` required; the sync's read refuses a listing that omits it (requiredFields.ts).
  const enforcement = str({ key: "enforcement", raw });
  if (name === null || enforcement === null) {
    return null;
  }
  const rules = raw["rules"];
  const ruleTypes = Array.isArray(rules)
    ? [
        ...new Set(
          rules.flatMap((rule: unknown): readonly string[] => {
            const type = isRecord(rule) ? rule["type"] : undefined;
            return typeof type === "string" ? [type] : [];
          }),
        ),
      ].toSorted()
    : [];
  return {
    ...scopedOf({
      context,
      deepLink: str({ key: "html_url", raw }),
      kind: "ruleset",
      providerId: providerIdOf({ fallback: name, raw }),
      scopeLevel,
      scopeRef,
    }),
    bypassActorIds: idsOf({ key: "bypass_actors", raw }),
    conditionKeys: Object.keys(nested({ key: "conditions", raw })).toSorted(),
    enforcement,
    name,
    ruleTypes,
    target: str({ key: "target", raw }),
    updatedAt: iso({ key: "updated_at", raw }),
  };
}

/**
 * Project one webhook, reducing its destination before anything is stored.
 *
 * @param raw one hook from the listing
 * @param scopeLevel which level of GitHub's hierarchy owns it
 * @param scopeRef the organisation login or `owner/repo` coordinate
 * @param context the run's provenance
 * @returns the stored webhook, or `null` when it carries no id
 */
export function projectGithubWebhook({
  raw,
  scopeLevel,
  scopeRef,
  context,
}: {
  raw: unknown;
  scopeLevel: GithubScopeLevel;
  scopeRef: string;
  context: ProjectionContext;
}): GithubWebhook | null {
  if (!isRecord(raw)) {
    return null;
  }
  const config = nested({ key: "config", raw });
  const destination = reduceWebhookDestination({ url: str({ key: "url", raw: config }) });
  const insecure = str({ key: "insecure_ssl", raw: config });
  return {
    ...scopedOf({
      context,
      deepLink: null,
      kind: "webhook",
      providerId: providerIdOf({ fallback: `${scopeRef}/hook`, raw }),
      scopeLevel,
      scopeRef,
    }),
    active: bool({ key: "active", raw }) === true,
    contentType: str({ key: "content_type", raw: config }),
    destinationOrigin: destination.origin,
    destinationPathDigest: destination.pathDigest,
    events: strings({ key: "events", raw }),
    // GitHub reports this as the STRING "0" or "1" rather than a boolean, so it is compared as one.
    insecureSsl: insecure === null ? null : insecure === "1",
    updatedAt: iso({ key: "updated_at", raw }),
  };
}

/**
 * Project one secret's name and scope.
 *
 * @param raw one secret from the listing
 * @param scopeLevel which level of GitHub's hierarchy owns it
 * @param scopeRef the organisation login or `owner/repo` coordinate
 * @param context the run's provenance
 * @returns the stored secret name, or `null` when it carries no name
 */
export function projectGithubSecretName({
  raw,
  scopeLevel,
  scopeRef,
  context,
}: {
  raw: unknown;
  scopeLevel: GithubScopeLevel;
  scopeRef: string;
  context: ProjectionContext;
}): GithubSecretName | null {
  if (!isRecord(raw)) {
    return null;
  }
  const name = str({ key: "name", raw });
  if (name === null) {
    return null;
  }
  return {
    ...scopedOf({ context, deepLink: null, kind: "secret-name", providerId: name, scopeLevel, scopeRef }),
    createdAt: iso({ key: "created_at", raw }),
    name,
    selectedRepositoryIds: idsOf({ key: "selected_repositories", raw }),
    updatedAt: iso({ key: "updated_at", raw }),
    visibility: str({ key: "visibility", raw }),
  };
}

/**
 * Project one variable's name and scope, dropping the value GitHub returns.
 *
 * The drop is the point of this function existing separately from the secret one, which has no value to
 * drop. See `entities.ts` on why a variable's value has no question here.
 *
 * @param raw one variable from the listing
 * @param scopeLevel which level of GitHub's hierarchy owns it
 * @param scopeRef the organisation login or `owner/repo` coordinate
 * @param context the run's provenance
 * @returns the stored variable name, or `null` when it carries no name
 */
export function projectGithubVariableName({
  raw,
  scopeLevel,
  scopeRef,
  context,
}: {
  raw: unknown;
  scopeLevel: GithubScopeLevel;
  scopeRef: string;
  context: ProjectionContext;
}): GithubVariableName | null {
  if (!isRecord(raw)) {
    return null;
  }
  const name = str({ key: "name", raw });
  if (name === null) {
    return null;
  }
  return {
    ...scopedOf({ context, deepLink: null, kind: "variable-name", providerId: name, scopeLevel, scopeRef }),
    createdAt: iso({ key: "created_at", raw }),
    name,
    selectedRepositoryIds: idsOf({ key: "selected_repositories", raw }),
    updatedAt: iso({ key: "updated_at", raw }),
    visibility: str({ key: "visibility", raw }),
  };
}

/**
 * Project one deploy key, reducing its key material to a fingerprint.
 *
 * @param raw one key from the listing
 * @param scopeRef the `owner/repo` coordinate
 * @param context the run's provenance
 * @returns the stored deploy key, or `null` when it carries no key material to fingerprint
 */
export function projectGithubDeployKey({
  raw,
  scopeRef,
  context,
}: {
  raw: unknown;
  scopeRef: string;
  context: ProjectionContext;
}): GithubDeployKey | null {
  if (!isRecord(raw)) {
    return null;
  }
  const fingerprint = deployKeyFingerprint({ key: str({ key: "key", raw }) });
  if (fingerprint === null) {
    return null;
  }
  const addedBy = raw["added_by"];
  return {
    ...scopedOf({
      context,
      deepLink: null,
      kind: "deploy-key",
      providerId: providerIdOf({ fallback: fingerprint, raw }),
      scopeLevel: "repository",
      scopeRef,
    }),
    addedBy: typeof addedBy === "string" && addedBy.length > 0 ? addedBy : null,
    createdAt: iso({ key: "created_at", raw }),
    lastUsedAt: iso({ key: "last_used", raw }),
    publicKeyFingerprint: fingerprint,
    readOnly: bool({ key: "read_only", raw }) !== false,
    title: str({ key: "title", raw }),
  };
}

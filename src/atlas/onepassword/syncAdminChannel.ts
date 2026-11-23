/**
 * The `admin-cli` channel: every kind this atlas assembles from an `op` session, in the order their
 * dependencies require.
 *
 * Split from `sync.ts` so the two channels are two files rather than one 900-line orchestration - they
 * share nothing but the contracts in `syncCore.ts`, and either can be absent without the other noticing.
 * The pure folding this calls into lives in `syncCore.ts` and the shared `op` primitives in `syncAdminOp.ts`;
 * what stays here is the roster order, the progress lines and every kind-specific walk.
 */
import { err, ok, type Result } from "../../lib/result.js";

import type { OnepasswordEntity, OnepasswordKind, OnepasswordKindFile } from "./model.js";
import {
  projectOnepasswordGroup,
  projectOnepasswordGroupMember,
  projectOnepasswordIntegration,
  projectOnepasswordUser,
  projectOnepasswordVault,
  projectOnepasswordVaultGrant,
} from "./projection.js";
import { attemptOp, syncPerParentKind, syncSimpleKind } from "./syncAdminOp.js";
import {
  foldOnepasswordKind,
  kindResult,
  mergeVaultPasses,
  type OnepasswordProgress,
  type OnepasswordSurfaceAttempt,
  type OnepasswordSyncKindOutcome,
  type OpSurfaceRunner,
  progressLineFor,
  projectionGaps,
  projectOnepasswordRows,
} from "./syncCore.js";

/** The provider id off one already-projected entity, used to drive the per-parent calls that follow. */
function providerIdsOf({ entities }: { entities: readonly OnepasswordEntity[] }): readonly string[] {
  return entities.map((entity) => entity.providerId);
}

/**
 * Group membership: one `op group user list` per group, folded into the single `group-member` kind.
 *
 * Every call must succeed for the kind to read complete - a group whose members could not be listed leaves
 * a hole in "who can reach what", which is the one question this atlas exists to answer.
 *
 * @param groups the already-projected groups whose ids drive the per-parent calls
 * @returns the folded `group-member` result, or why the fold refused
 */
function syncGroupMembers({
  at,
  groups,
  run,
  stored,
}: {
  at: string;
  groups: readonly OnepasswordEntity[];
  run: OpSurfaceRunner;
  stored: OnepasswordKindFile;
}): Result<OnepasswordSyncKindOutcome & { file: OnepasswordKindFile }> {
  const members = syncPerParentKind({
    at,
    kind: "group-member",
    parentIds: providerIdsOf({ entities: groups }),
    project: ({ raw, parentId }) => projectOnepasswordGroupMember({ at, groupId: parentId, raw }),
    run,
    stored,
    surface: "group-members",
  });
  const fold = foldOnepasswordKind({
    at,
    attempts: members.attempts,
    channel: "admin-cli",
    extraGaps: projectionGaps({ at, kind: "group-member", reasons: members.reasons, scope: "group-members" }),
    observed: members.entities,
    stored,
  });
  if (fold.isErr()) {
    return err(fold.error);
  }
  return ok(kindResult({ fold: fold.value, kind: "group-member" }));
}

/** The kind results one roster pass produced, keyed by kind. */
type OnepasswordKindResults = Record<string, OnepasswordSyncKindOutcome & { file: OnepasswordKindFile }>;

/**
 * The people half of the roster: users, groups, and which people are in which group.
 *
 * Ordered by dependency rather than by preference - group membership is a per-group call, so the groups
 * have to exist before it can be walked.
 *
 * @returns the three people kinds, or the first fold that refused
 */
function syncPeopleKinds({
  at,
  onProgress,
  run,
  storedFiles,
}: {
  at: string;
  onProgress: OnepasswordProgress;
  run: OpSurfaceRunner;
  storedFiles: Record<OnepasswordKind, OnepasswordKindFile>;
}): Result<OnepasswordKindResults> {
  onProgress({ line: "user: pulling…" });
  const users = syncSimpleKind({
    at,
    kind: "user",
    project: ({ raw }) => projectOnepasswordUser({ at, raw }),
    run,
    stored: storedFiles.user,
    surface: "users-list",
  });
  if (users.isErr()) {
    return err(users.error);
  }
  onProgress({ line: progressLineFor({ result: users.value.result }) });
  onProgress({ line: "group: pulling…" });
  const groups = syncSimpleKind({
    at,
    kind: "group",
    project: ({ raw }) => projectOnepasswordGroup({ at, raw }),
    run,
    stored: storedFiles.group,
    surface: "groups-list",
  });
  if (groups.isErr()) {
    return err(groups.error);
  }
  onProgress({ line: progressLineFor({ result: groups.value.result }) });
  onProgress({ line: `group-member: pulling… (one call per group, ${String(groups.value.entities.length)} to go)` });
  const members = syncGroupMembers({ at, groups: groups.value.entities, run, stored: storedFiles["group-member"] });
  if (members.isErr()) {
    return err(members.error);
  }
  onProgress({ line: progressLineFor({ result: members.value }) });
  return ok({ group: groups.value.result, "group-member": members.value, user: users.value.result });
}

/**
 * The vault half of the roster: the vaults themselves, who can reach each one, and the account's
 * integrations.
 *
 * `vault-grant` depends on the vault ids the vault pass resolved, which is why the two are not independent.
 *
 * @returns the three vault-side kinds, or the first fold that refused
 */
function syncVaultKinds({
  at,
  onProgress,
  run,
  storedFiles,
}: {
  at: string;
  onProgress: OnepasswordProgress;
  run: OpSurfaceRunner;
  storedFiles: Record<OnepasswordKind, OnepasswordKindFile>;
}): Result<OnepasswordKindResults> {
  onProgress({ line: "vault: pulling… (a list, then one call per vault for its item count)" });
  const vaults = syncVaults({ at, run, stored: storedFiles.vault });
  if (vaults.isErr()) {
    return err(vaults.error);
  }
  onProgress({ line: progressLineFor({ result: vaults.value.outcome }) });
  onProgress({ line: `vault-grant: pulling… (two calls per vault, ${String(vaults.value.vaultIds.length)} to go)` });
  const grants = syncVaultGrants({ at, run, stored: storedFiles["vault-grant"], vaultIds: vaults.value.vaultIds });
  if (grants.isErr()) {
    return err(grants.error);
  }
  onProgress({ line: progressLineFor({ result: grants.value }) });
  onProgress({ line: "integration: pulling…" });
  const integrations = syncIntegrations({ at, run, stored: storedFiles.integration });
  if (integrations.isErr()) {
    return err(integrations.error);
  }
  onProgress({ line: progressLineFor({ result: integrations.value }) });
  return ok({ integration: integrations.value, vault: vaults.value.outcome, "vault-grant": grants.value });
}

/**
 * Every kind the `op` session feeds, run in dependency order: the parents first, then the edges.
 *
 * @param storedFiles the trusted prior generation each kind merges against
 * @returns every roster kind's result, or the first fold that refused
 */
export function syncAdminCliKinds({
  run,
  storedFiles,
  onProgress,
  at,
}: {
  run: OpSurfaceRunner;
  storedFiles: Record<OnepasswordKind, OnepasswordKindFile>;
  onProgress: OnepasswordProgress;
  at: string;
}): Result<OnepasswordKindResults> {
  const people = syncPeopleKinds({ at, onProgress, run, storedFiles });
  if (people.isErr()) {
    return err(people.error);
  }
  const vaults = syncVaultKinds({ at, onProgress, run, storedFiles });
  if (vaults.isErr()) {
    return err(vaults.error);
  }
  return ok({ ...people.value, ...vaults.value });
}

/**
 * Vaults, in two passes: the list names them, then one `op vault get` per vault supplies the item COUNT.
 * The second pass is why `op item list` is absent from the allowlist - the count is a field on the vault.
 */
function syncVaults({ run, stored, at }: { run: OpSurfaceRunner; stored: OnepasswordKindFile; at: string }): Result<{
  outcome: OnepasswordSyncKindOutcome & { file: OnepasswordKindFile };
  vaultIds: readonly string[];
}> {
  const listing = attemptOp({ at, id: null, kind: "vault", run, scope: "vaults-list", stored, surface: "vaults-list" });
  const listed = projectOnepasswordRows({
    project: ({ raw }) => projectOnepasswordVault({ at, raw }),
    rows: listing.rows,
  });
  const vaultIds = providerIdsOf({ entities: listed.entities });
  const detail = syncPerParentKind({
    at,
    kind: "vault",
    parentIds: vaultIds,
    project: ({ raw }) => projectOnepasswordVault({ at, raw }),
    run,
    stored,
    surface: "vault-detail",
  });
  // The detail pass supersedes the listing for any vault it reached, because only it carries the count.
  const merged = mergeVaultPasses({
    at,
    detail: detail.entities,
    listed: listed.entities,
    reasons: [...listed.reasons, ...detail.reasons],
  });
  const fold = foldOnepasswordKind({
    at,
    attempts: [listing, ...detail.attempts],
    channel: "admin-cli",
    extraGaps: merged.extraGaps,
    observed: merged.observed,
    stored,
  });
  if (fold.isErr()) {
    return err(fold.error);
  }
  return ok({ outcome: kindResult({ fold: fold.value, kind: "vault" }), vaultIds });
}

/** Vault access: the group grants and the direct person grants, both per vault, folded into one kind. */
function syncVaultGrants({
  run,
  vaultIds,
  stored,
  at,
}: {
  run: OpSurfaceRunner;
  vaultIds: readonly string[];
  stored: OnepasswordKindFile;
  at: string;
}): Result<OnepasswordSyncKindOutcome & { file: OnepasswordKindFile }> {
  const groupGrants = syncPerParentKind({
    at,
    kind: "vault-grant",
    parentIds: vaultIds,
    project: ({ raw, parentId }) =>
      projectOnepasswordVaultGrant({ at, principalKind: "group", raw, vaultId: parentId }),
    run,
    stored,
    surface: "vault-groups",
  });
  const userGrants = syncPerParentKind({
    at,
    kind: "vault-grant",
    parentIds: vaultIds,
    project: ({ raw, parentId }) => projectOnepasswordVaultGrant({ at, principalKind: "user", raw, vaultId: parentId }),
    run,
    stored,
    surface: "vault-users",
  });
  const fold = foldOnepasswordKind({
    at,
    attempts: [...groupGrants.attempts, ...userGrants.attempts],
    channel: "admin-cli",
    extraGaps: projectionGaps({
      at,
      kind: "vault-grant",
      reasons: [...groupGrants.reasons, ...userGrants.reasons],
      scope: "vault-grants",
    }),
    observed: [...groupGrants.entities, ...userGrants.entities],
    stored,
  });
  if (fold.isErr()) {
    return err(fold.error);
  }
  return ok({
    complete: fold.value.complete,
    entityCount: fold.value.file.entities.length,
    file: fold.value.file,
    kind: "vault-grant",
    reasons: fold.value.reasons,
  });
}

/**
 * The integration lists, folded into one kind so "what is attached to this account" is one file.
 *
 * Only Connect servers survive here. `op events-api` and `op service-account` were both in this list until
 * the first real roster run, and NEITHER HAS A `list` VERB — measured against op 2.39.0:
 * `op events-api --help` offers only `create`, `op service-account --help` only `create` and `ratelimit`.
 * op answered both invented commands with its help text on stdout and exit 0, which reached the atlas as
 * `cli-output-unreadable` and read like a permissions problem. They are named in
 * {@link ONEPASSWORD_OUT_OF_SCOPE_GROUPS} now, so their absence is declared rather than a kind that fails
 * forever. Reproduce with `op events-api --help`; it needs no session.
 */
function syncIntegrations({
  run,
  stored,
  at,
}: {
  run: OpSurfaceRunner;
  stored: OnepasswordKindFile;
  at: string;
}): Result<OnepasswordSyncKindOutcome & { file: OnepasswordKindFile }> {
  const sources = [{ integrationKind: "connect", surface: "connect-servers" }] as const;
  const attempts: OnepasswordSurfaceAttempt[] = [];
  const entities: OnepasswordEntity[] = [];
  const reasons: string[] = [];
  for (const source of sources) {
    const attempt = attemptOp({
      at,
      id: null,
      kind: "integration",
      run,
      scope: source.surface,
      stored,
      surface: source.surface,
    });
    attempts.push(attempt);
    const projected = projectOnepasswordRows({
      project: ({ raw }) => projectOnepasswordIntegration({ at, integrationKind: source.integrationKind, raw }),
      rows: attempt.rows,
    });
    entities.push(...projected.entities);
    reasons.push(...projected.reasons);
  }
  const fold = foldOnepasswordKind({
    at,
    attempts,
    channel: "admin-cli",
    extraGaps: projectionGaps({ at, kind: "integration", reasons, scope: "integrations" }),
    observed: entities,
    stored,
  });
  if (fold.isErr()) {
    return err(fold.error);
  }
  return ok({
    complete: fold.value.complete,
    entityCount: fold.value.file.entities.length,
    file: fold.value.file,
    kind: "integration",
    reasons: fold.value.reasons,
  });
}

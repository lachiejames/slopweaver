/**
 * Pure per-kind provider-JSON → atlas entity projection, and the second of this atlas's three sensitivity
 * mechanisms.
 *
 * ## Parsing IS the allowlist
 *
 * Every function here takes `unknown` — the raw JSON `op` or the Events API handed back — and runs it
 * through the kind's own closed schema from `model.ts`. Zod strips a key the schema does not name, so a
 * field 1Password adds next month is dropped HERE rather than stored because nobody thought to exclude it.
 * An Events API page has already passed its strict wire boundary (`eventsBoundaries.ts`), which refuses an
 * added key by name; this projection decides what is STORED, that boundary what is noticed. There is deliberately no code path that copies a provider payload wholesale; the
 * Vanta atlas has one (`detail: dto`) and on this platform that shape would eventually store a password.
 *
 * A record that fails to parse is REFUSED rather than partially projected. A half-understood record is
 * exactly the case where an unexpected field is most likely to be the interesting one.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { onepasswordEdgeProviderId, onepasswordEntityId } from "./identity.js";
import {
  type OnepasswordChannel,
  type OnepasswordChannelEntity,
  type OnepasswordDetail,
  type OnepasswordEntity,
  type OnepasswordKind,
  type OnepasswordSource,
  onepasswordEventDetailSchema,
  onepasswordGroupDetailSchema,
  onepasswordGroupMemberDetailSchema,
  onepasswordIntegrationDetailSchema,
  onepasswordUserDetailSchema,
  onepasswordVaultDetailSchema,
  onepasswordVaultGrantDetailSchema,
} from "./model.js";
import { OnepasswordSyncErrors, onepasswordSyncErrorLines } from "./syncErrors.js";

/**
 * The shape every projection returns: a fully-populated entity on one channel.
 *
 * @internal
 */
export type OnepasswordProjection = Result<OnepasswordEntity>;

/**
 * Build the source record a projection carries.
 *
 * @param channel which channel produced this look
 * @param endpoint the `op` argv or Events API path this came from — the reproduction handle
 * @param deepLink the administrative-console URL a human opens to see this, when one is known
 * @param at this run's ISO timestamp
 * @returns the source record
 *
 * @internal
 */
export function onepasswordSource({
  channel,
  endpoint,
  deepLink,
  at,
}: {
  channel: OnepasswordChannel;
  endpoint: string;
  deepLink: string | null;
  at: string;
}): OnepasswordSource {
  return {
    artifacts: [],
    channel,
    deepLink,
    deepLinkStatus: deepLink === null ? "unavailable" : "provider-provided",
    endpoint,
    observedAt: at,
  };
}

/** Assemble the entity every projection shares, differing only in kind, provider id and detail. */
function buildEntity({
  kind,
  providerId,
  detail,
  source,
  at,
}: {
  kind: OnepasswordKind;
  providerId: string;
  detail: OnepasswordDetail;
  source: OnepasswordSource;
  at: string;
}): OnepasswordEntity {
  const channel: OnepasswordChannelEntity = {
    channel: source.channel,
    detail,
    firstSeenAt: at,
    lastSeenAt: at,
    source,
    state: "observed",
  };
  return {
    channels: {
      "admin-cli": source.channel === "admin-cli" ? channel : null,
      browser: source.channel === "browser" ? channel : null,
      "events-api": source.channel === "events-api" ? channel : null,
    },
    id: onepasswordEntityId({ components: { providerId }, kind }),
    kind,
    providerId,
  };
}

/** Parse one raw record through its kind's closed schema, naming the kind and the issues on refusal. */
function parseDetail<TDetail extends OnepasswordDetail>({
  kind,
  raw,
  parse,
}: {
  kind: OnepasswordKind;
  raw: unknown;
  parse: (
    input: unknown,
  ) =>
    | { success: true; data: TDetail }
    | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } };
}): Result<TDetail> {
  const parsed = parse(raw);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    onepasswordSyncErrorLines({ error: OnepasswordSyncErrors.recordRefused({ issues: parsed.error.issues, kind }) }),
  );
}

/**
 * Project one team member.
 *
 * @param raw the record as `op user list` returned it
 * @param at this run's ISO timestamp
 * @returns the entity, or why the record was refused
 */
export function projectOnepasswordUser({ raw, at }: { raw: unknown; at: string }): OnepasswordProjection {
  const detail = parseDetail({ kind: "user", parse: (input) => onepasswordUserDetailSchema.safeParse(input), raw });
  if (detail.isErr()) {
    return err(detail.error);
  }
  return ok(
    buildEntity({
      at,
      detail: detail.value,
      kind: "user",
      providerId: detail.value.id,
      source: onepasswordSource({ at, channel: "admin-cli", deepLink: null, endpoint: "op user list" }),
    }),
  );
}

/**
 * Project one group.
 *
 * @param raw the record as `op group list` returned it
 * @param at this run's ISO timestamp
 * @returns the entity, or why the record was refused
 */
export function projectOnepasswordGroup({ raw, at }: { raw: unknown; at: string }): OnepasswordProjection {
  const detail = parseDetail({ kind: "group", parse: (input) => onepasswordGroupDetailSchema.safeParse(input), raw });
  if (detail.isErr()) {
    return err(detail.error);
  }
  return ok(
    buildEntity({
      at,
      detail: detail.value,
      kind: "group",
      providerId: detail.value.id,
      source: onepasswordSource({ at, channel: "admin-cli", deepLink: null, endpoint: "op group list" }),
    }),
  );
}

/**
 * Project one vault. The item COUNT rides on this record; the items themselves are never read.
 *
 * @param raw the record as `op vault get` returned it
 * @param at this run's ISO timestamp
 * @returns the entity, or why the record was refused
 */
export function projectOnepasswordVault({ raw, at }: { raw: unknown; at: string }): OnepasswordProjection {
  const detail = parseDetail({ kind: "vault", parse: (input) => onepasswordVaultDetailSchema.safeParse(input), raw });
  if (detail.isErr()) {
    return err(detail.error);
  }
  return ok(
    buildEntity({
      at,
      detail: detail.value,
      kind: "vault",
      providerId: detail.value.id,
      source: onepasswordSource({ at, channel: "admin-cli", deepLink: null, endpoint: "op vault get" }),
    }),
  );
}

/**
 * Project one group membership — an edge, so its provider id is composite.
 *
 * @param raw the member record as `op user list --group <id>` returned it
 * @param groupId the group whose membership was being listed
 * @param at this run's ISO timestamp
 * @returns the entity, or why the record was refused
 */
export function projectOnepasswordGroupMember({
  raw,
  groupId,
  at,
}: {
  raw: unknown;
  groupId: string;
  at: string;
}): OnepasswordProjection {
  const member = parseDetail({ kind: "user", parse: (input) => onepasswordUserDetailSchema.safeParse(input), raw });
  if (member.isErr()) {
    return err(member.error);
  }
  const edge = parseDetail({
    kind: "group-member",
    parse: (input) => onepasswordGroupMemberDetailSchema.safeParse(input),
    raw: { group_id: groupId, role: member.value.type, user_id: member.value.id },
  });
  if (edge.isErr()) {
    return err(edge.error);
  }
  return ok(
    buildEntity({
      at,
      detail: edge.value,
      kind: "group-member",
      providerId: onepasswordEdgeProviderId({ parentId: groupId, principalId: member.value.id }),
      source: onepasswordSource({ at, channel: "admin-cli", deepLink: null, endpoint: "op user list --group" }),
    }),
  );
}

/**
 * Project one vault access grant — an edge, so its provider id is composite.
 *
 * @param raw the principal record as `op vault group list` or `op vault user list` returned it
 * @param vaultId the vault whose access was being listed
 * @param principalKind whether this row is a group or a person
 * @param at this run's ISO timestamp
 * @returns the entity, or why the record was refused
 */
export function projectOnepasswordVaultGrant({
  raw,
  vaultId,
  principalKind,
  at,
}: {
  raw: unknown;
  vaultId: string;
  principalKind: "group" | "user";
  at: string;
}): OnepasswordProjection {
  // Both branches are parsed through their OWN schema rather than one union: a union would accept a user
  // row on the group surface, and this atlas would then record a person as a group with no way to tell.
  //
  // The row also carries the grant itself (`permissions`), which these PROVIDER-boundary schemas drop the
  // way they drop any field they do not name. Only the read-back union in `model.ts` is strict, and it
  // parses a record this repo wrote rather than one 1Password returned.
  const principal =
    principalKind === "group"
      ? parseDetail({
          kind: "group",
          parse: (input) => onepasswordGroupDetailSchema.safeParse(input),
          raw,
        })
      : parseDetail({
          kind: "user",
          parse: (input) => onepasswordUserDetailSchema.safeParse(input),
          raw,
        });
  if (principal.isErr()) {
    return err(principal.error);
  }
  const principalId = principal.value.id;
  const permissions = readPermissions({ raw });
  const edge = parseDetail({
    kind: "vault-grant",
    parse: (input) => onepasswordVaultGrantDetailSchema.safeParse(input),
    raw: { permissions, principal_id: principalId, principal_kind: principalKind, vault_id: vaultId },
  });
  if (edge.isErr()) {
    return err(edge.error);
  }
  return ok(
    buildEntity({
      at,
      detail: edge.value,
      kind: "vault-grant",
      providerId: onepasswordEdgeProviderId({ parentId: vaultId, principalId }),
      source: onepasswordSource({
        at,
        channel: "admin-cli",
        deepLink: null,
        endpoint: `op vault ${principalKind} list`,
      }),
    }),
  );
}

/**
 * Read the permission list off a raw grant row, tolerating both spellings `op` has used.
 *
 * A grant row's permissions are the one field whose ABSENCE would be silently wrong — an empty list reads
 * as "can reach the vault with no permissions", which is not a state 1Password has. So an unreadable
 * permissions field yields a single explicit marker rather than an empty array.
 *
 * @param raw the grant row
 * @returns the permission strings, or a single `unreadable` marker
 */
function readPermissions({ raw }: { raw: unknown }): readonly string[] {
  if (typeof raw !== "object" || raw === null) {
    return ["<unreadable>"];
  }
  const candidate = permissionsField({ record: { ...raw } });
  if (typeof candidate === "string") {
    return candidate
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
  if (Array.isArray(candidate)) {
    const strings = candidate.filter((entry): entry is string => typeof entry === "string");
    return strings.length > 0 ? strings : ["<unreadable>"];
  }
  return ["<unreadable>"];
}

/**
 * The raw permissions field, under whichever of the two spellings `op` has used: `permissions` when the row
 * carries it, else the singular `permission`. Neither present reaches {@link readPermissions} as `undefined`,
 * which marks the grant unreadable rather than empty.
 */
function permissionsField({ record }: { record: Record<string, unknown> }): unknown {
  const plural = record["permissions"];
  if (plural === undefined || plural === null) {
    return record["permission"];
  }
  return plural;
}

/**
 * Project one integration attached to the account. Metadata only — an integration's own token is never
 * read, and no verb in `inventory.ts` would return one.
 *
 * @param raw the record as the relevant `op` list verb returned it
 * @param integrationKind which list this row came from
 * @param at this run's ISO timestamp
 * @returns the entity, or why the record was refused
 */
export function projectOnepasswordIntegration({
  raw,
  integrationKind,
  at,
}: {
  raw: unknown;
  integrationKind: "connect" | "events-api" | "service-account";
  at: string;
}): OnepasswordProjection {
  const merged = typeof raw === "object" && raw !== null ? { ...raw, integration_kind: integrationKind } : raw;
  const detail = parseDetail({
    kind: "integration",
    parse: (input) => onepasswordIntegrationDetailSchema.safeParse(input),
    raw: merged,
  });
  if (detail.isErr()) {
    return err(detail.error);
  }
  return ok(
    buildEntity({
      at,
      detail: detail.value,
      kind: "integration",
      providerId: `${integrationKind}:${detail.value.id}`,
      source: onepasswordSource({
        at,
        channel: "admin-cli",
        deepLink: null,
        endpoint: `op ${integrationKind === "service-account" ? "service-account" : integrationKind} list`,
      }),
    }),
  );
}

/**
 * Project one audit event. Three field families 1Password returns are dropped by the schema rather than
 * here — see `model.ts` on `object_details` and precise geolocation.
 *
 * @param raw the item as the Events API returned it
 * @param at this run's ISO timestamp
 * @returns the entity, or why the record was refused
 */
export function projectOnepasswordEvent({ raw, at }: { raw: unknown; at: string }): OnepasswordProjection {
  const detail = parseDetail({ kind: "event", parse: (input) => onepasswordEventDetailSchema.safeParse(input), raw });
  if (detail.isErr()) {
    return err(detail.error);
  }
  return ok(
    buildEntity({
      at,
      detail: detail.value,
      kind: "event",
      providerId: detail.value.uuid,
      source: onepasswordSource({
        at,
        channel: "events-api",
        deepLink: null,
        endpoint: "POST /api/v2/auditevents",
      }),
    }),
  );
}

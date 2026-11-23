/**
 * The two Zero Trust ACTOR entity shapes and their projections — who can reach this organisation, and the
 * account-wide terms they reach it on.
 *
 * `access-user` is the seat register: every identity Access has seen, which seats it holds (Access and
 * Gateway are separate entitlements), and when it last signed in successfully. Measured, every
 * live user was absent from the atlas before this reader existed. It is deliberately NOT the same thing as
 * `access/seats`, which answers "how many seats were PURCHASED" and refuses any API token with `405 Method
 * not allowed for this authentication scheme` — that shortfall is a dashboard fact and belongs to the
 * descriptor's declared-unfilled browser surface, not to a half-built reader here.
 *
 * `zero-trust-organization` is the singleton every one of those users is judged under: the login page, the
 * WARP session duration, whether unmatched requests are denied, whether device posture is cached, and how
 * long a seat survives inactivity. It is a settings record rather than an actor, and it lives beside
 * `access-user` because those settings are only ever read to answer a question about a person.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The fixed provider id the Zero Trust organisation singleton is stored under. */
export const ZERO_TRUST_ORGANIZATION_ID = "zero-trust-organization";

/** The stable fields one Access user carries. */
export interface CloudflareAccessUserDto {
  readonly id: string;
  readonly uid?: string | null;
  readonly name?: string | null;
  readonly email?: string | null;
  readonly seat_uid?: string | null;
  readonly access_seat?: boolean | null;
  readonly gateway_seat?: boolean | null;
  readonly last_successful_login?: string | null;
  readonly created_at?: string | null;
  readonly updated_at?: string | null;
}

/** The detail this atlas stores for the `access-user` kind. */
export interface CloudflareAccessUserDetail {
  readonly kind: "access-user";
  readonly name: string | null;
  /** The identity itself. An atlas that dropped it could not answer the question this kind exists for. */
  readonly email: string | null;
  readonly uid: string | null;
  readonly seatUid: string | null;
  /** The two entitlements, held independently: an Access seat is not a Gateway seat. */
  readonly accessSeat: boolean | null;
  readonly gatewaySeat: boolean | null;
  readonly lastSuccessfulLogin: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

/**
 * Project one Access user into an `access-user` entity.
 *
 * @param user the raw user, already validated to carry a non-empty `id`
 * @param accountId the account this user was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccessUser({
  user,
  accountId,
  at,
}: {
  user: CloudflareAccessUserDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareAccessUserDetail = {
    accessSeat: unsetFieldAsNull({ record: user, key: "access_seat" }),
    createdAt: unsetFieldAsNull({ record: user, key: "created_at" }),
    email: unsetFieldAsNull({ record: user, key: "email" }),
    gatewaySeat: unsetFieldAsNull({ record: user, key: "gateway_seat" }),
    kind: "access-user",
    lastSuccessfulLogin: unsetFieldAsNull({ record: user, key: "last_successful_login" }),
    name: unsetFieldAsNull({ record: user, key: "name" }),
    seatUid: unsetFieldAsNull({ record: user, key: "seat_uid" }),
    uid: unsetFieldAsNull({ record: user, key: "uid" }),
    updatedAt: unsetFieldAsNull({ record: user, key: "updated_at" }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: user.id }, kind: "access-user" }),
    kind: "access-user",
    lastSeenAt: at,
    providerId: user.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "access-users-list" },
    state: "observed",
  };
}

/** The detail this atlas stores for the `zero-trust-organization` singleton. */
export interface CloudflareZeroTrustOrganizationDetail {
  readonly kind: "zero-trust-organization";
  readonly name: string | null;
  /** The `<team>.cloudflareaccess.com` domain every Access application authenticates against. */
  readonly authDomain: string | null;
  /** The branding on the sign-in page every user of this organisation sees. */
  readonly loginDesign: unknown;
  /** How long a WARP authentication survives before it must be renewed. */
  readonly warpAuthSessionDuration: string | null;
  readonly warpAuthNonBrowser401: boolean | null;
  readonly allowAuthenticateViaWarp: boolean | null;
  readonly cacheDevicePosture: boolean | null;
  /** Whether a request matching no Access policy is denied by default. */
  readonly denyUnmatchedRequests: boolean | null;
  readonly denyUnmatchedRequestsExemptedZoneNames: readonly string[];
  /** How long an inactive seat is held before it is released. */
  readonly userSeatExpirationInactiveTime: string | null;
  readonly isUiReadOnly: boolean | null;
  readonly hasMigratedPrivateApps: boolean | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

/**
 * The zone names exempted from deny-unmatched-requests, copied; an organisation that publishes none (the
 * field absent or null) exempts no zone, so it reads as an empty list.
 *
 * @param organization the raw organisation response
 * @returns a fresh copy of the exempted zone names, or an empty list when none were published
 */
function exemptedZoneNamesOrNone({
  organization,
}: {
  organization: { readonly deny_unmatched_requests_exempted_zone_names?: readonly string[] | null };
}): string[] {
  const names = unsetFieldAsNull({ record: organization, key: "deny_unmatched_requests_exempted_zone_names" });
  if (names === null) {
    return [];
  }
  return [...names];
}

/**
 * Project the Zero Trust organisation record into its singleton entity.
 *
 * @param organization the raw organisation response
 * @param accountId the account this organisation was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareZeroTrustOrganization({
  organization,
  accountId,
  at,
}: {
  organization: {
    readonly name?: string | null;
    readonly auth_domain?: string | null;
    readonly login_design?: unknown;
    readonly warp_auth_session_duration?: string | null;
    readonly warp_auth_non_browser_401?: boolean | null;
    readonly allow_authenticate_via_warp?: boolean | null;
    readonly cache_device_posture?: boolean | null;
    readonly deny_unmatched_requests?: boolean | null;
    readonly deny_unmatched_requests_exempted_zone_names?: readonly string[] | null;
    readonly user_seat_expiration_inactive_time?: string | null;
    readonly is_ui_read_only?: boolean | null;
    readonly has_migrated_private_apps?: boolean | null;
    readonly created_at?: string | null;
    readonly updated_at?: string | null;
  };
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareZeroTrustOrganizationDetail = {
    allowAuthenticateViaWarp: unsetFieldAsNull({ record: organization, key: "allow_authenticate_via_warp" }),
    authDomain: unsetFieldAsNull({ record: organization, key: "auth_domain" }),
    cacheDevicePosture: unsetFieldAsNull({ record: organization, key: "cache_device_posture" }),
    createdAt: unsetFieldAsNull({ record: organization, key: "created_at" }),
    denyUnmatchedRequests: unsetFieldAsNull({ record: organization, key: "deny_unmatched_requests" }),
    denyUnmatchedRequestsExemptedZoneNames: exemptedZoneNamesOrNone({ organization }),
    hasMigratedPrivateApps: unsetFieldAsNull({ record: organization, key: "has_migrated_private_apps" }),
    isUiReadOnly: unsetFieldAsNull({ record: organization, key: "is_ui_read_only" }),
    kind: "zero-trust-organization",
    loginDesign: unsetFieldAsNull({ record: organization, key: "login_design" }),
    name: unsetFieldAsNull({ record: organization, key: "name" }),
    updatedAt: unsetFieldAsNull({ record: organization, key: "updated_at" }),
    userSeatExpirationInactiveTime: unsetFieldAsNull({
      record: organization,
      key: "user_seat_expiration_inactive_time",
    }),
    warpAuthNonBrowser401: unsetFieldAsNull({ record: organization, key: "warp_auth_non_browser_401" }),
    warpAuthSessionDuration: unsetFieldAsNull({ record: organization, key: "warp_auth_session_duration" }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({
      components: { accountId, providerId: ZERO_TRUST_ORGANIZATION_ID },
      kind: "zero-trust-organization",
    }),
    kind: "zero-trust-organization",
    lastSeenAt: at,
    providerId: ZERO_TRUST_ORGANIZATION_ID,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "zero-trust-organization-get" },
    state: "observed",
  };
}

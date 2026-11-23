/**
 * Reading the four entity families a WorkOS API key can enumerate, and reducing each to names.
 *
 * ## Five list endpoints, one envelope, five strict boundaries
 *
 * `GET /organizations`, `GET /user_management/users`, `GET /connections`, `GET /directories` and the filtered
 * membership listing all answer the same envelope — `{ "data": [...], "list_metadata": { "after": "<cursor>" } }`
 * — so one paged reader serves all five. Each page is read through its endpoint's own strict boundary in
 * `contentBoundaries.ts`, so a key WorkOS adds, drops or renames refuses the page with `RESPONSE_CHANGED`
 * naming it, rather than being skipped or defaulted. Each family's reducer then takes typed records and keeps
 * only what `projection.ts` declares, which is the point at which a provider field this atlas does not hold
 * is dropped rather than carried.
 *
 * ## Paging is BOUNDED, and the bound is a declared gap rather than a silent truncation
 *
 * A page is 100 records and the reader follows at most {@link WORKOS_MAX_PAGES} of them. A tenant larger
 * than that is a real possibility on the user family, so the reader reports whether it stopped because the
 * provider ran out or because the bound did — and `syncCoverage.ts` turns the second into a `deferred` coverage
 * cell rather than publishing a truncated list as though it were complete.
 *
 * ## The FIFTH listing is not one of those four, and cannot be enumerated whole
 *
 * `GET /user_management/organization_memberships` refuses to be listed unfiltered: WorkOS requires
 * `organization_id` or `user_id`, and without one it answers HTTP 400 — MALFORMED, not unauthorised, which
 * is why a valid key does not rescue it (an invalid one answers 401 instead). So memberships are WALKED, a
 * filter at a time, by {@link walkWorkosMemberships}, and that walk carries its own bound and its own
 * reported breach exactly as the paged reader does.
 *
 * ## Nothing read here is a credential
 *
 * The reducers take an id, a name, a type, a state and a count. They never read a SAML certificate, an IdP
 * metadata URL, a directory bearer token or a user's password state, because `model.ts` has nowhere to put
 * one — see `exclusions.ts`, which states that as a refusal rather than an omission.
 *
 * ## A field WorkOS declares required is refused when missing, never placeheld
 *
 * `@workos-inc/node`'s own response types declare an organisation's `name`, a connection's `connection_type`
 * and `state`, and a directory's `type` and `state` REQUIRED, so the boundary requires them and a record
 * missing one refuses its page rather than publishing `unknown`, which would read as a real type or state.
 * `organization_id` is declared OPTIONAL on a connection and a directory, so an absent or null one reads
 * `unknown` and stays counted.
 */

import { absentAs, absentAsEmpty } from "#lib/absent.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type WorkosFetch, workosRead } from "./client.js";
import {
  WORKOS_MEMBERSHIPS_LIST,
  type WorkosConnectionWire,
  type WorkosDirectoryWire,
  type WorkosListEndpoint,
  type WorkosMembershipWire,
  type WorkosOrganizationWire,
  type WorkosUserWire,
} from "./contentBoundaries.js";
import { type WorkosApiError, WorkosApiErrors } from "./errors.js";
import type {
  WorkosConnectionRecord,
  WorkosDirectoryRecord,
  WorkosOrganizationRecord,
  WorkosUserRecord,
} from "./projection.js";

/**
 * How many pages one family's read will follow before it stops and says so.
 *
 * Ten pages of 100 is 1,000 records per family, a bound chosen to keep one sync's round trips few rather than
 * as a claim about any tenant's size. The number matters less than the fact that hitting it is REPORTED —
 * see this file's header.
 *
 * @internal
 */
export const WORKOS_MAX_PAGES = 10;

/** The page size every list read asks for. WorkOS's own maximum. */
const PAGE_LIMIT = 100;

/**
 * What one family's read produced.
 * @internal
 */
export interface WorkosPagedRead<T> {
  readonly records: readonly T[];
  /** `true` when the reader stopped at {@link WORKOS_MAX_PAGES} rather than at the end of the list. */
  readonly truncated: boolean;
}

/**
 * Read every page of one list endpoint, up to the bound, each page through that endpoint's strict boundary.
 *
 * @param fetch the injected transport
 * @param apiKey the WorkOS secret key to authenticate with
 * @param endpoint the list endpoint, its path bound to the parser for its page
 * @param filter the parameters this listing REQUIRES beyond paging, if any — see {@link walkWorkosMemberships}
 * @returns every record read and whether the bound stopped the read, or the typed reason it failed
 */
export async function readWorkosList<T>({
  fetch,
  apiKey,
  endpoint,
  filter = {},
}: {
  fetch: WorkosFetch;
  apiKey: string;
  endpoint: WorkosListEndpoint<T>;
  filter?: Readonly<Record<string, string>>;
}): Promise<Result<WorkosPagedRead<T>, WorkosApiError>> {
  const records: T[] = [];
  const filterQuery = Object.entries(filter)
    .map(([name, value]) => `&${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("");
  let after: string | null = null;
  for (let page = 0; page < WORKOS_MAX_PAGES; page += 1) {
    const paging = after === null ? "" : `&after=${encodeURIComponent(after)}`;
    const query = `?limit=${String(PAGE_LIMIT)}${filterQuery}${paging}`;
    const body: Result<string, WorkosApiError> = await workosRead({
      apiKey,
      fetch,
      path: `${endpoint.path}${query}`,
    });
    if (body.isErr()) {
      return err(body.error);
    }
    const read = endpoint.readPage({ text: body.value });
    if (read.isErr()) {
      return err(WorkosApiErrors.responseChanged({ message: read.error.message }));
    }
    records.push(...read.value.records);
    after = read.value.after;
    if (after === null) {
      return ok({ records, truncated: false });
    }
  }
  return ok({ records, truncated: true });
}

/**
 * How many filtered membership listings one walk will make before it stops and says so.
 *
 * Walking memberships turns one request into one per organisation, and `/organizations` is itself bounded
 * at {@link WORKOS_MAX_PAGES} pages of {@link PAGE_LIMIT}, so an unbounded walk's worst case is a thousand
 * sequential round trips against the vendor. A hundred caps that walk at a tenth of the worst case, and
 * is a bound on this atlas's own request count rather than a claim about any tenant's shape. As with {@link WORKOS_MAX_PAGES},
 * the number matters less than the fact that hitting it is REPORTED — `syncCoverage.ts` turns a breach into a
 * `deferred` cell on the user family rather than publishing partial memberships as though they were whole.
 *
 * @internal
 */
export const WORKOS_MAX_MEMBERSHIP_WALKS = 100;

/**
 * Which field one membership walk filters on. WorkOS accepts either, and requires one of them.
 *
 * @internal
 */
export type WorkosMembershipFilter = "organization_id" | "user_id";

/**
 * What one membership walk produced.
 * @internal
 */
export interface WorkosMembershipWalk {
  readonly membershipsByUser: ReadonlyMap<string, readonly string[]>;
  /** `true` when {@link WORKOS_MAX_MEMBERSHIP_WALKS} stopped the walk rather than the id list running out. */
  readonly truncated: boolean;
  /** The first listing failure's message, or `null` when every listing answered. */
  readonly failedBecause: string | null;
}

/**
 * Walk the organisation-membership listing once per id, and group what comes back by user.
 *
 * This listing cannot be enumerated whole. `GET /user_management/organization_memberships?limit=100`
 * answers HTTP 400 — the request is MALFORMED rather than unauthorised, which is why a valid key does not
 * rescue it and an invalid one produces a different failure (401). WorkOS requires `organization_id` or
 * `user_id`, so the only way to see every membership is to ask for them a filter at a time.
 *
 * A failing listing STOPS the walk rather than continuing through the remaining ids: if the filter itself
 * is wrong again, the alternative is a hundred identical refusals aimed at the vendor. What was already
 * grouped is kept and returned beside the reason, because a prefix of the memberships is worth more than
 * nothing and `sync.ts` grades the user family on exactly that distinction.
 *
 * @param fetch the injected transport
 * @param apiKey the WorkOS secret key to authenticate with
 * @param filter which field to filter on
 * @param ids the values to walk, one listing each
 * @returns each user's organisation ids, plus whether the bound or a refusal cut the walk short
 */
export async function walkWorkosMemberships({
  fetch,
  apiKey,
  filter,
  ids,
}: {
  fetch: WorkosFetch;
  apiKey: string;
  filter: WorkosMembershipFilter;
  ids: readonly string[];
}): Promise<WorkosMembershipWalk> {
  const records: WorkosMembershipWire[] = [];
  const walked = ids.slice(0, WORKOS_MAX_MEMBERSHIP_WALKS);
  for (const id of walked) {
    const listed = await readWorkosList({
      apiKey,
      endpoint: WORKOS_MEMBERSHIPS_LIST,
      fetch,
      filter: { [filter]: id },
    });
    if (listed.isErr()) {
      return {
        failedBecause: listed.error.message,
        membershipsByUser: reduceWorkosMemberships({ records }),
        truncated: true,
      };
    }
    records.push(...listed.value.records);
    if (listed.value.truncated) {
      return {
        failedBecause: null,
        membershipsByUser: reduceWorkosMemberships({ records }),
        truncated: true,
      };
    }
  }
  return {
    failedBecause: null,
    membershipsByUser: reduceWorkosMemberships({ records }),
    truncated: walked.length < ids.length,
  };
}

/**
 * Reduce organisation records to what this atlas holds.
 *
 * @param records the organisations one read returned, each already through the strict boundary
 * @returns one record per organisation, sorted by id
 */
export function reduceWorkosOrganizations({
  records,
}: {
  records: readonly WorkosOrganizationWire[];
}): readonly WorkosOrganizationRecord[] {
  return records
    .map((record) => ({ domainCount: record.domains.length, id: record.id, name: record.name }))
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * Reduce user records to what this atlas holds.
 *
 * The organisation ids come from a separate memberships read rather than from the user object, because
 * WorkOS's user record does not carry them — see {@link reduceWorkosMemberships}.
 *
 * @param records the users one read returned, each already through the strict boundary
 * @param membershipsByUser each user's organisation ids, keyed by user id
 * @returns one record per user, sorted by id
 */
export function reduceWorkosUsers({
  records,
  membershipsByUser,
}: {
  records: readonly WorkosUserWire[];
  membershipsByUser: ReadonlyMap<string, readonly string[]>;
}): readonly WorkosUserRecord[] {
  return records
    .map((record) => ({
      emailVerified: record.email_verified,
      id: record.id,
      organizationIds: absentAsEmpty({ value: membershipsByUser.get(record.id) }),
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

/** The organisation ids a user has gathered so far, or a fresh list to push onto the first time they appear. */
function organizationsSoFar({ held }: { held: string[] | undefined }): string[] {
  if (held == null) {
    return [];
  }
  return held;
}

/**
 * Group organisation-membership records by the user they belong to.
 *
 * @param records the memberships the walk returned, each already through the strict boundary
 * @returns each user's organisation ids, sorted, keyed by user id
 */
export function reduceWorkosMemberships({
  records,
}: {
  records: readonly WorkosMembershipWire[];
}): ReadonlyMap<string, readonly string[]> {
  const byUser = new Map<string, string[]>();
  for (const record of records) {
    const held = organizationsSoFar({ held: byUser.get(record.user_id) });
    held.push(record.organization_id);
    byUser.set(record.user_id, held);
  }
  return new Map([...byUser.entries()].map(([userId, ids]) => [userId, [...new Set(ids)].toSorted()]));
}

/**
 * Reduce SSO connection records to what this atlas holds.
 *
 * @param records the connections one read returned, each already through the strict boundary
 * @returns one record per connection, sorted by id, an absent or null `organization_id` read as `unknown`
 */
export function reduceWorkosConnections({
  records,
}: {
  records: readonly WorkosConnectionWire[];
}): readonly WorkosConnectionRecord[] {
  return records
    .map((record) => ({
      connectionType: record.connection_type,
      id: record.id,
      organizationId: absentAs({ value: record.organization_id, whenAbsent: "unknown" }),
      state: record.state,
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * Reduce SCIM directory records to what this atlas holds.
 *
 * @param records the directories one read returned, each already through the strict boundary
 * @returns one record per directory, sorted by id, an absent or null `organization_id` read as `unknown`
 */
export function reduceWorkosDirectories({
  records,
}: {
  records: readonly WorkosDirectoryWire[];
}): readonly WorkosDirectoryRecord[] {
  return records
    .map((record) => ({
      directoryType: record.type,
      id: record.id,
      organizationId: absentAs({ value: record.organization_id, whenAbsent: "unknown" }),
      state: record.state,
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

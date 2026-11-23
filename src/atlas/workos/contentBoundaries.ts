/**
 * The five WorkOS list pages this atlas reads, each through its own strict boundary.
 *
 * Every list endpoint answers the same envelope — `{ "object": "list", "data": [...], "list_metadata": {
 * "before", "after" } }` — and each family's item is a `z.strictObject` declaring every key WorkOS sends: the
 * keys the reducers read typed, the rest `z.unknown().optional()`. So a key WorkOS adds, drops or renames
 * refuses the page by NAME, rather than riding into the reducer unseen or reading as a missing value.
 *
 * The key sets start from `@workos-inc/node`'s own response interfaces (`OrganizationResponse`,
 * `UserResponse`, `ConnectionResponse`, `DirectoryResponse`, `OrganizationMembershipResponse`) and are
 * corrected by a live read: `slopweaver atlas workos sync --json` names each undeclared key in its family's
 * reason. A family the tenant holds none of validates only its envelope live.
 *
 * Each endpoint is one descriptor binding its path to its own parser, so a caller cannot read `/connections`
 * through the directory boundary. A refusal names a key and never a value: the boundary's drift message is built
 * from paths and Zod's expected-type wording.
 */
import { z } from "zod";

import { type BoundaryError, defineBoundary } from "#lib/boundary.js";
import type { Result } from "#lib/result.js";

const unread = z.unknown().optional();

/** A required string the reducers read, refused when blank. */
const text = z.string().regex(/\S/u);

/** `organization_id` on a connection or directory, which WorkOS declares optional. */
const optionalOrganization = text.nullable().optional();

/** One of an organisation's domains. Only the COUNT is read, so every key is declared and none typed. */
const organizationDomainWire = z.strictObject({
  created_at: unread,
  domain: unread,
  id: unread,
  object: unread,
  organization_id: unread,
  state: unread,
  updated_at: unread,
  verification_prefix: unread,
  verification_strategy: unread,
  verification_token: unread,
});

const organizationWire = z.strictObject({
  allow_profiles_outside_organization: unread,
  created_at: unread,
  domains: z.array(organizationDomainWire),
  external_id: unread,
  id: text,
  metadata: unread,
  name: text,
  object: unread,
  stripe_customer_id: unread,
  updated_at: unread,
});

const userWire = z.strictObject({
  created_at: unread,
  email: unread,
  email_verified: z.boolean(),
  external_id: unread,
  first_name: unread,
  id: text,
  last_name: unread,
  last_sign_in_at: unread,
  locale: unread,
  metadata: unread,
  name: unread,
  object: unread,
  profile_picture_url: unread,
  updated_at: unread,
});

const connectionWire = z.strictObject({
  connection_type: text,
  created_at: unread,
  domains: unread,
  id: text,
  name: unread,
  object: unread,
  organization_id: optionalOrganization,
  state: text,
  updated_at: unread,
});

const directoryWire = z.strictObject({
  created_at: unread,
  domain: unread,
  external_key: unread,
  id: text,
  metadata: unread,
  name: unread,
  object: unread,
  organization_id: optionalOrganization,
  state: text,
  type: text,
  updated_at: unread,
});

const membershipWire = z.strictObject({
  created_at: unread,
  custom_attributes: unread,
  directory_managed: unread,
  id: unread,
  object: unread,
  organization_id: text,
  organization_name: unread,
  role: unread,
  roles: unread,
  status: unread,
  updated_at: unread,
  user: unread,
  user_id: text,
});

/** One organisation as the wire carries it, every key declared. */
export type WorkosOrganizationWire = z.output<typeof organizationWire>;
/** One user as the wire carries it, every key declared. */
export type WorkosUserWire = z.output<typeof userWire>;
/** One SSO connection as the wire carries it, every key declared. */
export type WorkosConnectionWire = z.output<typeof connectionWire>;
/** One SCIM directory as the wire carries it, every key declared. */
export type WorkosDirectoryWire = z.output<typeof directoryWire>;
/** One organisation membership as the wire carries it, every key declared. */
export type WorkosMembershipWire = z.output<typeof membershipWire>;

/**
 * One list page, read: its records and the cursor to the next page, `null` on the last.
 * @internal — named only by {@link WorkosListEndpoint}'s signature.
 */
export interface WorkosListPage<T> {
  readonly records: readonly T[];
  readonly after: string | null;
}

/**
 * The paths this atlas lists.
 * @internal — named only by {@link WorkosListEndpoint}'s signature.
 */
export type WorkosListPath =
  | "/organizations"
  | "/user_management/users"
  | "/connections"
  | "/directories"
  | "/user_management/organization_memberships";

/** One list endpoint: its path, bound to the parser for the page it answers. */
export interface WorkosListEndpoint<T> {
  readonly path: WorkosListPath;
  readonly readPage: (input: { text: string }) => Result<WorkosListPage<T>, BoundaryError>;
}

/**
 * Bind one path to a strict page boundary over its item schema. `list_metadata.after` is required, because the
 * walk reads it: a page without one is drift, never "the list is over".
 *
 * `camelTwin` is per endpoint because the twin is: MEASURED with `slopweaver atlas workos sync`,
 * /organizations, /connections and /directories also send a camelCase `listMetadata` beside `list_metadata`,
 * and /user_management/users and the filtered membership listing do not. An endpoint declared without it refuses one that arrives.
 */
function listEndpoint<S extends z.ZodType>({
  path,
  item,
  camelTwin,
}: {
  path: WorkosListPath;
  item: S;
  camelTwin: boolean;
}): WorkosListEndpoint<z.output<S>> {
  const boundary = defineBoundary({
    endpoint: `GET ${path}`,
    schema: z.strictObject({
      data: z.array(item),
      list_metadata: z.strictObject({ after: z.string().min(1).nullable(), before: unread }),
      ...(camelTwin ? { listMetadata: unread } : {}),
      object: unread,
    }),
  });
  return {
    path,
    readPage: ({ text: body }) =>
      boundary.parseJson({ text: body }).map((page) => ({ after: page.list_metadata.after, records: page.data })),
  };
}

/** `GET /organizations`. */
export const WORKOS_ORGANIZATIONS_LIST = listEndpoint({
  camelTwin: true,
  item: organizationWire,
  path: "/organizations",
});

/** `GET /user_management/users`. */
export const WORKOS_USERS_LIST = listEndpoint({ camelTwin: false, item: userWire, path: "/user_management/users" });

/** `GET /connections`. */
export const WORKOS_CONNECTIONS_LIST = listEndpoint({ camelTwin: true, item: connectionWire, path: "/connections" });

/** `GET /directories`. */
export const WORKOS_DIRECTORIES_LIST = listEndpoint({ camelTwin: true, item: directoryWire, path: "/directories" });

/** `GET /user_management/organization_memberships`, which refuses to be listed without a filter. */
export const WORKOS_MEMBERSHIPS_LIST = listEndpoint({
  camelTwin: false,
  item: membershipWire,
  path: "/user_management/organization_memberships",
});

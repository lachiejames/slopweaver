/**
 * The GCP audit-log reader's one way to the network: a closed union of READ operations, each mapped to exactly
 * one method, host and path family. No caller supplies a URL, a method, a header or a free query map.
 *
 * ## Why the rail is a type and not the credential
 *
 * The reader rides the owner's Application Default Credential, whose scope is `cloud-platform` — gcloud refuses to
 * narrow it for a user login (measured), so the token
 * could write anywhere the owner's roles reach. The read-only property therefore lives HERE: {@link GcpAuditRequest}
 * has no member that writes, and {@link buildGcpAuditRequest} is the only code that turns one into a URL.
 * Two members are POST because Google defines them as POST reads — `entries:list` and `getIamPolicy` — and
 * `src/__tests__/unit/gcpAudit/transport.test.ts` pins that list so a third cannot arrive unnoticed.
 *
 * Every request carries `x-goog-user-project`, so the quota and billing land on the project the caller names
 * (`acme-local` on an install: the one project the owner owns with the APIs on).
 */
import type { GoogleAuth } from "googleapis-common";

import { unsetFieldAsNull } from "#lib/absent.js";
import { safeProviderCall } from "#lib/providerCall.js";
import { err, ok, type Result } from "#lib/result.js";

import { type GcpAuditError, GcpAuditErrors } from "./errors.js";

/** A resource container whose logs, buckets and sinks the reader may list. */
export type GcpContainer = `organizations/${string}` | `folders/${string}` | `projects/${string}`;

/** The body `entries:list` takes — built only by `filter.ts`'s batcher. */
export interface EntriesListBody {
  readonly resourceNames: readonly GcpContainer[];
  readonly filter: string;
  readonly orderBy: "timestamp asc";
  readonly pageSize: number;
  readonly pageToken?: string;
}

/** Every operation the reader can perform. A member that writes is the read-only rail broken. */
export type GcpAuditRequest =
  | { readonly kind: "search-projects"; readonly pageToken?: string }
  | { readonly kind: "search-folders"; readonly pageToken?: string }
  | { readonly kind: "list-entries"; readonly body: EntriesListBody }
  | { readonly kind: "list-buckets"; readonly parent: GcpContainer; readonly pageToken?: string }
  | { readonly kind: "list-sinks"; readonly parent: GcpContainer; readonly pageToken?: string }
  | { readonly kind: "get-role"; readonly role: string }
  | { readonly kind: "get-iam-policy"; readonly resource: `organizations/${string}` | `projects/${string}` };

/** One built request: what {@link sendGcpAuditRequest} sends, and nothing it may change. */
export interface BuiltGcpAuditRequest {
  readonly operation: string;
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly body: Readonly<Record<string, unknown>> | undefined;
}

/** The hosts the reader reaches. */
const RESOURCE_MANAGER = "https://cloudresourcemanager.googleapis.com";
const LOGGING = "https://logging.googleapis.com";
const IAM = "https://iam.googleapis.com";

/** A container name the reader will put in a path: an org or folder number, or a project id. */
const CONTAINER = /^(?:organizations\/\d{1,20}|folders\/\d{1,20}|projects\/[a-z][a-z0-9-]{4,28}[a-z0-9])$/;

/**
 * A role name `iam.roles.get` reads: predefined, or an organisation's or a project's custom role. A role id
 * opens on a letter, digit or underscore, so `.` and `..` can never be a whole path segment that URL
 * normalisation would fold into the roles COLLECTION.
 */
const ROLE_ID = String.raw`[A-Za-z0-9_][A-Za-z0-9_.]{0,99}`;
const ROLE = new RegExp(
  String.raw`^(?:roles\/${ROLE_ID}|organizations\/\d{1,20}\/roles\/${ROLE_ID}|projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/roles\/${ROLE_ID})$`,
);

/** A page token is opaque, but never a place to smuggle a path or a second parameter. */
const PAGE_TOKEN = /^[A-Za-z0-9_\-=.+/]{1,4096}$/;

/** Projects and folders per page on a Resource Manager search; the API's own maximum. */
const SEARCH_PAGE_SIZE = "500";

/**
 * A URL with its query set, refusing a page token that is not one.
 *
 * @param base the URL without its query
 * @param query the parameters to set; an undefined value is left off
 * @returns the URL text, or the refusal
 */
function withQuery({
  base,
  query,
}: {
  base: string;
  query: Readonly<Record<string, string | undefined>>;
}): Result<string, GcpAuditError> {
  const url = new URL(base);
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    if (name === "pageToken" && !PAGE_TOKEN.test(value)) {
      return err(GcpAuditErrors.requestRefused({ what: base, why: "the page token is not an opaque token" }));
    }
    url.searchParams.set(name, value);
  }
  return ok(url.toString());
}

/**
 * Refuse a container that is not an org, folder or project name.
 *
 * @param container the name a caller passed
 * @returns the name, or the refusal
 */
function checkedContainer({ container }: { container: string }): Result<string, GcpAuditError> {
  if (!CONTAINER.test(container)) {
    return err(GcpAuditErrors.requestRefused({ what: container, why: "not an organisation, folder or project name" }));
  }
  return ok(container);
}

/**
 * Whether a name is an organisation, folder or project container in exactly the shape a request may carry — the
 * shape a log name's origin takes. A billing account is not one: the reader never searches it.
 *
 * @param value a container-shaped name read off Google's answer
 * @returns true when it is a numeric organisation or folder, or a well-formed project id
 */
export function isGcpContainer(value: string): value is GcpContainer {
  return CONTAINER.test(value);
}

/** One member of {@link GcpAuditRequest}, by its `kind`. */
type RequestOf<K extends GcpAuditRequest["kind"]> = Extract<GcpAuditRequest, { readonly kind: K }>;

/**
 * A Resource Manager search, one page.
 *
 * @param request a project or folder search
 * @returns the GET, or the refusal of a page token that is not one
 */
function buildSearch({
  request,
}: {
  request: RequestOf<"search-projects" | "search-folders">;
}): Result<BuiltGcpAuditRequest, GcpAuditError> {
  const noun = request.kind === "search-projects" ? "projects" : "folders";
  return withQuery({
    base: `${RESOURCE_MANAGER}/v3/${noun}:search`,
    query: { pageSize: SEARCH_PAGE_SIZE, pageToken: request.pageToken },
  }).map((url) => ({ body: undefined, method: "GET", operation: `gcp.resourcemanager.${noun}.search`, url }));
}

/**
 * One `entries:list` page, every resource name and the page token checked first.
 *
 * @param request the entries read
 * @returns the POST, or the refusal naming the bad container or token
 */
function buildListEntries({
  request,
}: {
  request: RequestOf<"list-entries">;
}): Result<BuiltGcpAuditRequest, GcpAuditError> {
  const bad = request.body.resourceNames.find((name) => !CONTAINER.test(name));
  if (bad !== undefined) {
    return err(GcpAuditErrors.requestRefused({ what: bad, why: "not an organisation, folder or project name" }));
  }
  if (request.body.pageToken !== undefined && !PAGE_TOKEN.test(request.body.pageToken)) {
    return err(GcpAuditErrors.requestRefused({ what: "entries:list", why: "the page token is not an opaque token" }));
  }
  return ok({
    body: { ...request.body },
    method: "POST",
    operation: "gcp.logging.entries.list",
    url: `${LOGGING}/v2/entries:list`,
  });
}

/**
 * One page of a container's logging buckets or sinks.
 *
 * @param request the bucket or sink list
 * @returns the GET, or the refusal of a container or page token that is not one
 */
function buildInventoryList({
  request,
}: {
  request: RequestOf<"list-buckets" | "list-sinks">;
}): Result<BuiltGcpAuditRequest, GcpAuditError> {
  const buckets = request.kind === "list-buckets";
  const noun = buckets ? "locations/-/buckets" : "sinks";
  const operation = buckets ? "gcp.logging.buckets.list" : "gcp.logging.sinks.list";
  return checkedContainer({ container: request.parent })
    .andThen((parent) =>
      withQuery({ base: `${LOGGING}/v2/${parent}/${noun}`, query: { pageToken: request.pageToken } }),
    )
    .map((url) => ({ body: undefined, method: "GET", operation, url }));
}

/**
 * One role read, refusing a name that is not a role or that URL normalisation would move.
 *
 * @param request the role read
 * @returns the GET, or the refusal
 */
function buildGetRole({ request }: { request: RequestOf<"get-role"> }): Result<BuiltGcpAuditRequest, GcpAuditError> {
  if (!ROLE.test(request.role)) {
    return err(GcpAuditErrors.requestRefused({ what: request.role, why: "not a predefined or custom role name" }));
  }
  const url = new URL(`${IAM}/v1/${request.role}`);
  if (url.pathname !== `/v1/${request.role}`) {
    return err(GcpAuditErrors.requestRefused({ what: request.role, why: "the role name changes the URL path" }));
  }
  return ok({ body: undefined, method: "GET", operation: "gcp.iam.roles.get", url: url.toString() });
}

/**
 * One allow-policy read, on Resource Manager v3 for an organisation and v1 for a project.
 *
 * @param request the policy read
 * @returns the POST Google defines as a read, or the refusal of a resource that is not a container
 */
function buildGetIamPolicy({
  request,
}: {
  request: RequestOf<"get-iam-policy">;
}): Result<BuiltGcpAuditRequest, GcpAuditError> {
  const base = request.resource.startsWith("organizations/") ? "v3" : "v1";
  return checkedContainer({ container: request.resource }).map((resource) => ({
    body: { options: { requestedPolicyVersion: 3 } },
    method: "POST",
    operation: "gcp.resourcemanager.getIamPolicy",
    url: `${RESOURCE_MANAGER}/${base}/${resource}:getIamPolicy`,
  }));
}

/**
 * Turn one operation into the exact request the reader sends. Pure, and the ONLY code that builds a URL.
 *
 * @param request the operation
 * @returns the method, URL and body, or `REQUEST_REFUSED` naming what was refused
 */
export function buildGcpAuditRequest({
  request,
}: {
  request: GcpAuditRequest;
}): Result<BuiltGcpAuditRequest, GcpAuditError> {
  switch (request.kind) {
    case "search-projects":
    case "search-folders":
      return buildSearch({ request });
    case "list-entries":
      return buildListEntries({ request });
    case "list-buckets":
    case "list-sinks":
      return buildInventoryList({ request });
    case "get-role":
      return buildGetRole({ request });
    case "get-iam-policy":
      return buildGetIamPolicy({ request });
    default: {
      const unreachable: never = request;
      return unreachable;
    }
  }
}

/** The send seam, injectable so the paging shell is tested with a plain fake. */
export type GcpAuditSend = (args: { request: GcpAuditRequest }) => Promise<Result<unknown, GcpAuditError>>;

/**
 * Build a sender over the owner's Application Default Credential, billing every call to `quotaProject`.
 *
 * @param auth a fresh `GoogleAuth` over the cloud-platform scope
 * @param quotaProject the project every call's quota and billing land on
 * @returns the sender: one paced, transiently-retried call per request, the body untyped until a boundary reads it
 */
export function gcpAuditSender({ auth, quotaProject }: { auth: GoogleAuth; quotaProject: string }): GcpAuditSend {
  return async ({ request }) => {
    const built = buildGcpAuditRequest({ request });
    if (built.isErr()) {
      return err(built.error);
    }
    const { body, method, operation, url } = built.value;
    const answered = await safeProviderCall({
      execute: () =>
        auth.request<unknown>({
          ...(body === undefined ? {} : { data: body }),
          headers: { "x-goog-user-project": quotaProject },
          method,
          redirect: "error",
          url,
        }),
      operation,
      provider: "gcp",
      retryMode: "transient",
      scopeId: quotaProject,
    });
    if (answered.isErr()) {
      return err(
        GcpAuditErrors.transportFailed({
          detail: answered.error.message,
          operation,
          status: unsetFieldAsNull({ key: "status", record: answered.error }),
        }),
      );
    }
    return ok(answered.value.data);
  };
}

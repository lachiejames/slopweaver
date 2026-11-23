/**
 * Which of Google's 336 published methods this atlas may actually CALL, decided from the committed
 * registry and the scopes a grant carries — the whole judgement, and none of the I/O.
 *
 * ## Three filters, each of which is a finding when it excludes something
 *
 * A method reaches the plan only when all three pass, and every exclusion is REPORTED rather than dropped.
 * That is the point: `docs/atlas-intent/settled-decisions.md` calls the gap list a deliverable, and "we called 40 things"
 * says nothing without "and here is each one we could not, and why".
 *
 * 1. **It must be CALLABLE with what an unfilled atlas holds**, which is nothing but the customer alias.
 *    A path placeholder or a required parameter naming a record — an extension id, a group key, a search
 *    query — cannot be supplied by an install that has read no records yet.
 * 2. **It must READ.** `disposition === "entity"` and `method === "GET"`. `dispositions.ts` decides read
 *    versus write from what an operation DOES rather than from the scope it declares, and this module does
 *    not second-guess it — 180 of the 336 are excluded there and none of them is reconsidered here.
 * 3. **Its path must be resolvable from nothing.** A path template naming only the customer
 *    ({@link GOOGLE_ADMIN_PATH_SUBSTITUTIONS}) can be called by an install that has just consented. One
 *    naming a user key, a group id or a matter id cannot, because that identifier comes from a record this
 *    atlas has not read yet. MEASURED on the committed registry: 44 of the 125 read GETs resolve,
 *    and the other 81 are per-record reads whose parent has to exist first.
 * 4. **The grant must carry one of its scopes.** A grant narrower than the whole surface fills what it
 *    reaches and reports the rest, rather than refusing the run.
 *
 * ## Why the collection field is derived rather than listed
 *
 * Every one of these responses is an envelope with exactly one field that is not paging or bookkeeping —
 * `users`, `groups`, `chromeosdevices`, `matters`. A hand-kept list of 40 field names would stop matching
 * the table the day Google republishes, silently, while still reading plausibly. So it is computed by
 * subtracting {@link ENVELOPE_FIELDS}, and `plan.test.ts` asserts that EVERY planned row leaves exactly
 * one field standing — the day one leaves two, that assertion fails rather than a fill guessing.
 *
 * Whether that single field holds an ARRAY is not knowable here and is not guessed. Two planned rows are
 * aggregates rather than collections (`countChromeOsDevices` answers `count`, `groups.lookup` answers
 * `name`), so the runtime decides, and `records.ts` stores entities only for an array of objects.
 *
 * Pure: no I/O, no clock, no credential.
 */
import { GOOGLE_ADMIN_SURFACES } from "../generated/surfaces.js";
import type { GoogleAdminSurfaceRow } from "../surfaceRow.js";

/**
 * The path placeholders an install can fill with no prior read, and what it fills them with.
 *
 * `my_customer` is Google's own alias for "the account this credential belongs to", and it is the reason
 * this plan exists at all — without it every one of these paths would need a customer id, which is itself a
 * record an unfilled atlas has not read. The three keys are one idea spelled three ways across the
 * documents: the Directory API templates `{customerId}`, its Chrome printer resources template
 * `{customer}`, and the Chrome Management and Policy APIs template `{customersId}`.
 */
export const GOOGLE_ADMIN_PATH_SUBSTITUTIONS: Readonly<Record<string, string>> = {
  customer: "my_customer",
  customerId: "my_customer",
  customersId: "my_customer",
} as const;

/**
 * Response fields that are the envelope rather than the payload.
 *
 * Subtracting these from a method's declared `responseFields` leaves the collection — see this file's
 * header for why that is derived rather than listed, and `plan.test.ts` for the assertion that keeps it
 * honest.
 */
const ENVELOPE_FIELDS: ReadonlySet<string> = new Set([
  "etag",
  "kind",
  "nextPageToken",
  "nextSyncToken",
  "totalSize",
  // Declared on `directory.users.list` alone. It is a Google bookkeeping field rather than a payload, and
  // leaving it in would make that one row the only planned method with two candidate collections.
  "trigger_event",
  "unreachable",
]);

/**
 * The query parameters an operation needs that Google's own discovery document does not say it needs.
 *
 * ## Every row here is a MEASURED 400, and each carries the response that put it there
 *
 * MEASURED, against a real Workspace under a real grant (reproduce with
 * `slopweaver atlas google-admin fill`). These operations declare `parametersRequired: []`, or declare only
 * a parameter the path already carries, and the API then refuses the call. The gap between what a vendor
 * DECLARES and what it ENFORCES is exactly what an atlas exists to surface, so it is written down here
 * rather than worked around silently.
 *
 * `my_customer` is Google's own alias for the account a credential belongs to, the same one
 * {@link GOOGLE_ADMIN_PATH_SUBSTITUTIONS} uses.
 */
const GOOGLE_ADMIN_QUERY_PARAMETERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // "read_mask is required". The mask names which telemetry fields to return, and these are the cheap
  // identity ones rather than the whole declared schema: this atlas stores field NAMES rather than values,
  // so asking for the expensive reports would cost the account something and tell this store nothing.
  "chromemanagement.customers.telemetry.devices.list": { readMask: "name,deviceId,orgUnitId,serialNumber" },
  // "Page size when specified must be between 1 and 100" — refused when the caller sends none at all.
  "chromemanagement.customers.telemetry.notificationConfigs.list": { pageSize: "100" },
  "chromemanagement.customers.telemetry.users.list": { readMask: "name,orgUnitId" },
  // "Bad Request", with no further detail. The document declares `customer` optional; the API demands
  // either it or `domain`.
  "directory.groups.list": { customer: "my_customer" },
  "directory.users.list": { customer: "my_customer" },
};

/** The measured query parameters one operation must send, and none for an operation with no entry. */
function queryParametersFor({ id }: { id: string }): Readonly<Record<string, string>> {
  const measured = GOOGLE_ADMIN_QUERY_PARAMETERS[id];
  if (measured == null) {
    return {};
  }
  return measured;
}

/**
 * Operations whose call needs an identifier only a RECORD carries, named by the parameter that carries it.
 *
 * The query-parameter sibling of an unresolvable path placeholder, and it exists for the same reason: an
 * install that has read nothing has no extension id, no group key and no search query to offer. MEASURED
 * the same way, each answering a 400 naming exactly this. Excluding them turns four cells from
 * `unreadable`, which reads as something being wrong, into a plain statement that a parent record has to
 * exist first.
 */
const GOOGLE_ADMIN_RECORD_BOUND_PARAMETERS: Readonly<Record<string, string>> = {
  // "Extension id is required."
  "chromemanagement.customers.apps.fetchDevicesRequestingExtension": "extensionId",
  "chromemanagement.customers.apps.fetchUsersRequestingExtension": "extensionId",
  // "Parent must be specified", and then "Request contains an invalid argument" for
  // `parent=customers/my_customer`. Cloud Identity is the one API here that REFUSES Google's own customer
  // alias and demands the account's real customer id, which is a record this atlas has not read. That
  // refusal of `my_customer` is itself a finding: every other API in these eleven documents accepts it.
  "cloudidentity.groups.list": "parent",
  // "Error(1001): Entity Id must be set."
  "cloudidentity.groups.lookup": "groupKey.id",
  // "Query must be specified"
  "cloudidentity.groups.search": "query",
};

/**
 * Why a read-disposition method did not reach the plan.
 * @internal
 */
export type GoogleAdminPlanExclusion =
  "path-needs-a-record" | "parameter-needs-a-record" | "scope-not-granted" | "no-declared-scope";

/** One method this fill will call, with everything the caller needs and nothing it has to look up. */
export interface GoogleAdminPlannedCall {
  /** The registry method id, which is what a report names. */
  readonly id: string;
  /** The document it was declared in — half of the provider key, since two documents share a method id. */
  readonly document: string;
  /**
   * The kind its result lands under, as the registry spells it.
   *
   * `string` rather than {@link ../model.js#GoogleAdminAtlasKind}, matching the row it came from. The
   * registry is generated, so its kinds are not a closed set this module can assert — `sync.ts` already
   * refuses a whole generation whose registry names a kind the model does not declare, and a second copy
   * of that check here would be a second thing to keep in step with the first.
   */
  readonly kind: string;
  /** The document's own base URL. */
  readonly baseUrl: string;
  /** The path with every placeholder substituted, so a caller concatenates rather than templating. */
  readonly path: string;
  /** The one response field that carries the payload. */
  readonly collectionField: string;
  /** How the method pages, straight from the registry. */
  readonly paging: string;
  /** The granted scope that authorises it, for the report. */
  readonly scope: string;
  /**
   * Query parameters to send, from {@link GOOGLE_ADMIN_QUERY_PARAMETERS}. Empty for most operations, and
   * never guessed — every entry is a measured refusal.
   */
  readonly query: Readonly<Record<string, string>>;
}

/**
 * One method this fill will NOT call, and why — a finding, never a silent drop.
 * @internal
 */
export interface GoogleAdminExcludedCall {
  readonly id: string;
  /** The kind it would have landed under, as the registry spells it. */
  readonly kind: string;
  readonly exclusion: GoogleAdminPlanExclusion;
  /** What specifically blocked it — the unresolvable placeholder, or the scopes it wanted. */
  readonly detail: string;
}

/** What one grant can and cannot reach across the whole published surface. */
export interface GoogleAdminFillPlan {
  readonly calls: readonly GoogleAdminPlannedCall[];
  readonly excluded: readonly GoogleAdminExcludedCall[];
}

/**
 * The placeholders a path template names, in the order they appear.
 *
 * @param path the registry's own path template
 * @returns each `{name}` placeholder's name
 */
export function googleAdminPathPlaceholders({ path }: { path: string }): readonly string[] {
  // The capture group is not optional in the pattern, so a match always carries it — the assertion is the
  // honest spelling here rather than a coalesce that would invent an empty placeholder name.
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
}

/**
 * Substitute every placeholder a path names, or say which one cannot be.
 *
 * @param path the registry's own path template
 * @returns the resolved path, or the first placeholder no substitution covers
 */
export function googleAdminResolvePath({ path }: { path: string }): { path: string } | { blockedBy: string } {
  // Each placeholder is looked up exactly once: a miss is recorded and blocks the whole path, never substituted.
  const unsubstituted: string[] = [];
  const resolved = path.replaceAll(/\{([^}]+)\}/g, (match, name: string) => {
    const value = GOOGLE_ADMIN_PATH_SUBSTITUTIONS[name];
    if (value === undefined) {
      unsubstituted.push(name);
      return match;
    }
    return value;
  });
  const blocking = unsubstituted[0];
  if (blocking !== undefined) {
    return { blockedBy: blocking };
  }
  return { path: resolved };
}

/**
 * The one response field that carries a method's payload.
 *
 * @param row the registry row
 * @returns the collection field, or `null` when the envelope subtraction does not leave exactly one
 */
export function googleAdminCollectionField({ row }: { row: GoogleAdminSurfaceRow }): string | null {
  const payload = row.responseFields.filter((field) => !ENVELOPE_FIELDS.has(field));
  if (payload.length !== 1) {
    return null;
  }
  // The length was just checked to be exactly one, so index 0 is present.
  return payload[0]!;
}

/**
 * Which published methods a grant may call, and why each of the others may not.
 *
 * @param granted the scope URIs the stored grant actually carries
 * @returns the plan, both halves sorted by method id so two runs report identically
 */
export function googleAdminFillPlan({ granted }: { granted: readonly string[] }): GoogleAdminFillPlan {
  const calls: GoogleAdminPlannedCall[] = [];
  const excluded: GoogleAdminExcludedCall[] = [];
  for (const row of GOOGLE_ADMIN_SURFACES) {
    if (row.disposition !== "entity" || row.method !== "GET") {
      continue;
    }
    const verdict = judgeRow({ granted, row });
    if ("exclusion" in verdict) {
      excluded.push({ detail: verdict.detail, exclusion: verdict.exclusion, id: row.id, kind: row.kind });
      continue;
    }
    if (verdict.call !== null) {
      calls.push(verdict.call);
    }
  }
  return {
    calls: calls.toSorted((left, right) => left.id.localeCompare(right.id)),
    excluded: excluded.toSorted((left, right) => left.id.localeCompare(right.id)),
  };
}

/**
 * Put one read-disposition row through the four filters, in the order this file's header states.
 *
 * @param row the registry row
 * @param granted the scope URIs the stored grant carries
 * @returns the planned call, a `null` call for a row whose payload field is ambiguous, or the exclusion
 * @internal
 */
function judgeRow({
  row,
  granted,
}: {
  row: GoogleAdminSurfaceRow;
  granted: readonly string[];
}):
  | { readonly call: GoogleAdminPlannedCall | null }
  | { readonly exclusion: GoogleAdminPlanExclusion; readonly detail: string } {
  const recordBound = GOOGLE_ADMIN_RECORD_BOUND_PARAMETERS[row.id];
  if (recordBound !== undefined) {
    return {
      detail: `it requires ${recordBound}, which names a record this atlas has not read`,
      exclusion: "parameter-needs-a-record",
    };
  }
  const resolved = googleAdminResolvePath({ path: row.path });
  if ("blockedBy" in resolved) {
    return {
      detail: `its path templates {${resolved.blockedBy}}, which names a record this atlas has not read`,
      exclusion: "path-needs-a-record",
    };
  }
  if (row.scopes.length === 0) {
    return {
      detail: "Google publishes it with an empty scopes array, so no grant can authorise it",
      exclusion: "no-declared-scope",
    };
  }
  const scope = row.scopes.find((candidate) => granted.includes(candidate));
  if (scope === undefined) {
    return { detail: `this grant carries none of ${row.scopes.join(", ")}`, exclusion: "scope-not-granted" };
  }
  const collectionField = googleAdminCollectionField({ row });
  if (collectionField === null) {
    return { call: null };
  }
  return {
    call: {
      baseUrl: row.baseUrl,
      collectionField,
      document: row.document,
      id: row.id,
      kind: row.kind,
      paging: row.paging,
      path: resolved.path,
      query: queryParametersFor({ id: row.id }),
      scope,
    },
  };
}

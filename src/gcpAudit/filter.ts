/**
 * The Logging filter the reader sends, and how the containers it searches are cut into `entries:list` calls.
 *
 * Pure. Two documented limits shape a batch: at most {@link MAX_RESOURCE_NAMES} `resourceNames` per call, and a
 * filter no longer than {@link MAX_FILTER_CHARACTERS} (the `entries.list` reference). A query naming
 * `organizations/<n>` searches only entries ORIGINATING in the organisation itself, never its projects, so the
 * caller passes every folder and project as well.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type GcpAuditError, GcpAuditErrors } from "./errors.js";
import type { EntriesListBody, GcpContainer } from "./transport.js";

/** `entries:list`'s documented ceiling on `resourceNames`. */
export const MAX_RESOURCE_NAMES = 100;

/** `entries:list`'s documented ceiling on the filter's length. */
const MAX_FILTER_CHARACTERS = 20_000;

/** Entries per page; the API's maximum. */
const ENTRIES_PAGE_SIZE = 1000;

/** The four Cloud Audit Log streams. */
const AUDIT_LOG_IDS = [
  "cloudaudit.googleapis.com/activity",
  "cloudaudit.googleapis.com/data_access",
  "cloudaudit.googleapis.com/policy",
  "cloudaudit.googleapis.com/system_event",
] as const;

/** An RFC 3339 instant in UTC, the only shape `--since` accepts. */
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

/** A principal the filter names: an email-shaped identity, nothing that could close the string. */
const PRINCIPAL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/;

/**
 * Quote a value as a Logging filter string literal.
 *
 * @param value the raw text
 * @returns the literal, quotes and backslashes escaped
 */
export function quoteFilterString({ value }: { value: string }): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * The filter over every audit stream since an instant, narrowed to named principals unless `all`.
 *
 * @param since the earliest timestamp, RFC 3339 UTC
 * @param principals the identities whose calls to read, or `all` for every principal
 * @returns the filter text, or `INPUT_INVALID` naming the bad value
 */
export function buildAuditFilter({
  since,
  principals,
}: {
  since: string;
  principals: readonly string[] | "all";
}): Result<string, GcpAuditError> {
  if (!RFC3339_UTC.test(since) || Number.isNaN(Date.parse(since))) {
    return err(
      GcpAuditErrors.inputInvalid({ why: `--since ${since} is not an RFC 3339 UTC instant like 2025-08-29T00:00:00Z` }),
    );
  }
  const logs = AUDIT_LOG_IDS.map((id) => `log_id(${quoteFilterString({ value: id })})`).join(" OR ");
  const clauses = [`(${logs})`, `timestamp >= ${quoteFilterString({ value: since })}`];
  if (principals !== "all") {
    if (principals.length === 0) {
      return err(GcpAuditErrors.inputInvalid({ why: "name at least one --principal, or pass --all-principals" }));
    }
    const bad = principals.find((principal) => !PRINCIPAL.test(principal));
    if (bad !== undefined) {
      return err(GcpAuditErrors.inputInvalid({ why: `--principal ${bad} is not an email-shaped identity` }));
    }
    const named = principals
      .map((principal) => `protoPayload.authenticationInfo.principalEmail = ${quoteFilterString({ value: principal })}`)
      .join(" OR ");
    clauses.push(`(${named})`);
  }
  const filter = clauses.join(" AND ");
  if (filter.length > MAX_FILTER_CHARACTERS) {
    return err(
      GcpAuditErrors.inputInvalid({
        why: `the filter is ${String(filter.length)} characters, over the ${String(MAX_FILTER_CHARACTERS)} entries:list accepts — name fewer principals`,
      }),
    );
  }
  return ok(filter);
}

/**
 * The views one `entries:list` call may span. Undocumented on the reference page; MEASURED, a call
 * over about a hundred containers answered HTTP 400 "Request exceeds maximum of 200 views". Repro:
 * `slopweaver google audit-log pull` with {@link viewsOf} returning 1 for every container.
 */
export const MAX_VIEWS = 200;

/**
 * How many log views searching one container reads: every bucket it holds carries `_AllLogs`, and `_Default`
 * carries a second, so twice its bucket count — and at least two, for a container whose buckets went unread.
 *
 * @param buckets how many buckets the inventory saw in the container
 * @returns the views it is charged against {@link MAX_VIEWS}
 */
export function viewsOf({ buckets }: { buckets: number }): number {
  return Math.max(2, buckets * 2);
}

/**
 * Cut the containers into `entries:list` bodies, in order, each within {@link MAX_RESOURCE_NAMES} names and
 * {@link MAX_VIEWS} views.
 *
 * @param resources every container to search, each exactly once
 * @param filter the filter every body carries
 * @param views the views each container is charged, from {@link viewsOf}
 * @returns one body per batch; an empty list for no containers
 */
export function batchEntryBodies({
  resources,
  filter,
  views,
}: {
  resources: readonly GcpContainer[];
  filter: string;
  views: (args: { container: GcpContainer }) => number;
}): readonly EntriesListBody[] {
  const bodies: EntriesListBody[] = [];
  let current: GcpContainer[] = [];
  let charged = 0;
  const flush = (): void => {
    if (current.length > 0) {
      bodies.push({ filter, orderBy: "timestamp asc", pageSize: ENTRIES_PAGE_SIZE, resourceNames: current });
    }
    current = [];
    charged = 0;
  };
  for (const container of resources) {
    const cost = views({ container });
    if (current.length === MAX_RESOURCE_NAMES || charged + cost > MAX_VIEWS) {
      flush();
    }
    current.push(container);
    charged += cost;
  }
  flush();
  return bodies;
}

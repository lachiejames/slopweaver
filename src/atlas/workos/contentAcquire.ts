/**
 * Reading the credentialled half of one WorkOS sync, and grading each family on its own.
 *
 * ## The four families are graded SEPARATELY, and that is the design
 *
 * Organisations, users, SSO connections and SCIM directories are four independent endpoints with four
 * independent failure modes. MEASURED: a run read all four fine and then called
 * `GET /user_management/organization_memberships?limit=100`, which WorkOS refuses with HTTP 400 because
 * that listing requires `organization_id` or `user_id` — and one shared outcome turned that single
 * malformed call into a published run reporting zero organisations, zero users, zero connections and zero
 * directories. Every family is therefore ATTEMPTED whatever the ones before it did, and carries its own
 * grade: the sync reads that grade for its merge mode (`merge.ts`), its coverage cell (`syncCoverage.ts`)
 * and its gap (`syncGaps.ts`), and `sync.ts` reads the ROLLUP for nothing but the exit code.
 *
 * ## Memberships are not a family
 *
 * They mint no kind and no entity — `contentRead.ts`'s walk only supplies each user's `organizationIds`.
 * So a membership walk that stopped short does not make the user LIST wrong; it makes each published
 * user's organisation list a prefix. That is graded `truncated`, which is this atlas's existing word for
 * exactly that, and which selects the partial merge that stales nothing.
 */
import type { Result } from "../../lib/result.js";

import type { WorkosFetch } from "./client.js";
import {
  WORKOS_CONNECTIONS_LIST,
  WORKOS_DIRECTORIES_LIST,
  WORKOS_ORGANIZATIONS_LIST,
  WORKOS_USERS_LIST,
  type WorkosOrganizationWire,
  type WorkosUserWire,
} from "./contentBoundaries.js";
import {
  readWorkosList,
  reduceWorkosConnections,
  reduceWorkosDirectories,
  reduceWorkosOrganizations,
  reduceWorkosUsers,
  WORKOS_MAX_MEMBERSHIP_WALKS,
  type WorkosMembershipWalk,
  type WorkosPagedRead,
  walkWorkosMemberships,
} from "./contentRead.js";
import { isWorkosCredentialGap, type WorkosApiError } from "./errors.js";
import type { WorkosAtlasKind } from "./model.js";
import type {
  WorkosConnectionRecord,
  WorkosDirectoryRecord,
  WorkosOrganizationRecord,
  WorkosUserRecord,
} from "./projection.js";

/** How the content half of one sync went. Graded per FAMILY, and rolled up once for the exit code. */
export type WorkosContentOutcome = "synced" | "not-configured" | "truncated" | "failed";

/**
 * The four kinds a credential fills. The other two — `operation` and `page` — are published on every run,
 * credential or not, so they are never graded by a content outcome at all.
 *
 * @internal
 */
export const WORKOS_CONTENT_KINDS = ["organization", "user", "connection", "directory"] as const;

/** One of the four kinds a credential fills. */
export type WorkosContentKind = (typeof WORKOS_CONTENT_KINDS)[number];

/** How ONE content family's read went, and why. */
export interface WorkosFamilyGrade {
  readonly outcome: WorkosContentOutcome;
  readonly reason: string | null;
}

/** Everything the four content reads produced. */
interface WorkosContentSurface {
  readonly organizations: readonly WorkosOrganizationRecord[];
  readonly users: readonly WorkosUserRecord[];
  readonly connections: readonly WorkosConnectionRecord[];
  readonly directories: readonly WorkosDirectoryRecord[];
}

/** The content half of one acquisition: what was read, each family's grade, and the rollup. */
export interface WorkosContentAcquisition {
  readonly content: WorkosContentSurface;
  readonly families: Readonly<Record<WorkosContentKind, WorkosFamilyGrade>>;
  readonly outcome: WorkosContentOutcome;
  readonly reason: string | null;
}

/**
 * Whether this kind is filled by the credentialled half.
 *
 * A type predicate, so the four-kind partition is the compiler's rather than a cast at each call site.
 *
 * @returns `true` when the kind comes from a content read
 */
export function isWorkosContentKind(kind: WorkosAtlasKind): kind is WorkosContentKind {
  return kind !== "operation" && kind !== "page";
}

/**
 * The empty content surface, for a run whose credentialled half did not happen.
 *
 * @returns a surface holding nothing
 */
function emptyWorkosContent(): WorkosContentSurface {
  return { connections: [], directories: [], organizations: [], users: [] };
}

/**
 * The whole content half for a run that could not attempt one, graded from the credential's own failure.
 *
 * A MISSING key is an ordinary state and grades `not-configured`; a key that exists and could not be read
 * is a real failure. The distinction decides a coverage state and an exit code — see `errors.ts`.
 *
 * @param error why the key could not be resolved
 * @returns the content half, holding nothing, every family graded alike
 */
export function unattemptedWorkosContent({ error }: { error: WorkosApiError }): WorkosContentAcquisition {
  const unconfigured = isWorkosCredentialGap({ error });
  const grade: WorkosFamilyGrade = {
    outcome: unconfigured ? "not-configured" : "failed",
    reason: unconfigured ? error.message : `the WorkOS API key could not be resolved: ${error.message}`,
  };
  return {
    content: emptyWorkosContent(),
    families: { connection: grade, directory: grade, organization: grade, user: grade },
    outcome: grade.outcome,
    reason: grade.reason,
  };
}

/** What a family that filled every page this reader follows is entitled to claim. */
const PAGE_BOUND_REASON =
  "this family filled every page this reader follows, so the list published for it is a prefix rather " +
  "than the whole family — read `contentRead.ts`'s bound before citing a count";

/**
 * Read the four entity families a key can enumerate, grading each on its own.
 *
 * @param fetch the injected transport
 * @param apiKey the resolved key
 * @returns the content surface, each family's own grade, and the rollup the CLI grades its exit code from
 */
export async function acquireWorkosContent({
  fetch,
  apiKey,
}: {
  fetch: WorkosFetch;
  apiKey: string;
}): Promise<WorkosContentAcquisition> {
  const organizations = await readWorkosList({ apiKey, endpoint: WORKOS_ORGANIZATIONS_LIST, fetch });
  const users = await readWorkosList({ apiKey, endpoint: WORKOS_USERS_LIST, fetch });
  const connections = await readWorkosList({ apiKey, endpoint: WORKOS_CONNECTIONS_LIST, fetch });
  const directories = await readWorkosList({ apiKey, endpoint: WORKOS_DIRECTORIES_LIST, fetch });
  const walk = await acquireMemberships({ apiKey, fetch, organizations, users });
  const families: Readonly<Record<WorkosContentKind, WorkosFamilyGrade>> = {
    connection: gradeList({ read: connections }),
    directory: gradeList({ read: directories }),
    organization: gradeList({ read: organizations }),
    user: gradeUsers({ users: gradeList({ read: users }), walk }),
  };
  return {
    content: {
      connections: reduceWorkosConnections({ records: recordsOf({ read: connections }) }),
      directories: reduceWorkosDirectories({ records: recordsOf({ read: directories }) }),
      organizations: reduceWorkosOrganizations({ records: recordsOf({ read: organizations }) }),
      users: reduceWorkosUsers({ membershipsByUser: walk.membershipsByUser, records: recordsOf({ read: users }) }),
    },
    families,
    ...rollUp({ families }),
  };
}

/**
 * One family grade in English, never an empty string.
 *
 * @param grade the family's grade
 * @returns the reason it carries, or a stand-in naming the outcome when it carries none
 */
export function describeWorkosGrade({ grade }: { grade: WorkosFamilyGrade }): string {
  if (grade.reason === null) {
    return grade.outcome;
  }
  return grade.reason;
}

/**
 * Grade one list read on its own.
 *
 * @param read what the paged reader returned
 * @returns the family's outcome and the reason it is not `synced`
 */
function gradeList<T>({ read }: { read: Result<WorkosPagedRead<T>, WorkosApiError> }): WorkosFamilyGrade {
  if (read.isErr()) {
    return { outcome: "failed", reason: read.error.message };
  }
  if (read.value.truncated) {
    return { outcome: "truncated", reason: PAGE_BOUND_REASON };
  }
  return { outcome: "synced", reason: null };
}

/**
 * The records one list read produced, or none when it failed.
 *
 * A refused page grades its family `failed` and carries no records, so `merge.ts` leaves what the store already
 * holds for it exactly as it stands rather than publishing a partial list as though whole.
 *
 * @param read what the paged reader returned
 * @returns the typed records to reduce
 */
function recordsOf<T>({ read }: { read: Result<WorkosPagedRead<T>, WorkosApiError> }): readonly T[] {
  if (read.isErr()) {
    return [];
  }
  return read.value.records;
}

/**
 * Walk the membership listing, choosing which filter to walk it by.
 *
 * Per ORGANISATION is the primary walk: organisations are the smaller set in every tenant shape this
 * installation has, and the reducer keys by `user_id` either way. Per user is the fallback for one case
 * only — the organisations read having FAILED. An organisations read that succeeded and returned nothing
 * is not that case: the right membership answer there is zero, and walking per user instead would spend a
 * hundred requests proving it.
 *
 * @param fetch the injected transport
 * @param apiKey the resolved key
 * @param organizations what the organisations read returned
 * @param users what the users read returned
 * @returns the walk, empty and unfailed when neither list read survived to drive one
 */
async function acquireMemberships({
  fetch,
  apiKey,
  organizations,
  users,
}: {
  fetch: WorkosFetch;
  apiKey: string;
  organizations: Result<WorkosPagedRead<WorkosOrganizationWire>, WorkosApiError>;
  users: Result<WorkosPagedRead<WorkosUserWire>, WorkosApiError>;
}): Promise<WorkosMembershipWalk> {
  if (organizations.isOk()) {
    return walkWorkosMemberships({
      apiKey,
      fetch,
      filter: "organization_id",
      ids: organizations.value.records.map((record) => record.id),
    });
  }
  if (users.isOk()) {
    return walkWorkosMemberships({
      apiKey,
      fetch,
      filter: "user_id",
      ids: users.value.records.map((record) => record.id),
    });
  }
  return { failedBecause: null, membershipsByUser: new Map(), truncated: false };
}

/**
 * Grade the user family, which is the one whose CONTENT depends on a second read.
 *
 * @param users the users listing's own grade
 * @param walk what the membership walk produced
 * @returns the user family's grade
 */
function gradeUsers({ users, walk }: { users: WorkosFamilyGrade; walk: WorkosMembershipWalk }): WorkosFamilyGrade {
  if (users.outcome !== "synced") {
    return users;
  }
  if (walk.failedBecause !== null) {
    return {
      outcome: "truncated",
      reason:
        "every user was read, and the organisation-membership walk stopped on a refusal, so each " +
        `published user's organisation list is a prefix rather than the whole of it: ${walk.failedBecause}`,
    };
  }
  if (walk.truncated) {
    return {
      outcome: "truncated",
      reason:
        "every user was read, and the organisation-membership walk stopped at its bound of " +
        `${String(WORKOS_MAX_MEMBERSHIP_WALKS)} filtered listing(s), so each published user's organisation ` +
        "list is a prefix rather than the whole of it",
    };
  }
  return users;
}

/**
 * Roll four family grades into the one outcome the CLI turns into an exit code.
 *
 * Worst-first, because the rollup's job is to stop a run that broke something from exiting 0. The reason
 * names the families at that level, so a reader learns WHICH endpoint refused without opening the atlas.
 *
 * @param families each family's own grade
 * @returns the rolled-up outcome and reason
 */
function rollUp({ families }: { families: Readonly<Record<WorkosContentKind, WorkosFamilyGrade>> }): {
  outcome: WorkosContentOutcome;
  reason: string | null;
} {
  const entries = WORKOS_CONTENT_KINDS.map((kind) => ({ grade: families[kind], kind }));
  for (const outcome of ["failed", "truncated", "not-configured"] as const) {
    const hit = entries.filter((entry) => entry.grade.outcome === outcome);
    if (hit.length > 0) {
      return {
        outcome,
        reason: hit.map((entry) => `${entry.kind}: ${describeWorkosGrade({ grade: entry.grade })}`).join("; "),
      };
    }
  }
  return { outcome: "synced", reason: null };
}

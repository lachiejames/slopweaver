/**
 * Discovery: which containers under the organisation a pull searches. Resource Manager's folder and project
 * searches are paged to the end, then only the ACTIVE containers whose ancestry reaches the organisation are
 * kept. A refused search is recorded and discovery carries on with what it has — the manifest names the gap.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { err, type Result } from "#lib/result.js";

import { call, pageToEnd, pageTokenField, refusal } from "./call.js";
import { type GcpAuditError, GcpAuditErrors } from "./errors.js";
import type { GcpAuditManifest, GcpRefusalFact } from "./store.js";
import { type GcpAuditSend, type GcpContainer, isGcpContainer } from "./transport.js";
import { SEARCH_FOLDERS, SEARCH_PROJECTS } from "./wire.js";

/** A container with its parent, as a Resource Manager search answered it. */
interface Discovered<Name extends string = string> {
  readonly name: Name;
  readonly parent: string | null;
  readonly state: string | null;
  readonly projectId: string | null;
}

/** A discovered folder, whose name the search page checked is `folders/` and a numeric id. */
type DiscoveredFolder = Discovered<`folders/${string}`>;

/** One page of a search, as {@link pageToEnd} reads it. */
type SearchPage<T> = Result<{ items: readonly T[]; next: string | undefined }, GcpAuditError>;

/** What discovery found, and what it was refused. */
export interface GcpDiscovery {
  /** The containers to read, organisation first, then folders, then projects. */
  readonly containers: readonly GcpContainer[];
  readonly counts: GcpAuditManifest["containers"];
  readonly refusals: readonly GcpRefusalFact[];
  readonly foldersRefused: boolean;
  readonly projectsRefused: boolean;
}

/**
 * One page of the project search.
 *
 * @param pageToken the token the previous page returned
 * @returns the page's projects and the next token, or the failure
 */
async function searchProjectsPage({
  send,
  pageToken,
}: {
  send: GcpAuditSend;
  pageToken: string | undefined;
}): Promise<SearchPage<Discovered>> {
  const page = await call({
    boundary: SEARCH_PROJECTS,
    request: { kind: "search-projects", ...pageTokenField({ pageToken }) },
    send,
  });
  return page.map((value) => {
    // A page with no match omits `projects`: none here, not an unknown.
    if (value.projects === undefined) {
      return { items: [], next: value.nextPageToken };
    }
    return {
      items: value.projects.map((project): Discovered => ({
        name: project.name,
        parent: unsetFieldAsNull({ key: "parent", record: project }),
        projectId: project.projectId,
        state: unsetFieldAsNull({ key: "state", record: project }),
      })),
      next: value.nextPageToken,
    };
  });
}

/**
 * One page of the folder search.
 *
 * @param pageToken the token the previous page returned
 * @returns the page's folders and the next token, or the failure
 */
async function searchFoldersPage({
  send,
  pageToken,
}: {
  send: GcpAuditSend;
  pageToken: string | undefined;
}): Promise<SearchPage<DiscoveredFolder>> {
  const page = await call({
    boundary: SEARCH_FOLDERS,
    request: { kind: "search-folders", ...pageTokenField({ pageToken }) },
    send,
  });
  const malformed = page.isOk() ? page.value.folders?.find((folder) => !isGcpContainer(folder.name)) : undefined;
  if (malformed !== undefined) {
    return err(
      GcpAuditErrors.responseChanged({
        detail: `folders:search answered ${malformed.name}, which is not folders/ and a numeric id`,
        endpoint: "GET cloudresourcemanager v3 folders:search",
      }),
    );
  }
  return page.map((value) => {
    // A page with no match omits `folders`: none here, not an unknown.
    if (value.folders === undefined) {
      return { items: [], next: value.nextPageToken };
    }
    return {
      items: value.folders.map((folder): DiscoveredFolder => ({
        name: folder.name,
        parent: unsetFieldAsNull({ key: "parent", record: folder }),
        projectId: null,
        state: unsetFieldAsNull({ key: "state", record: folder }),
      })),
      next: value.nextPageToken,
    };
  });
}

/**
 * Keep the ACTIVE containers whose ancestry reaches the organisation. A search answers everything the caller
 * may see, which can include another organisation's project shared with the owner; walking parents proves descent.
 *
 * @param org the organisation number
 * @param folders every folder found
 * @param projects every project found
 * @returns the containers to read, organisation first, then folders, then projects
 */
export function containersUnder({
  org,
  folders,
  projects,
}: {
  org: string;
  folders: readonly DiscoveredFolder[];
  projects: readonly Discovered[];
}): readonly GcpContainer[] {
  const root: GcpContainer = `organizations/${org}`;
  const parentOf = new Map<string, string | null>(folders.map((folder) => [folder.name, folder.parent]));
  const reaches = ({ parent }: { parent: string | null }): boolean => {
    let at = parent;
    for (let depth = 0; at !== null && depth < 20; depth += 1) {
      if (at === root) {
        return true;
      }
      const next = parentOf.get(at);
      at = next === undefined ? null : next;
    }
    return false;
  };
  const active = (item: Discovered): boolean => item.state === "ACTIVE" && reaches({ parent: item.parent });
  return [
    root,
    ...folders
      .filter(active)
      .map((folder) => folder.name)
      .toSorted(),
    ...projects
      .filter(active)
      .map((project): GcpContainer => `projects/${project.projectId!}`)
      .toSorted(),
  ];
}

/**
 * Search the folders, then the projects, and keep what descends from the organisation.
 *
 * @param send the sender
 * @param org the organisation number
 * @returns the containers, their counts, and each refused search
 */
export async function discoverContainers({ send, org }: { send: GcpAuditSend; org: string }): Promise<GcpDiscovery> {
  const refusals: GcpRefusalFact[] = [];
  const folders = await pageToEnd({ fetchPage: ({ pageToken }) => searchFoldersPage({ pageToken, send }) });
  if (folders.isErr()) {
    refusals.push(refusal({ error: folders.error, what: "folders:search" }));
  }
  const projects = await pageToEnd({ fetchPage: ({ pageToken }) => searchProjectsPage({ pageToken, send }) });
  if (projects.isErr()) {
    refusals.push(refusal({ error: projects.error, what: "projects:search" }));
  }
  const containers = containersUnder({
    folders: folders.isOk() ? folders.value : [],
    org,
    projects: projects.isOk() ? projects.value : [],
  });
  return {
    containers,
    counts: {
      folders: containers.filter((name) => name.startsWith("folders/")).length,
      organizations: 1,
      projects: containers.filter((name) => name.startsWith("projects/")).length,
    },
    foldersRefused: folders.isErr(),
    projectsRefused: projects.isErr(),
    refusals,
  };
}

import { describe, expect, it } from "vitest";

import { containersUnder } from "../../../gcpAudit/discover.js";
import { type GcpAuditError, GcpAuditErrors } from "../../../gcpAudit/errors.js";
import { type GcpAuditPullDeps, runGcpAuditPull } from "../../../gcpAudit/pull.js";
import type { GcpAuditManifest, GcpCachedRole } from "../../../gcpAudit/store.js";
import type { EntriesListBody, GcpContainer } from "../../../gcpAudit/transport.js";
import type { TrimmedGcpAuditEntry } from "../../../gcpAudit/trim.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";

const active = ({ name, parent, projectId }: { name: string; parent: string; projectId?: string }) => ({
  name,
  parent,
  ...(projectId === undefined ? {} : { projectId }),
  state: "ACTIVE",
});

const forbidden = () =>
  err(GcpAuditErrors.transportFailed({ detail: "Permission denied", operation: "op", status: 403 }));

/** One raw audit entry originating in `project`. */
const raw = ({ project, insertId }: { project: string; insertId: string }) => ({
  insertId,
  logName: `projects/${project}/logs/cloudaudit.googleapis.com%2Factivity`,
  protoPayload: { authenticationInfo: { principalEmail: "a@x.com" }, methodName: "M", serviceName: "s" },
  timestamp: "2026-01-01T00:00:00Z",
});

/** The fake's folder search: two folders, the second nested under the first. */
const FOLDERS = {
  folders: [
    active({ name: "folders/10", parent: "organizations/1" }),
    active({ name: "folders/11", parent: "folders/10" }),
  ],
};

/** The fake's project search: one under the folders, one private, one in another org, one being deleted. */
const PROJECTS = {
  projects: [
    active({ name: "projects/1001", parent: "folders/11", projectId: "p-alpha" }),
    active({ name: "projects/1002", parent: "organizations/1", projectId: "private-one" }),
    active({ name: "projects/1003", parent: "organizations/999", projectId: "someone-else" }),
    { name: "projects/1004", parent: "organizations/1", projectId: "p-deleting", state: "DELETE_REQUESTED" },
  ],
};

/** Every container's buckets, the second on a second page. */
function bucketsPage({
  parent,
  pageToken,
}: {
  parent: GcpContainer;
  pageToken: string | undefined;
}): Result<unknown, GcpAuditError> {
  if (pageToken === undefined) {
    return ok({
      buckets: [{ name: `${parent}/locations/global/buckets/_Required`, retentionDays: 400 }],
      nextPageToken: "b2",
    });
  }
  return ok({ buckets: [{ name: `${parent}/locations/global/buckets/_Default`, retentionDays: 30 }] });
}

/** The organisation's one sink, on a second page; every other container has none. */
function sinksPage({
  parent,
  pageToken,
}: {
  parent: GcpContainer;
  pageToken: string | undefined;
}): Result<unknown, GcpAuditError> {
  if (parent !== "organizations/1") {
    return ok({});
  }
  if (pageToken === undefined) {
    return ok({ nextPageToken: "s2", sinks: [] });
  }
  return ok({ sinks: [{ destination: "pubsub.googleapis.com/projects/p-alpha/topics/t", name: "to-pubsub" }] });
}

/** `p-alpha`'s two entries over two pages; any batch naming `private-one` is refused. */
function entriesPage({ body }: { body: EntriesListBody }): Result<unknown, GcpAuditError> {
  if (body.resourceNames.includes("projects/private-one")) {
    return forbidden();
  }
  if (!body.resourceNames.includes("projects/p-alpha")) {
    return ok({});
  }
  if (body.pageToken === undefined) {
    return ok({ entries: [raw({ insertId: "1", project: "p-alpha" })], nextPageToken: "n1" });
  }
  return ok({ entries: [raw({ insertId: "2", project: "p-alpha" })] });
}

/**
 * A fake Google: one org with two folders, one project under them, one in another org, one being deleted, and one
 * private project whose logs 403. `p-alpha`'s entries, every container's buckets, and the organisation's one
 * sink each arrive on a second page.
 */
function fakeGoogle(): { send: GcpAuditPullDeps["send"]; entryCalls: string[][] } {
  const entryCalls: string[][] = [];
  const send: GcpAuditPullDeps["send"] = async ({ request }) => {
    switch (request.kind) {
      case "search-folders":
        return ok(FOLDERS);
      case "search-projects":
        return ok(PROJECTS);
      case "list-buckets":
        return bucketsPage({ pageToken: request.pageToken, parent: request.parent });
      case "list-sinks":
        return sinksPage({ pageToken: request.pageToken, parent: request.parent });
      case "get-iam-policy":
        return forbidden();
      case "get-role":
        return ok({ includedPermissions: ["b.two", "a.one"], name: request.role, title: "Viewer" });
      case "list-entries":
        entryCalls.push([...request.body.resourceNames]);
        return entriesPage({ body: request.body });
      default: {
        const unreachable: never = request;
        return unreachable;
      }
    }
  };
  return { entryCalls, send };
}

describe("containersUnder", () => {
  it("keeps only active containers whose ancestry reaches the organisation", () => {
    expect(
      containersUnder({
        folders: [
          { name: "folders/10", parent: "organizations/1", projectId: null, state: "ACTIVE" },
          { name: "folders/20", parent: "organizations/2", projectId: null, state: "ACTIVE" },
        ],
        org: "1",
        projects: [
          { name: "projects/1", parent: "folders/10", projectId: "p-under", state: "ACTIVE" },
          { name: "projects/2", parent: "folders/20", projectId: "p-other", state: "ACTIVE" },
          { name: "projects/3", parent: null, projectId: "p-orphan", state: "ACTIVE" },
        ],
      }),
    ).toEqual(["organizations/1", "folders/10", "projects/p-under"]);
  });
});

describe("runGcpAuditPull", () => {
  it("pages every entry, isolates the one private project by bisection, and publishes an honest manifest", async () => {
    const google = fakeGoogle();
    const written: TrimmedGcpAuditEntry[] = [];
    const published: { manifest: GcpAuditManifest; roles: readonly GcpCachedRole[] }[] = [];
    const manifest = unwrap(
      await runGcpAuditPull({
        deps: {
          generation: "20260101T000000Z-00000000",
          nowIso: () => "2026-01-01T00:00:00.000Z",
          open: () => ok({ append: ({ entry }) => written.push(entry), close: () => undefined, path: "/fake" }),
          progress: () => undefined,
          publish: (args) => {
            published.push(args);
            return ok("/fake/manifest.json");
          },
          send: google.send,
        },
        input: {
          org: "1",
          principals: ["a@x.com"],
          quotaProject: "acme-local",
          roles: ["roles/viewer"],
          since: "2025-01-01T00:00:00Z",
        },
      }),
    );
    expect(written.map((entry) => entry.eventId)).toEqual([
      "projects/p-alpha/logs/cloudaudit.googleapis.com%2Factivity|2026-01-01T00:00:00Z|1",
      "projects/p-alpha/logs/cloudaudit.googleapis.com%2Factivity|2026-01-01T00:00:00Z|2",
    ]);
    expect(google.entryCalls).toEqual([
      ["organizations/1", "folders/10", "folders/11", "projects/p-alpha", "projects/private-one"],
      ["organizations/1", "folders/10", "folders/11"],
      ["projects/p-alpha", "projects/private-one"],
      ["projects/p-alpha"],
      ["projects/p-alpha"],
      ["projects/private-one"],
    ]);
    expect(manifest.containers).toEqual({ folders: 2, organizations: 1, projects: 2 });
    expect(manifest.refusals.entries.map((fact) => [fact.what, fact.status])).toEqual([["projects/private-one", 403]]);
    expect(manifest.gaps).toEqual([
      "1 container(s) refused their logs",
      "the organisation's audit-log configuration was refused",
      "1 enabled sink(s) route copies outside Logging, unread here: pubsub.googleapis.com/projects/p-alpha/topics/t",
    ]);
    expect(manifest.coverage).toBe("partial");
    expect(
      manifest.buckets.filter((bucket) => bucket.container === "organizations/1").map((b) => b.retentionDays),
    ).toEqual([30, 400]);
    expect(manifest.entriesWritten).toBe(2);
    expect(published[0]!.roles).toEqual([{ name: "roles/viewer", permissions: ["a.one", "b.two"] }]);
  });

  it("publishes a refused project search as a partial generation, never an aborted or complete one", async () => {
    const google = fakeGoogle();
    const manifest = unwrap(
      await runGcpAuditPull({
        deps: {
          generation: "20260101T000000Z-00000001",
          nowIso: () => "2026-01-01T00:00:00.000Z",
          open: () => ok({ append: () => undefined, close: () => undefined, path: "/fake" }),
          progress: () => undefined,
          publish: () => ok("/fake/manifest.json"),
          send: async (args) => (args.request.kind === "search-projects" ? forbidden() : google.send(args)),
        },
        input: {
          org: "1",
          principals: ["a@x.com"],
          quotaProject: "acme-local",
          roles: [],
          since: "2025-01-01T00:00:00Z",
        },
      }),
    );
    expect(manifest.refusals.discovery.map((fact) => [fact.what, fact.status])).toEqual([["projects:search", 403]]);
    expect(manifest.gaps).toContain("project discovery was refused, so project-level logs are unread");
    expect(manifest.containers).toEqual({ folders: 2, organizations: 1, projects: 0 });
    expect(manifest.coverage).toBe("partial");
  });

  it("records a folder name with no numeric id as a refused folder search, never a container to read", async () => {
    const google = fakeGoogle();
    const malformed = { folders: [active({ name: "folders/not-a-number", parent: "organizations/1" })] };
    const manifest = unwrap(
      await runGcpAuditPull({
        deps: {
          generation: "20260101T000000Z-00000002",
          nowIso: () => "2026-01-01T00:00:00.000Z",
          open: () => ok({ append: () => undefined, close: () => undefined, path: "/fake" }),
          progress: () => undefined,
          publish: () => ok("/fake/manifest.json"),
          send: async (args) => (args.request.kind === "search-folders" ? ok(malformed) : google.send(args)),
        },
        input: {
          org: "1",
          principals: ["a@x.com"],
          quotaProject: "acme-local",
          roles: [],
          since: "2025-01-01T00:00:00Z",
        },
      }),
    );
    expect(manifest.refusals.discovery.map((fact) => fact.what)).toEqual(["folders:search"]);
    expect(manifest.containers.folders).toBe(0);
    expect(manifest.coverage).toBe("partial");
  });

  it("refuses a bad --since before it sends anything", async () => {
    const google = fakeGoogle();
    const refused = await runGcpAuditPull({
      deps: {
        generation: "g",
        nowIso: () => "2026-01-01T00:00:00.000Z",
        open: () => err(GcpAuditErrors.storeFailed({ detail: "unused", path: "/fake" })),
        progress: () => undefined,
        publish: () => ok("/fake"),
        send: google.send,
      },
      input: { org: "1", principals: "all", quotaProject: "q-project", roles: [], since: "yesterday" },
    });
    expect(unwrapErr(refused).code).toBe("INPUT_INVALID");
    expect(google.entryCalls).toEqual([]);
  });
});

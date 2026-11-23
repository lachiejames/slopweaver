import { describe, expect, it } from "vitest";

import { buildGcpAuditRequest, type GcpAuditRequest } from "../../../gcpAudit/transport.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const BODY = {
  filter: 'log_id("cloudaudit.googleapis.com/activity")',
  orderBy: "timestamp asc",
  pageSize: 1000,
  resourceNames: ["organizations/112233445566", "projects/acme-local"],
} as const;

/** One of every member of the closed union — a new member must be added here, and to the POST pin below. */
const EVERY_KIND: readonly GcpAuditRequest[] = [
  { kind: "search-projects" },
  { kind: "search-folders", pageToken: "abc" },
  { body: BODY, kind: "list-entries" },
  { kind: "list-buckets", parent: "folders/123" },
  { kind: "list-sinks", parent: "projects/acme-local" },
  { kind: "get-role", role: "projects/acme-staging/roles/EngLead" },
  { kind: "get-iam-policy", resource: "organizations/112233445566" },
];

describe("buildGcpAuditRequest", () => {
  it("pins the only two POSTs to Google's POST reads, entries:list and getIamPolicy", () => {
    expect(EVERY_KIND.length).toBe(7);
    const posts = EVERY_KIND.map((request) => unwrap(buildGcpAuditRequest({ request }))).filter(
      (built) => built.method === "POST",
    );
    expect(posts.map((built) => built.operation)).toEqual([
      "gcp.logging.entries.list",
      "gcp.resourcemanager.getIamPolicy",
    ]);
  });

  it("sends entries:list with no partial-response mask, which Google refuses on an Any payload", () => {
    const built = unwrap(buildGcpAuditRequest({ request: { body: BODY, kind: "list-entries" } }));
    expect(built.url).toBe("https://logging.googleapis.com/v2/entries:list");
    expect(built.body).toEqual(BODY);
  });

  it("reads an organisation's policy over v3 and a project's over v1", () => {
    const org = unwrap(buildGcpAuditRequest({ request: { kind: "get-iam-policy", resource: "organizations/1" } }));
    const project = unwrap(
      buildGcpAuditRequest({ request: { kind: "get-iam-policy", resource: "projects/acme-local" } }),
    );
    expect(org.url).toBe("https://cloudresourcemanager.googleapis.com/v3/organizations/1:getIamPolicy");
    expect(project.url).toBe("https://cloudresourcemanager.googleapis.com/v1/projects/acme-local:getIamPolicy");
    expect(org.body).toEqual({ options: { requestedPolicyVersion: 3 } });
  });

  it("lists buckets across every location of a container", () => {
    const built = unwrap(
      buildGcpAuditRequest({ request: { kind: "list-buckets", parent: "folders/123", pageToken: "t1" } }),
    );
    expect(built.url).toBe("https://logging.googleapis.com/v2/folders/123/locations/-/buckets?pageToken=t1");
    expect(built.method).toBe("GET");
  });

  it("refuses a container name that could walk the path", () => {
    const refused = unwrapErr(
      buildGcpAuditRequest({
        request: { kind: "list-sinks", parent: "projects/../organizations/1" as `projects/${string}` },
      }),
    );
    expect(refused.code).toBe("REQUEST_REFUSED");
    expect(refused.message).toContain("not an organisation, folder or project name");
  });

  it("refuses an entries:list naming a non-container", () => {
    const refused = unwrapErr(
      buildGcpAuditRequest({
        request: {
          body: { ...BODY, resourceNames: ["billingAccounts/0" as `projects/${string}`] },
          kind: "list-entries",
        },
      }),
    );
    expect(refused.code).toBe("REQUEST_REFUSED");
  });

  it("refuses a page token carrying a second parameter", () => {
    const refused = unwrapErr(buildGcpAuditRequest({ request: { kind: "search-projects", pageToken: "a&fields=x" } }));
    expect(refused.message).toContain("the page token is not an opaque token");
  });

  it("refuses a role name that is not a predefined or custom role", () => {
    const refused = unwrapErr(buildGcpAuditRequest({ request: { kind: "get-role", role: "roles/../v1/projects" } }));
    expect(refused.message).toContain("not a predefined or custom role name");
  });

  it("refuses a dot segment that URL normalisation would fold into the roles collection", () => {
    expect(
      ["roles/.", "roles/..", "organizations/1/roles/."].map(
        (role) => unwrapErr(buildGcpAuditRequest({ request: { kind: "get-role", role } })).code,
      ),
    ).toEqual(["REQUEST_REFUSED", "REQUEST_REFUSED", "REQUEST_REFUSED"]);
  });

  it("reads a predefined role whose id carries dots", () => {
    expect(
      unwrap(buildGcpAuditRequest({ request: { kind: "get-role", role: "roles/iam.serviceAccountUser" } })).url,
    ).toBe("https://iam.googleapis.com/v1/roles/iam.serviceAccountUser");
  });
});

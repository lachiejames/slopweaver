import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type GoogleAuditLogDeps,
  runGoogleAuditLogWithDeps,
  summaryLines,
} from "../../../../../cli/commands/google/auditLog.js";
import {
  GOOGLE_AUDIT_LOG_USAGE,
  GOOGLE_AUDIT_LOG_USAGE_LINE,
} from "../../../../../cli/commands/google/auditLogUsage.js";
import { googleManifest } from "../../../../../cli/manifests/google.js";
import { startCount } from "../../../../../gcpAudit/aggregate.js";
import type { GcpAuditError } from "../../../../../gcpAudit/errors.js";
import type { GcpAuditManifest } from "../../../../../gcpAudit/store.js";
import type { GcpAuditRequest } from "../../../../../gcpAudit/transport.js";
import { err, ok, type Result } from "../../../../../lib/result.js";

const NOW = "2026-01-01T00:00:00.000Z";
const GENERATION = "20260101T000000Z-0a0b0c0d";

/** One project under the organisation, nothing else; its one entry exercised one permission. */
function google({ request }: { request: GcpAuditRequest }): Result<unknown, GcpAuditError> {
  switch (request.kind) {
    case "search-projects":
      return ok({
        projects: [{ name: "projects/1001", parent: "organizations/1", projectId: "p-alpha", state: "ACTIVE" }],
      });
    case "get-role":
      return ok({ includedPermissions: ["logging.logEntries.list"], name: request.role });
    case "list-entries":
      return ok({
        entries: [
          {
            insertId: "1",
            logName: "projects/p-alpha/logs/cloudaudit.googleapis.com%2Fdata_access",
            protoPayload: {
              authenticationInfo: { principalEmail: "a@x.com" },
              authorizationInfo: [{ granted: true, permission: "logging.logEntries.list" }],
              methodName: "ListLogEntries",
              serviceName: "logging.googleapis.com",
            },
            timestamp: "2025-06-01T00:00:00Z",
          },
        ],
      });
    case "search-folders":
    case "list-buckets":
    case "list-sinks":
    case "get-iam-policy":
      return ok({});
    default: {
      const unreachable: never = request;
      return unreachable;
    }
  }
}

/** A plan keeping nothing for `a@x.com` at the organisation, read through direct bindings only. */
const PLAN = JSON.stringify({
  principals: [
    {
      principal: "a@x.com",
      scopes: [
        {
          basis: "direct-bindings",
          deniedPermissions: [],
          keptRoles: [],
          remainingPermissions: [],
          resource: "organizations/1",
        },
      ],
    },
  ],
  schemaVersion: 1,
});

/** The verb's effects over the fake Google, its lines captured. */
function world({ plan }: { plan: Result<string> }): { deps: GoogleAuditLogDeps; out: string[]; errors: string[] } {
  const out: string[] = [];
  const errors: string[] = [];
  return {
    deps: {
      error: (line) => {
        errors.push(line);
      },
      nowIso: () => NOW,
      out: (line) => {
        out.push(line);
      },
      readText: () => plan,
      sender:
        () =>
        ({ request }) =>
          Promise.resolve(google({ request })),
      suffix: () => "0a0b0c0d",
    },
    errors,
    out,
  };
}

const PULL = [
  "pull",
  "--org",
  "1",
  "--quota-project",
  "acme-local",
  "--since",
  "2025-01-01T00:00:00Z",
  "--principal",
  "a@x.com",
  "--role",
  "roles/viewer",
];

describe("google audit-log", () => {
  let home = "";
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "audit-log-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("is published under the google noun with the usage line its help prints first", () => {
    expect(googleManifest["audit-log"]!.meta.usage).toBe(GOOGLE_AUDIT_LOG_USAGE_LINE);
    expect(GOOGLE_AUDIT_LOG_USAGE.split("\n")[0]).toBe(GOOGLE_AUDIT_LOG_USAGE_LINE);
  });

  it("prints the whole usage on --help and exits 0", async () => {
    const { deps, out } = world({ plan: ok(PLAN) });
    expect(await runGoogleAuditLogWithDeps({ deps, rest: ["--help"] })).toBe(0);
    expect(out).toEqual([GOOGLE_AUDIT_LOG_USAGE]);
  });

  it("refuses an unknown action as usage, naming it before the usage", async () => {
    const { deps, errors } = world({ plan: ok(PLAN) });
    expect(await runGoogleAuditLogWithDeps({ deps, rest: ["push"] })).toBe(2);
    expect(errors).toEqual(["name an action: pull or summary, not push", GOOGLE_AUDIT_LOG_USAGE]);
  });

  it("pulls into a generation under --home, then summarises it against a plan", async () => {
    const pulled = world({ plan: ok(PLAN) });
    expect(await runGoogleAuditLogWithDeps({ deps: pulled.deps, rest: [...PULL, "--home", home] })).toBe(0);
    expect(pulled.out.at(-2)).toBe(`published generation ${GENERATION}: 1 entr(ies), coverage complete`);
    expect(pulled.out.at(-1)).toBe(`read it: slopweaver google audit-log summary --generation ${GENERATION}`);

    const read = world({ plan: ok(PLAN) });
    const rest = ["summary", "--plan", "/plan.json", "--home", home];
    expect(await runGoogleAuditLogWithDeps({ deps: read.deps, rest })).toBe(0);
    expect(read.errors).toEqual([]);
    expect(read.out).toContain("  data_access: 1 entr(ies), 2025-06-01T00:00:00Z → 2025-06-01T00:00:00Z");
    expect(read.out).toContain("plan: 0 exercised permission use(s) kept, 1 would break, 0 unassessable");
    expect(read.out).toContain(
      "  WOULD BREAK a@x.com logging.logEntries.list in projects/p-alpha — 1 use(s), last 2025-06-01T00:00:00Z (absent-from-remaining-set, unless-another-grant-covers-it; ListLogEntries)",
    );
  });

  it("refuses an unreadable plan as usage, naming the path", async () => {
    const pulled = world({ plan: ok(PLAN) });
    await runGoogleAuditLogWithDeps({ deps: pulled.deps, rest: [...PULL, "--home", home] });
    const read = world({ plan: err(["ENOENT"]) });
    const rest = ["summary", "--plan", "/missing.json", "--home", home];
    expect(await runGoogleAuditLogWithDeps({ deps: read.deps, rest })).toBe(2);
    expect(read.errors).toEqual(["google audit-log: cannot read --plan /missing.json: ENOENT"]);
  });

  it("fails a summary of a home nothing was pulled into", async () => {
    const read = world({ plan: ok(PLAN) });
    expect(await runGoogleAuditLogWithDeps({ deps: read.deps, rest: ["summary", "--home", home] })).toBe(1);
    expect(read.errors[0]).toContain("no completed audit-log generation to read");
  });
});

describe("summaryLines", () => {
  const manifest: GcpAuditManifest = {
    auditConfigs: [],
    batches: [],
    buckets: [
      {
        analyticsEnabled: null,
        container: "organizations/1",
        lifecycleState: null,
        locked: null,
        name: "organizations/1/locations/global/buckets/_Default",
        retentionDays: 30,
      },
    ],
    containers: { folders: 0, organizations: 1, projects: 1 },
    coverage: "partial",
    entriesWritten: 0,
    gaps: ["the organisation's audit-log configuration was refused"],
    generation: GENERATION,
    org: "1",
    principals: "all",
    pulledAtIso: NOW,
    quotaProject: "acme-local",
    refusals: {
      buckets: [],
      discovery: [],
      entries: [],
      policies: [{ message: "no", status: 403, what: "organizations/1" }],
      roles: [],
      sinks: [],
    },
    roles: [],
    schemaVersion: 1,
    since: "2025-01-01T00:00:00Z",
    sinks: [],
  };

  it("says UNKNOWN rather than nothing when the org's policy was refused, and names the gap", () => {
    expect(summaryLines({ assessment: null, manifest, summary: startCount().result() })).toEqual([
      `0 distinct audit entr(ies) by every principal, 2025-01-01T00:00:00Z → ${NOW} (pulled ${NOW}, generation ${GENERATION}); coverage partial: the organisation's audit-log configuration was refused`,
      "searched 1 org, 0 folder(s), 1 project(s)",
      "retention observed: _Default 30d ×1",
      "data-access DATA_READ logging configured at the org for: UNKNOWN — the org's allow policy was refused",
      "calls (principal · service · method — count, failed, first → last, from):",
    ]);
  });
});

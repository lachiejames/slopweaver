/**
 * The API sync over a fake seam: what a refusal costs, and what makes a run report success.
 *
 * The expected-refusal path is the one worth pinning. On GitHub a 403 or 404 is the ordinary answer for a
 * plan without a feature or a repository without one, so a sync that graded every one of them as a failure
 * would print a mostly-red coverage table for an entirely healthy installation — and a reader who learns to
 * ignore red has lost the instrument.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResultAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";
import { absentAsEmpty } from "#lib/absent.js";
import type { GithubAtlasApi, GithubReadOutcome } from "../../../../atlas/github/client.js";
import { type GithubAtlasError, GithubAtlasErrors } from "../../../../atlas/github/errors.js";
import { githubCallsAt } from "../../../../atlas/github/inventory.js";
import { githubCallRoute } from "../../../../atlas/github/inventoryShape.js";
import { githubAtlasPaths, readGithubAtlas } from "../../../../atlas/github/store.js";
import { syncGithubAtlas } from "../../../../atlas/github/sync.js";
import { err, ok } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway state home; every test passes it explicitly rather than touching the ambient one. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-github-sync-"));
  homes.push(home);
  return home;
}

/** A seam answering from a route table, and refusing anything the table does not name. */
function fakeApi({
  answers,
  failures = new Map(),
}: {
  answers: ReadonlyMap<string, readonly unknown[]>;
  failures?: ReadonlyMap<string, GithubAtlasError>;
}): GithubAtlasApi {
  return {
    read: ({ route }) => {
      const failure = failures.get(route);
      if (failure !== undefined) {
        return ResultAsync.fromSafePromise(Promise.resolve(err(failure))).andThen((value) => value);
      }
      const records = absentAsEmpty({ value: answers.get(route) });
      const outcome: GithubReadOutcome = { pagesExhausted: true, records, reportedTotal: null };
      return ResultAsync.fromSafePromise(Promise.resolve(ok(outcome))).andThen((value) => value);
    },
  };
}

/** Every route this sync will call for one organisation, so a test can answer all of them. */
function organisationRoutes({ org }: { org: string }): readonly string[] {
  return githubCallsAt({ level: "organization" }).flatMap((call): readonly string[] => {
    const route = githubCallRoute({ call, scopeRef: org });
    return route === null ? [] : [route];
  });
}

describe("syncGithubAtlas", () => {
  it("publishes the compiled operations even when no scope is given", async () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const synced = await syncGithubAtlas({
      api: fakeApi({ answers: new Map() }),
      at: AT,
      paths,
      restOperations: [],
      scopes: { organisations: [], repositories: [] },
    });
    expect(synced.isOk()).toBe(true);
    expect(synced._unsafeUnwrap().counts["rest-operation"]).toBe(0);
  });

  it("projects one organisation's settings into the generation", async () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const answers = new Map<string, readonly unknown[]>([
      ["/orgs/example-org", [{ default_repository_permission: "read", login: "example-org" }]],
    ]);
    const synced = await syncGithubAtlas({
      api: fakeApi({ answers }),
      at: AT,
      paths,
      restOperations: [],
      scopes: { organisations: ["example-org"], repositories: [] },
    });
    expect(synced._unsafeUnwrap().counts["organization-settings"]).toBe(1);
    const read = readGithubAtlas({ paths })._unsafeUnwrap();
    expect(read.files["organization-settings"]?.entities).toHaveLength(1);
  });

  it("folds a repository's two Actions documents into ONE policy, and stores its label set", async () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const answers = new Map<string, readonly unknown[]>([
      ["/repos/example-org/example-repo/actions/permissions", [{ allowed_actions: "selected", enabled: true }]],
      [
        "/repos/example-org/example-repo/actions/permissions/workflow",
        [{ can_approve_pull_request_reviews: false, default_workflow_permissions: "read" }],
      ],
      [
        "/repos/example-org/example-repo/labels",
        [
          { color: "a2eeef", description: null, name: "kind: feature" },
          { color: "d73a4a", description: null, name: "kind: bug fix" },
        ],
      ],
    ]);
    const synced = await syncGithubAtlas({
      api: fakeApi({ answers }),
      at: AT,
      paths,
      restOperations: [],
      scopes: { organisations: [], repositories: ["example-org/example-repo"] },
    });
    expect(synced._unsafeUnwrap().counts["actions-policy"]).toBe(1);
    expect(synced._unsafeUnwrap().counts["repository-label"]).toBe(2);
    const read = readGithubAtlas({ paths })._unsafeUnwrap();
    const policies = read.files["actions-policy"]!.entities;
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({
      allowedActions: "selected",
      canApprovePullRequestReviews: false,
      defaultWorkflowPermissions: "read",
      enabled: true,
      scopeLevel: "repository",
      scopeRef: "example-org/example-repo",
    });
  });

  it("records an EXPECTED refusal as a coverage boundary rather than a failure", async () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const failures = new Map<string, GithubAtlasError>([
      ["/orgs/example-org/actions/permissions", GithubAtlasErrors.scopeRefused({ route: "/x", scope: null })],
    ]);
    const answers = new Map<string, readonly unknown[]>(
      organisationRoutes({ org: "example-org" }).map((route) => [route, []]),
    );
    answers.set("/orgs/example-org", [{ login: "example-org" }]);
    const synced = await syncGithubAtlas({
      api: fakeApi({ answers, failures }),
      at: AT,
      paths,
      restOperations: [],
      scopes: { organisations: ["example-org"], repositories: [] },
    });
    expect(synced.isOk()).toBe(true);
    expect(synced._unsafeUnwrap().failures).toEqual([]);
  });

  it("records an UNEXPECTED refusal as a failure a reader has to see", async () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const failures = new Map<string, GithubAtlasError>([
      ["/orgs/example-org", GithubAtlasErrors.scopeRefused({ route: "/orgs/example-org", scope: "admin:org" })],
    ]);
    const answers = new Map<string, readonly unknown[]>(
      organisationRoutes({ org: "example-org" }).map((route) => [route, []]),
    );
    const synced = await syncGithubAtlas({
      api: fakeApi({ answers, failures }),
      at: AT,
      paths,
      restOperations: [],
      scopes: { organisations: ["example-org"], repositories: [] },
    });
    const summary = synced._unsafeUnwrap();
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]!.route).toBe("/orgs/example-org");
    expect(summary.uncovered).toContain("organization-settings");
  });

  it("keeps one kind's failure from hiding another kind's success", async () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const failures = new Map<string, GithubAtlasError>([
      ["/orgs/example-org", GithubAtlasErrors.scopeRefused({ route: "/orgs/example-org", scope: "admin:org" })],
    ]);
    const answers = new Map<string, readonly unknown[]>(
      organisationRoutes({ org: "example-org" }).map((route) => [route, []]),
    );
    answers.set("/orgs/example-org/hooks", [{ active: true, config: {}, events: [], id: 1 }]);
    const synced = await syncGithubAtlas({
      api: fakeApi({ answers, failures }),
      at: AT,
      paths,
      restOperations: [],
      scopes: { organisations: ["example-org"], repositories: [] },
    });
    expect(synced._unsafeUnwrap().counts["webhook"]).toBe(1);
  });

  it("publishes when admin routes answer a non-owner with 404, stamping each a permission boundary", async () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const failures = new Map<string, GithubAtlasError>([
      ["/orgs/example-org/hooks", GithubAtlasErrors.routeAbsent({ route: "/orgs/example-org/hooks" })],
      ["/orgs/example-org/installations", GithubAtlasErrors.routeAbsent({ route: "/orgs/example-org/installations" })],
    ]);
    const answers = new Map<string, readonly unknown[]>(
      organisationRoutes({ org: "example-org" }).map((route) => [route, []]),
    );
    answers.set("/orgs/example-org", [{ login: "example-org" }]);
    const synced = await syncGithubAtlas({
      api: fakeApi({ answers, failures }),
      at: AT,
      paths,
      restOperations: [],
      scopes: { organisations: ["example-org"], repositories: [] },
    });
    const summary = synced._unsafeUnwrap();
    expect(summary.failures).toEqual([]);
    expect(summary.uncovered).toEqual([]);
    const manifest = readGithubAtlas({ paths })._unsafeUnwrap().manifest!;
    expect(manifest.kinds.webhook.permissionBlocked!.detail).toBe(
      "this credential may not read /orgs/example-org/hooks — GitHub answered 404, which it does on this admin-gated route for a credential without the repository admin or organisation owner role",
    );
    expect(manifest.kinds["github-app-installation"].permissionBlocked!.at).toBe(AT);
  });

  it("stamps an EXPECTED 403 as a permission boundary, so it leaves the exit condition", async () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const failures = new Map<string, GithubAtlasError>([
      ["/orgs/example-org/actions/permissions", GithubAtlasErrors.scopeRefused({ route: "/a", scope: null })],
      ["/orgs/example-org/actions/permissions/workflow", GithubAtlasErrors.scopeRefused({ route: "/b", scope: null })],
    ]);
    const answers = new Map<string, readonly unknown[]>(
      organisationRoutes({ org: "example-org" }).map((route) => [route, []]),
    );
    answers.set("/orgs/example-org", [{ login: "example-org" }]);
    const synced = await syncGithubAtlas({
      api: fakeApi({ answers, failures }),
      at: AT,
      paths,
      restOperations: [],
      scopes: { organisations: ["example-org"], repositories: [] },
    });
    expect(synced._unsafeUnwrap().uncovered).toEqual([]);
    const manifest = readGithubAtlas({ paths })._unsafeUnwrap().manifest!;
    expect(manifest.kinds["actions-policy"].permissionBlocked!.detail).toBe(
      "this credential may not read /a — GitHub refused without naming a permission, which is usually an unaccepted SSO authorisation or a non-owner role; this credential may not read /b — GitHub refused without naming a permission, which is usually an unaccepted SSO authorisation or a non-owner role",
    );
  });

  it("refuses to publish a kind one route permission-refused and another broke", async () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const failures = new Map<string, GithubAtlasError>([
      ["/orgs/example-org/actions/permissions", GithubAtlasErrors.scopeRefused({ route: "/a", scope: null })],
      [
        "/orgs/example-org/actions/permissions/workflow",
        GithubAtlasErrors.transportExhausted({ cause: new Error("socket hang up"), route: "/b" }),
      ],
    ]);
    const answers = new Map<string, readonly unknown[]>(
      organisationRoutes({ org: "example-org" }).map((route) => [route, []]),
    );
    answers.set("/orgs/example-org", [{ login: "example-org" }]);
    const synced = await syncGithubAtlas({
      api: fakeApi({ answers, failures }),
      at: AT,
      paths,
      restOperations: [],
      scopes: { organisations: ["example-org"], repositories: [] },
    });
    const refusal = synced._unsafeUnwrapErr().join("\n");
    expect(refusal).toContain("the github atlas would publish actions-policy while having never acquired it");
  });

  it("keeps a kind uncovered when its credential is rejected outright", async () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const failures = new Map<string, GithubAtlasError>([
      ["/orgs/example-org/hooks", GithubAtlasErrors.authFailed({ reason: "HTTP 401 on /orgs/example-org/hooks" })],
    ]);
    const answers = new Map<string, readonly unknown[]>(
      organisationRoutes({ org: "example-org" }).map((route) => [route, []]),
    );
    answers.set("/orgs/example-org", [{ login: "example-org" }]);
    const synced = await syncGithubAtlas({
      api: fakeApi({ answers, failures }),
      at: AT,
      paths,
      restOperations: [],
      scopes: { organisations: ["example-org"], repositories: [] },
    });
    const refusal = synced._unsafeUnwrapErr().join("\n");
    expect(refusal).toContain("the github atlas would publish webhook while having never acquired it");
  });

  it("does not demand the browser kinds of an API sync", async () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const answers = new Map<string, readonly unknown[]>(
      organisationRoutes({ org: "example-org" }).map((route) => [route, []]),
    );
    answers.set("/orgs/example-org", [{ login: "example-org" }]);
    const synced = await syncGithubAtlas({
      api: fakeApi({ answers }),
      at: AT,
      paths,
      restOperations: [],
      scopes: { organisations: ["example-org"], repositories: [] },
    });
    expect(synced._unsafeUnwrap().uncovered).not.toContain("admin-page");
  });

  it("fails a ruleset listing that omits required enforcement, keeping the rulesets already stored", async () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const answers = new Map<string, readonly unknown[]>(
      organisationRoutes({ org: "example-org" }).map((route) => [route, []]),
    );
    answers.set("/orgs/example-org", [{ login: "example-org" }]);
    answers.set("/orgs/example-org/rulesets", [{ enforcement: "active", id: 41, name: "stored-ruleset" }]);
    const scopes = { organisations: ["example-org"], repositories: [] };
    await syncGithubAtlas({ api: fakeApi({ answers }), at: AT, paths, restOperations: [], scopes });

    answers.set("/orgs/example-org/rulesets", [{ id: 41, name: "stored-ruleset" }]);
    const later = "2026-09-06T00:00:00.000Z";
    const synced = await syncGithubAtlas({ api: fakeApi({ answers }), at: later, paths, restOperations: [], scopes });
    const summary = synced._unsafeUnwrap();
    expect(summary.failures).toEqual([
      {
        reason: GithubAtlasErrors.unusableResponse({
          reason: "ruleset record 0 omitted the required field enforcement",
          route: "/orgs/example-org/rulesets",
        }).message,
        route: "/orgs/example-org/rulesets",
      },
    ]);
    expect(summary.counts["ruleset"]).toBe(1);
    const stored = readGithubAtlas({ paths })._unsafeUnwrap().files["ruleset"]!.entities;
    expect(stored.map((entity) => ({ id: entity.providerId, state: entity.state }))).toEqual([
      { id: "41", state: "observed" },
    ]);
  });
});

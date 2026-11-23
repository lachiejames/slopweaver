/**
 * The readings the lock and `store verify` share: whether an attempt is the lock's login on this stack's server,
 * the default-credential door's URL, and the API roles' stray rights as read back.
 */
import { describe, expect, it } from "vitest";

import { ok, unwrap } from "#lib/result.js";

import { defaultUrl, grantFindings, loginProblem } from "../../../../store/lock/proofs.js";

const START = "2026-11-03 09:00:00+00";

describe("loginProblem", () => {
  it("is null for the login running as postgres on this stack's server", () => {
    const attempt = {
      currentUser: "postgres",
      kind: "accepted",
      postmasterStart: START,
      sessionUser: "slopweaver_login",
    } as const;
    expect(loginProblem({ attempt, postmasterStart: START })).toBe(null);
  });

  it("names a refusal", () => {
    const attempt = { byRule: false, kind: "refused", why: "password authentication failed" } as const;
    expect(loginProblem({ attempt, postmasterStart: START })).toBe("refused: password authentication failed");
  });

  it("names a server that would not identify itself", () => {
    const attempt = { kind: "unidentified", why: "permission denied" } as const;
    expect(loginProblem({ attempt, postmasterStart: START })).toBe(
      "logged in, but the server could not be identified: permission denied",
    );
  });

  it("names a login as the wrong role", () => {
    const attempt = {
      currentUser: "postgres",
      kind: "accepted",
      postmasterStart: START,
      sessionUser: "postgres",
    } as const;
    expect(loginProblem({ attempt, postmasterStart: START })).toBe(
      "logged in as postgres, running as postgres, not slopweaver_login running as postgres",
    );
  });

  it("names a login that reached another server", () => {
    const attempt = {
      currentUser: "postgres",
      kind: "accepted",
      postmasterStart: "2026-01-01 00:00:00+00",
      sessionUser: "slopweaver_login",
    } as const;
    expect(loginProblem({ attempt, postmasterStart: START })).toBe(
      "reached a server that is not this stack's container — its start time differs from the one read over the container's socket",
    );
  });
});

describe("defaultUrl", () => {
  it("names the default credentials at one loopback host and port", () => {
    expect(defaultUrl({ host: "[::1]", port: 55322 })).toBe("postgresql://postgres:postgres@[::1]:55322/postgres");
  });
});

describe("grantFindings", () => {
  it("reads nothing stray when both read-backs are empty", () => {
    expect(
      unwrap(grantFindings({ database: "postgres", deps: { adminSql: () => ok("") }, projectId: "acme" })),
    ).toEqual([]);
  });

  it("words a stray table right and a stray default right", () => {
    const adminSql = ({ script }: { script: string }) =>
      ok(script.includes("pg_default_acl") ? "postgres|TRUNCATE|anon" : "docs|TRUNCATE|anon");
    expect(unwrap(grantFindings({ database: "postgres", deps: { adminSql }, projectId: "acme" }))).toEqual([
      "the API roles hold 1 table right(s) on 1 store table(s): TRUNCATE to anon",
      "new tables in public would grant the API roles: postgres TRUNCATE anon",
    ]);
  });
});

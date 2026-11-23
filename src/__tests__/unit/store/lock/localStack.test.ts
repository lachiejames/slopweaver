/**
 * The lock's stack identity and its working start: which config it reads, which selections it refuses, and how
 * the password plan never silently replaces a login another home holds.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { lockStart, passwordPlan, reachesStack, stackIdentity } from "../../../../store/lock/localStack.js";

const CONFIG = [
  "# A comment before anything",
  'project_id = "acme"',
  "",
  "[api]",
  "port = 55321",
  "",
  "[db]",
  "# Port to use for the local database URL.",
  "port = 55322",
  "shadow_port = 55320",
  "",
  "[studio]",
  "port = 55323",
].join("\n");

const STACK = { dbPort: 55322, projectId: "acme" };

describe("stackIdentity", () => {
  it("reads the top-level project_id and the [db] section's port, not another section's", () => {
    expect(unwrap(stackIdentity({ configToml: CONFIG }))).toEqual({ dbPort: 55322, projectId: "acme" });
  });

  it("refuses a config with no project_id", () => {
    const error = unwrapErr(stackIdentity({ configToml: CONFIG.replace('project_id = "acme"', "") }));
    expect(error.code).toBe("NOT_LOCAL_STACK");
    expect(error.message).toContain("names no project_id");
  });

  it("refuses a config whose [db] section carries no port", () => {
    const error = unwrapErr(stackIdentity({ configToml: CONFIG.replace("port = 55322\n", "") }));
    expect(error.message).toContain("[db] section names no port");
  });

  it("refuses a config with no [db] section", () => {
    const error = unwrapErr(stackIdentity({ configToml: 'project_id = "acme"\n[api]\nport = 1\n' }));
    expect(error.message).toContain("has no [db] section");
  });
});

describe("reachesStack", () => {
  it("is true for a loopback host on the stack's port, in every loopback spelling", () => {
    expect(reachesStack({ stack: STACK, url: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" })).toBe(true);
    expect(reachesStack({ stack: STACK, url: "postgresql://postgres:postgres@localhost:55322/postgres" })).toBe(true);
    expect(reachesStack({ stack: STACK, url: "postgresql://postgres:postgres@[::1]:55322/postgres" })).toBe(true);
  });

  it("is false for another port, another host, or no URL at all", () => {
    expect(reachesStack({ stack: STACK, url: "postgresql://postgres:postgres@127.0.0.1:5432/postgres" })).toBe(false);
    expect(reachesStack({ stack: STACK, url: "postgresql://u:p@db.acme.example:55322/postgres" })).toBe(false);
    expect(reachesStack({ stack: STACK, url: "not a url" })).toBe(false);
  });
});

describe("lockStart", () => {
  it("works from the stack's default door when nothing is selected yet", () => {
    expect(unwrap(lockStart({ selection: null, stack: STACK }))).toEqual({
      currentUrl: "postgresql://postgres:postgres@127.0.0.1:55322/postgres",
      database: "postgres",
      selectionIsLogin: false,
    });
  });

  it("keeps a selected database and notices the selection is already the lock's login", () => {
    const url = "postgresql://slopweaver_login:FIXTURE@127.0.0.1:55322/slopweaver";
    expect(unwrap(lockStart({ selection: { origin: "secret", url }, stack: STACK }))).toEqual({
      currentUrl: url,
      database: "slopweaver",
      selectionIsLogin: true,
    });
  });

  it("refuses a selection made by the environment variable, which would override the file the lock writes", () => {
    const error = unwrapErr(
      lockStart({
        selection: { origin: "environment", url: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" },
        stack: STACK,
      }),
    );
    expect(error.code).toBe("NOT_LOCAL_STACK");
    expect(error.message).toContain("SLOPWEAVER_STORE_URL");
  });

  it("refuses a selection on another host", () => {
    const error = unwrapErr(
      lockStart({ selection: { origin: "secret", url: "postgresql://u:p@db.acme.test:55322/x" }, stack: STACK }),
    );
    expect(error.message).toContain("reaches another host");
  });

  it("refuses a selection on another port, naming both", () => {
    const error = unwrapErr(
      lockStart({ selection: { origin: "secret", url: "postgresql://u:p@127.0.0.1:5432/x" }, stack: STACK }),
    );
    expect(error.message).toContain("names port 5432, the acme stack is on 55322");
  });

  it("refuses a selection naming no database", () => {
    const error = unwrapErr(
      lockStart({ selection: { origin: "secret", url: "postgresql://u:p@127.0.0.1:55322/" }, stack: STACK }),
    );
    expect(error.message).toContain("names no database");
  });
});

describe("passwordPlan", () => {
  const base = { pendingLogsIn: false, roleExists: true, rotate: false, selectionLogsIn: false };

  it("keeps a selection that already logs in", () => {
    expect(unwrap(passwordPlan({ ...base, selectionLogsIn: true }))).toEqual({ kind: "keep" });
  });

  it("adopts a pending password an interrupted run left behind", () => {
    expect(unwrap(passwordPlan({ ...base, pendingLogsIn: true }))).toEqual({ kind: "adopt-pending" });
  });

  it("creates the role when it is absent", () => {
    expect(unwrap(passwordPlan({ ...base, roleExists: false }))).toEqual({ kind: "create" });
  });

  it("refuses, naming --rotate, when the role exists and nothing in this home logs in as it", () => {
    const error = unwrapErr(passwordPlan(base));
    expect(error.code).toBe("PROOF_FAILED");
    expect(error.message).toContain("Pass --rotate");
  });

  it("rotates on --rotate even over a working selection, and creates on --rotate when the role is absent", () => {
    expect(unwrap(passwordPlan({ ...base, rotate: true, selectionLogsIn: true }))).toEqual({ kind: "rotate" });
    expect(unwrap(passwordPlan({ ...base, roleExists: false, rotate: true }))).toEqual({ kind: "create" });
  });

  it("adopts a working pending password even on --rotate when it is the only copy, and rotates once a selection works", () => {
    expect(unwrap(passwordPlan({ ...base, pendingLogsIn: true, rotate: true }))).toEqual({ kind: "adopt-pending" });
    expect(unwrap(passwordPlan({ ...base, pendingLogsIn: true, rotate: true, selectionLogsIn: true }))).toEqual({
      kind: "rotate",
    });
  });
});

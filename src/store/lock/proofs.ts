/**
 * The behavioural readings the lock proves itself with and `store verify` measures it with: whether an attempt is
 * the lock's login on THIS stack's server, the default-credential door that must be refused, and the API roles'
 * stray table rights. Shared by `./reconcile.ts` (which acts, then proves) and `./measure.ts` (which only reads).
 */
import { err, ok, type Result } from "#lib/result.js";

import type { adminSql } from "./edge.js";
import type { StoreLockError } from "./errors.js";
import { DEFAULT_GRANTS_QUERY, grantProblems, TABLE_GRANTS_QUERY } from "./grants.js";
import { LOCK_LOGIN_ROLE } from "./hba.js";
import { DEFAULT_STACK_CREDENTIALS } from "./localStack.js";
import type { LoginAttempt } from "./macLogin.js";

/** The two loopback families the default door is tried over. */
export const LOOPBACK_HOSTS = ["127.0.0.1", "[::1]"] as const;

/**
 * The default-credential URL at one host — the door that must be refused.
 *
 * @param host `127.0.0.1` or `[::1]`
 * @param port the stack's database port
 * @returns the URL
 */
export function defaultUrl({ host, port }: { host: string; port: number }): string {
  return `postgresql://${DEFAULT_STACK_CREDENTIALS}@${host}:${String(port)}/postgres`;
}

/**
 * Whether an attempt is the lock's login reaching THIS stack's server as `postgres`.
 *
 * @param attempt one login tried from the Mac
 * @param postmasterStart the server's start time read over the container's socket
 * @returns a refusal sentence, or `null` when it is
 */
export function loginProblem({
  attempt,
  postmasterStart,
}: {
  attempt: LoginAttempt;
  postmasterStart: string;
}): string | null {
  if (attempt.kind === "refused") {
    return `refused: ${attempt.why}`;
  }
  if (attempt.kind === "unidentified") {
    return `logged in, but the server could not be identified: ${attempt.why}`;
  }
  const wrongIdentity = attempt.sessionUser !== LOCK_LOGIN_ROLE || attempt.currentUser !== "postgres";
  if (wrongIdentity) {
    return `logged in as ${attempt.sessionUser}, running as ${attempt.currentUser}, not ${LOCK_LOGIN_ROLE} running as postgres`;
  }
  if (attempt.postmasterStart !== postmasterStart) {
    return "reached a server that is not this stack's container — its start time differs from the one read over the container's socket";
  }
  return null;
}

/**
 * The API roles' stray table rights, as `grantProblems` words them.
 *
 * @returns one sentence per kind of stray right
 */
export function grantFindings({
  projectId,
  database,
  deps,
}: {
  projectId: string;
  database: string;
  deps: { readonly adminSql: typeof adminSql };
}): Result<readonly string[], StoreLockError> {
  const tables = deps.adminSql({
    database,
    projectId,
    script: `${TABLE_GRANTS_QUERY};\n`,
    step: "reading the API roles' table rights",
  });
  if (tables.isErr()) {
    return err(tables.error);
  }
  const defaults = deps.adminSql({
    database,
    projectId,
    script: `${DEFAULT_GRANTS_QUERY};\n`,
    step: "reading the API roles' default rights",
  });
  if (defaults.isErr()) {
    return err(defaults.error);
  }
  return ok(grantProblems({ defaultGrants: defaults.value.split("\n"), tableGrants: tables.value.split("\n") }));
}

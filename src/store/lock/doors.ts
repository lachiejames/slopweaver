/**
 * Closing every other door once the lock's login is written: the managed `pg_hba.conf` block, the default
 * credentials refused from the Mac over both loopback families, every session that came in before the rule ended,
 * and the API roles' stray table rights revoked — each proven by behaviour, in that order, by `./reconcile.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";

import { gatewaySessionsQuery } from "./edgeParse.js";
import { type StoreLockError, StoreLockErrors } from "./errors.js";
import { revokeStatements } from "./grants.js";
import { loadedHbaProblems, lockedHbaText } from "./hba.js";
import { defaultUrl, grantFindings, LOOPBACK_HOSTS } from "./proofs.js";
import type { LockDeps } from "./reconcile.js";

/**
 * Install the rule, prove the default door refused, end the stray sessions, and revoke the API roles' rights.
 *
 * @param gateway the address Mac logins arrive from
 * @param port the stack's database port
 * @param database the store's database, whose table rights are revoked
 * @param superseded whether the login's password was replaced, so its open sessions may hold the old one
 * @returns whether the rule file was rewritten, how many sessions were ended and one line per proof, or the first
 *   step that refused
 */
export async function closeDoors({
  database,
  deps,
  gateway,
  port,
  projectId,
  superseded,
}: {
  database: string;
  deps: LockDeps;
  gateway: string;
  port: number;
  projectId: string;
  superseded: boolean;
}): Promise<Result<{ hbaRewritten: boolean; evicted: number; proofs: readonly string[] }, StoreLockError>> {
  const rule = installRule({ deps, gateway, projectId });
  if (rule.isErr()) {
    return err(rule.error);
  }
  const closed = await proveClosed({ deps, port });
  if (closed.isErr()) {
    return err(closed.error);
  }
  const evicted = evictStrays({ deps, gateway, projectId, superseded });
  if (evicted.isErr()) {
    return err(evicted.error);
  }
  const grants = revokeGrants({ database, deps, projectId });
  if (grants.isErr()) {
    return err(grants.error);
  }
  return ok({
    evicted: evicted.value,
    hbaRewritten: rule.value,
    proofs: [...closed.value, "the API roles hold no right on the store's tables, now or by default"],
  });
}

/**
 * Put the managed block in the container's `pg_hba.conf` when it is not already there, reload, and judge the
 * rules as Postgres parses them.
 *
 * @returns whether the file was rewritten
 */
function installRule({
  projectId,
  gateway,
  deps,
}: {
  projectId: string;
  gateway: string;
  deps: LockDeps;
}): Result<boolean, StoreLockError> {
  const file = deps.readHbaFile({ projectId });
  if (file.isErr()) {
    return err(file.error);
  }
  const locked = lockedHbaText({ current: file.value.text, gateway });
  if (locked.isErr()) {
    return err(locked.error);
  }
  const rewrite = locked.value.trimEnd() !== file.value.text.trimEnd();
  if (rewrite) {
    const installed = deps.installHbaFile({ path: file.value.path, projectId, text: locked.value });
    if (installed.isErr()) {
      return err(installed.error);
    }
  }
  const rules = deps.reloadAndReadRules({ projectId });
  if (rules.isErr()) {
    return err(rules.error);
  }
  const problems = loadedHbaProblems({ gateway, rules: rules.value });
  if (problems.length > 0) {
    return err(StoreLockErrors.hbaUnplaceable({ detail: problems.join("; ") }));
  }
  return ok(rewrite);
}

/**
 * Prove the default door is refused from the Mac over both loopback families.
 *
 * @returns one proof line per family
 */
async function proveClosed({
  port,
  deps,
}: {
  port: number;
  deps: LockDeps;
}): Promise<Result<readonly string[], StoreLockError>> {
  const proofs: string[] = [];
  for (const host of LOOPBACK_HOSTS) {
    const attempt = await deps.loginUntilRefused({ url: defaultUrl({ host, port }) });
    const refusedByRule = attempt.kind === "refused" && attempt.byRule;
    if (!refusedByRule) {
      const detail =
        attempt.kind === "refused"
          ? `refused, but not by the rule: ${attempt.why}`
          : `postgres:postgres logged in at ${host}`;
      return err(StoreLockErrors.proofFailed({ detail, proof: `the default door at ${host}` }));
    }
    proofs.push(`postgres:postgres is refused by the rule at ${host}`);
  }
  return ok(proofs);
}

/**
 * End every session from the Mac that is not the login, then prove none is left. When this run or an interrupted
 * earlier one replaced the login's password, the login's own sessions are ended too: a password change never ends
 * a session already open, so one opened with the old password would keep full `postgres` rights, and `store verify` cannot tell it from a session on the current password.
 *
 * @param superseded whether the login's password was replaced, so its open sessions may hold the old one
 * @returns how many were ended
 */
function evictStrays({
  projectId,
  gateway,
  superseded,
  deps,
}: {
  projectId: string;
  gateway: string;
  superseded: boolean;
  deps: LockDeps;
}): Result<number, StoreLockError> {
  const ended = deps.adminCount({
    database: "postgres",
    projectId,
    query: gatewaySessionsQuery({ gateway, includeLogin: superseded, terminate: true }),
    step: superseded
      ? "ending sessions that came in before the rule or on the replaced password"
      : "ending sessions that came in before the rule",
  });
  if (ended.isErr()) {
    return err(ended.error);
  }
  const left = deps.adminCount({
    database: "postgres",
    projectId,
    query: gatewaySessionsQuery({ gateway, includeLogin: false, terminate: false }),
    step: "counting sessions from the Mac",
  });
  if (left.isErr()) {
    return err(left.error);
  }
  if (left.value > 0) {
    return err(
      StoreLockErrors.proofFailed({
        detail: `${String(left.value)} session(s) from the Mac are still open as another role`,
        proof: "no stray session",
      }),
    );
  }
  return ok(ended.value);
}

/**
 * Revoke the API roles' table rights in the store's database and prove none is left.
 *
 * @returns nothing once none is left
 */
function revokeGrants({
  projectId,
  database,
  deps,
}: {
  projectId: string;
  database: string;
  deps: LockDeps;
}): Result<void, StoreLockError> {
  const revoked = deps.adminSql({
    database,
    projectId,
    script: ["\\set ON_ERROR_STOP on", ...revokeStatements().map((statement) => `${statement};`), ""].join("\n"),
    step: "revoking the API roles' table rights",
  });
  if (revoked.isErr()) {
    return err(revoked.error);
  }
  const problems = grantFindings({ database, deps, projectId });
  if (problems.isErr()) {
    return err(problems.error);
  }
  if (problems.value.length > 0) {
    return err(
      StoreLockErrors.proofFailed({ detail: problems.value.join("; "), proof: "the API roles' table rights" }),
    );
  }
  return ok(undefined);
}

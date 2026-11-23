/**
 * Settling the password a lock run ends with: keep the selection's, adopt one an interrupted run parked, or mint
 * one — and, before anything changes on a stack whose login role carries no backup marker, take the pre-lock
 * backup. The order inside is the safety `./reconcile.ts`'s header describes: a minted password is parked
 * durably BEFORE the role is touched.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { LockBackupOutcome } from "./backupGate.js";
import type { StoreLockError } from "./errors.js";
import { LOCK_LOGIN_ROLE } from "./hba.js";
import { type LockStart, type PasswordPlan, passwordPlan, type StackIdentity } from "./localStack.js";
import {
  isGeneratedPassword,
  loginRoleScript,
  loginUrl,
  markRoleStatement,
  PASSWORD_BYTES,
  passwordFrom,
  roleMarkedQuery,
  scramVerifier,
} from "./login.js";
import { loginProblem } from "./proofs.js";
import type { LockDeps, LockRequest } from "./reconcile.js";

/** Bytes of salt in a SCRAM verifier — the server's own length. */
const SALT_BYTES = 16;

/** The password a run ends with, and what it means for the parked copy and the login's open sessions. */
interface SettledPassword {
  readonly password: string;
  /** The password may have replaced the role's earlier one, so its open sessions and store-url need redoing. */
  readonly superseded: boolean;
  /** A different parked password stays in place rather than being cleared. */
  readonly keepParked: boolean;
}

/**
 * The password a selected login URL carries.
 *
 * @param url a URL {@link loginUrl} built
 * @returns its password, decoded
 */
function passwordOf({ url }: { url: string }): string {
  return decodeURIComponent(new URL(url).password);
}

/**
 * Whether one URL logs in as the lock's login on this stack's server.
 *
 * @param url the URL tried
 * @param socketStart the server start time read over the socket, which a login must match
 * @returns true when it does
 */
async function logsIn({
  deps,
  socketStart,
  url,
}: {
  deps: LockDeps;
  socketStart: string;
  url: string;
}): Promise<boolean> {
  return loginProblem({ attempt: await deps.tryLogin({ url }), postmasterStart: socketStart }) === null;
}

/**
 * Settle the password this run ends with: keep, adopt a pending one, or mint one — and, before anything changes on
 * a stack whose login role carries no backup marker, take the pre-lock backup.
 *
 * `superseded` is true when this run rotates, or found the password it ends with parked (so an earlier run may have
 * replaced the role's password and died before finishing): the login's open sessions may hold an old password, and
 * the visible store-url may not be durable yet. `keepParked` is true when a kept login leaves a different parked
 * password, which is never deleted.
 *
 * @param socketStart the server start time read over the socket, which a login must match
 * @returns the plan, the password, the backup it took, whether the password may have been replaced, and whether
 *   the parked password stays
 */
export async function settlePassword({
  request,
  start,
  socketStart,
  deps,
}: {
  request: LockRequest;
  start: LockStart;
  socketStart: string;
  deps: LockDeps;
}): Promise<
  Result<SettledPassword & { readonly plan: PasswordPlan; readonly backup: LockBackupOutcome | null }, StoreLockError>
> {
  const { home, stack, rotate } = request;
  const pending = deps.readPending({ home, projectId: stack.projectId });
  const proven = await provenLogins({ deps, pending, socketStart, stack, start });
  if (proven.isErr()) {
    return err(proven.error);
  }
  const roleExists = loginRoleExists({ deps, projectId: stack.projectId });
  if (roleExists.isErr()) {
    return err(roleExists.error);
  }
  const plan = passwordPlan({
    pendingLogsIn: proven.value.pendingLogsIn,
    roleExists: roleExists.value,
    rotate,
    selectionLogsIn: proven.value.selectionLogsIn,
  });
  if (plan.isErr()) {
    return err(plan.error);
  }
  deps.progress({ line: `store lock: login — ${plan.value.kind}` });
  const backup = await backupUnlessMarked({
    currentUrl: start.currentUrl,
    deps,
    home,
    projectId: stack.projectId,
    roleExists: roleExists.value,
  });
  if (backup.isErr()) {
    return err(backup.error);
  }
  const settled = passwordFor({
    currentUrl: start.currentUrl,
    deps,
    home,
    pending,
    plan: plan.value,
    projectId: stack.projectId,
  });
  return settled.map(({ keepParked, password, superseded }) => ({
    backup: backup.value,
    keepParked,
    password,
    plan: plan.value,
    superseded,
  }));
}

/**
 * Which stored passwords log in as the lock's login on this stack — none, when the server is not checking passwords.
 *
 * @param pending the password parked for this stack, or `null`
 * @returns whether the selection and the parked password each log in, or the step that failed
 */
async function provenLogins({
  deps,
  pending,
  socketStart,
  stack,
  start,
}: {
  deps: LockDeps;
  pending: string | null;
  socketStart: string;
  stack: StackIdentity;
  start: LockStart;
}): Promise<Result<{ selectionLogsIn: boolean; pendingLogsIn: boolean }, StoreLockError>> {
  const anyStored = start.selectionIsLogin || pending !== null;
  const checked = anyStored ? await passwordsChecked({ deps, stack, start }) : ok(true);
  if (checked.isErr()) {
    return err(checked.error);
  }
  const selectionLogsIn =
    checked.value && start.selectionIsLogin && (await logsIn({ deps, socketStart, url: start.currentUrl }));
  const pendingUrl =
    pending === null ? null : loginUrl({ database: start.database, password: pending, port: stack.dbPort });
  const pendingLogsIn =
    checked.value &&
    pendingUrl !== null &&
    pendingUrl.isOk() &&
    (await logsIn({ deps, socketStart, url: pendingUrl.value }));
  return ok({ pendingLogsIn, selectionLogsIn });
}

/**
 * Whether the lock's login role is already in the cluster.
 *
 * @returns true when it is, or the read that failed
 */
function loginRoleExists({ deps, projectId }: { deps: LockDeps; projectId: string }): Result<boolean, StoreLockError> {
  const roleCount = deps.adminCount({
    database: "postgres",
    projectId,
    query: `select count(*) from pg_roles where rolname = '${LOCK_LOGIN_ROLE}'`,
    step: "reading the login role",
  });
  return roleCount.map((count) => count > 0);
}

/**
 * The password a settled plan ends with — the selection's when kept, the parked one when adopted, else a minted
 * one applied to the role.
 *
 * @param currentUrl the URL the selection names, whose password a `keep` ends with
 * @param pending the password parked for this stack, or `null`
 * @returns the password and what it means for the parked copy, or the step that failed
 */
function passwordFor({
  currentUrl,
  deps,
  home,
  pending,
  plan,
  projectId,
}: {
  currentUrl: string;
  deps: LockDeps;
  home: string;
  pending: string | null;
  plan: PasswordPlan;
  projectId: string;
}): Result<SettledPassword, StoreLockError> {
  if (plan.kind === "keep") {
    const password = passwordOf({ url: currentUrl });
    // A parked password that is not the one kept may belong to a run killed while its role change was still in
    // flight inside the container, which can commit after this run ends: it stays parked, so the next run adopts it
    // if it ever logs in.
    const parkedElsewhere = pending !== null && pending !== password;
    const parkedHere = pending !== null && pending === password;
    return ok({ keepParked: parkedElsewhere, password, superseded: parkedHere });
  }
  const superseded = pending !== null || plan.kind === "rotate";
  if (plan.kind === "adopt-pending" && pending !== null) {
    return ok({ keepParked: false, password: pending, superseded });
  }
  const mode = plan.kind === "rotate" ? "rotate" : "create";
  const minted = mintAndApply({ deps, home, mode, parked: pending, projectId });
  return minted.map((password) => ({ keepParked: false, password, superseded }));
}

/**
 * Whether the server is checking the login role's password at all: a random password nobody holds must be refused.
 * A `trust` rule someone added would admit any password, so a stored one that "logs in" would prove nothing — and a
 * run that kept it, then installed the password rule, would leave the role with a password neither file holds
 * When the decoy gets in, no stored password counts as proven and the plan refuses short
 * of `--rotate`, which sets one it knows.
 *
 * @returns true when a wrong password is refused, or the step that failed
 */
async function passwordsChecked({
  deps,
  stack,
  start,
}: {
  deps: LockDeps;
  stack: StackIdentity;
  start: LockStart;
}): Promise<Result<boolean, StoreLockError>> {
  const decoy = passwordFrom({ random: deps.randomBytes({ size: PASSWORD_BYTES }) });
  if (decoy.isErr()) {
    return err(decoy.error);
  }
  const decoyUrl = loginUrl({ database: start.database, password: decoy.value, port: stack.dbPort });
  if (decoyUrl.isErr()) {
    return err(decoyUrl.error);
  }
  // Any login at all on the wrong password counts, whatever it then ran as or reported.
  const admitted = (await deps.tryLogin({ url: decoyUrl.value })).kind !== "refused";
  if (admitted) {
    deps.progress({
      line: `store lock: the server let ${LOCK_LOGIN_ROLE} in on a random wrong password, so no stored password is taken as proven`,
    });
  }
  return ok(!admitted);
}

/**
 * Take the pre-lock backup unless the login role already carries the lock's marker, which only a run that finished
 * its backup writes. A missing role is unmarked by definition, so a first lock always backs up; a role found
 * unmarked (made by hand) is backed up and then marked, so the next run does not repeat it.
 *
 * What the mark does not close: it is a role comment, so a store superuser can write it by hand and skip the copy
 * The copy guards against this verb's own mistakes, not against an actor who already holds
 * the store — one who could drop the tables outright. A receipt under the home would not close it either, since
 * anything running as the owner writes there too.
 *
 * @param currentUrl the URL the rehearsal compares the copy against, which must log in
 * @param roleExists whether the login role is already in the cluster
 * @returns the backup taken, `null` when the role was already marked, or the gate's refusal
 */
async function backupUnlessMarked({
  currentUrl,
  deps,
  home,
  projectId,
  roleExists,
}: {
  currentUrl: string;
  deps: LockDeps;
  home: string;
  projectId: string;
  roleExists: boolean;
}): Promise<Result<LockBackupOutcome | null, StoreLockError>> {
  if (roleExists) {
    const marked = deps.adminCount({
      database: "postgres",
      projectId,
      query: roleMarkedQuery(),
      step: "reading whether the login role was backed up",
    });
    if (marked.isErr()) {
      return err(marked.error);
    }
    if (marked.value > 0) {
      return ok(null);
    }
  }
  const taken = await deps.takeBackup({ currentUrl, home, projectId });
  if (taken.isErr()) {
    return err(taken.error);
  }
  if (roleExists) {
    const mark = deps.adminSql({
      database: "postgres",
      projectId,
      script: `\\set ON_ERROR_STOP on\n${markRoleStatement()}\n`,
      step: "marking the login role as backed up",
    });
    if (mark.isErr()) {
      return err(mark.error);
    }
  }
  return ok(taken.value);
}

/**
 * Settle the new password, park it as pending, and create or rotate the role with its verifier. A password already
 * parked is REUSED rather than replaced: it may be the role's current one where this run could not prove otherwise
 * (a `trust` rule admits every password), and overwriting it before the role changes would leave a kill in between
 * with the role's password in neither file. It is still a minted password only this home holds,
 * and it is fsynced in place before the role changes.
 *
 * @param parked the pending password this run read, or null when none is parked
 * @returns the password
 */
function mintAndApply({
  home,
  mode,
  parked,
  projectId,
  deps,
}: {
  home: string;
  mode: "create" | "rotate";
  parked: string | null;
  projectId: string;
  deps: LockDeps;
}): Result<string, StoreLockError> {
  const reuse = parked !== null && isGeneratedPassword({ password: parked });
  const password = reuse ? ok(parked) : passwordFrom({ random: deps.randomBytes({ size: PASSWORD_BYTES }) });
  if (password.isErr()) {
    return err(password.error);
  }
  // A reused password is synced in place, never rewritten: a run killed after its write but before its directory sync
  // leaves it visible yet not durable, and a rewrite would open a window with it nowhere.
  const parkedDurably = reuse
    ? deps.syncPending({ home, projectId })
    : deps.writePending({ home, password: password.value, projectId });
  if (parkedDurably.isErr()) {
    return err(parkedDurably.error);
  }
  const script = loginRoleScript({
    mode,
    verifier: scramVerifier({ password: password.value, salt: deps.randomBytes({ size: SALT_BYTES }) }),
  });
  if (script.isErr()) {
    return err(script.error);
  }
  const applied = deps.adminSql({
    database: "postgres",
    projectId,
    script: script.value,
    step: `${mode === "create" ? "creating" : "rotating"} the login role`,
  });
  return applied.map(() => password.value);
}

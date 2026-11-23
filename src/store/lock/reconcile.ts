/**
 * The store lock, in order: settle a working login for the verbs, write it, close every other password door from
 * the Mac, end any session that came in before the door closed, and take the API roles' stray table rights away
 * — then prove each of those by behaviour, not by reading back what was written. Idempotent: a re-run after a
 * recreate (which restores the image's `pg_hba.conf`) puts the rule back and changes nothing else.
 *
 * **The order is the safety.** Until the new connection string is proven to log in AND written to
 * `secrets/store-url`, nothing that could lock the verbs out has happened — the old URL keeps working, because
 * the rule that refuses it is installed only after. A crash between any two steps converges on the next run:
 * a password minted but not yet written is kept in its stack's `store-lock/pending-login-<project_id>` (0600) BEFORE the role is touched
 * and adopted if it logs in; a written URL with no rule yet is a `keep` that installs the rule.
 *
 * **What it does not stop**, stated so nobody discovers it mid-turn: anything running as the owner can read
 * `secrets/store-url`, and can drive Docker into the container's socket, where `supabase_admin` needs no password
 * at all. The store-door-only page named that residue, and its option C is the build that closes it. Between a
 * container recreate and the next `store start` / `store lock`, the image's rules are back and the default
 * password works from the Mac again; the lock ends any session that used that window, it cannot prevent one.
 *
 * The steps live beside it: settling the password in `./settle.ts`, closing the other doors in `./doors.ts`, and
 * `store verify`'s read-only measurement in `./measure.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";

import { exposuresOf, type PublishedPort } from "../dockerPublication.js";
import type { LockBackupOutcome } from "./backupGate.js";
import { closeDoors } from "./doors.js";
import type {
  adminCount,
  adminSql,
  holdStackLock,
  installHbaFile,
  postmasterStartOverSocket,
  publishedPorts,
  readHbaFile,
  readRules,
  reloadAndReadRules,
  stackGateway,
} from "./edge.js";
import { type StoreLockError, StoreLockErrors } from "./errors.js";
import { LOCK_LOGIN_ROLE } from "./hba.js";
import { type FoundSelection, type LockStart, lockStart, type PasswordPlan, type StackIdentity } from "./localStack.js";
import { loginUrl } from "./login.js";
import type { hostIsLocal, loginUntilRefused, tryLogin } from "./macLogin.js";
import { loginProblem } from "./proofs.js";
import { settlePassword } from "./settle.js";

/** Every effect the lock performs, named once so a test can hand in plain fakes. */
export interface LockDeps {
  readonly publishedPorts: typeof publishedPorts;
  readonly stackGateway: typeof stackGateway;
  readonly holdStackLock: typeof holdStackLock;
  readonly postmasterStartOverSocket: typeof postmasterStartOverSocket;
  readonly tryLogin: typeof tryLogin;
  readonly hostIsLocal: typeof hostIsLocal;
  readonly loginUntilRefused: typeof loginUntilRefused;
  readonly adminSql: typeof adminSql;
  readonly adminCount: typeof adminCount;
  readonly readHbaFile: typeof readHbaFile;
  readonly installHbaFile: typeof installHbaFile;
  readonly reloadAndReadRules: typeof reloadAndReadRules;
  readonly readRules: typeof readRules;
  /**
   * The password an interrupted run minted for ONE stack, or `null`. Keyed by stack, never by home alone: a run on another stack sharing the home
   * must never adopt, or later clear, the only copy of this stack's login password.
   */
  readonly readPending: (args: { home: string; projectId: string }) => string | null;
  /** Fsync a parked password already on disk, and the directories holding it, before a run applies it to the role. */
  readonly syncPending: (args: { home: string; projectId: string }) => Result<void, StoreLockError>;
  readonly writePending: (args: { home: string; projectId: string; password: string }) => Result<void, StoreLockError>;
  readonly clearPending: (args: { home: string; projectId: string }) => void;
  readonly writeStoreUrl: (args: { home: string; url: string }) => Result<void, StoreLockError>;
  readonly randomBytes: (args: { size: number }) => Uint8Array;
  /** The pre-lock backup gate — taken before the role is first created (`./backupGate.ts`). */
  readonly takeBackup: (args: {
    home: string;
    currentUrl: string;
    projectId: string;
  }) => Promise<Result<LockBackupOutcome, StoreLockError>>;
  readonly progress: (args: { line: string }) => void;
}

/** What the lock asks for. */
export interface LockRequest {
  readonly home: string;
  readonly stack: StackIdentity;
  readonly selection: FoundSelection;
  /** Give this home a new password even though the role exists — any other home's URL stops working. */
  readonly rotate: boolean;
}

/** What one lock run did. */
export interface LockReport {
  readonly projectId: string;
  readonly database: string;
  readonly gateway: string;
  readonly password: PasswordPlan["kind"];
  /** The pre-lock backup, or `null` when this run created no role and so needed none. */
  readonly backup: LockBackupOutcome | null;
  readonly storeUrlWritten: boolean;
  readonly hbaRewritten: boolean;
  /** Sessions from the Mac that were not the login, ended once the rule was in force. */
  readonly evicted: number;
  /** One line per behavioural proof that passed. */
  readonly proofs: readonly string[];
}

/** What `store verify` reads off the lock, without changing anything (`./measure.ts`). */
export interface LockMeasurement {
  /** One sentence per way the lock is not in force — empty when it is. */
  readonly findings: readonly string[];
  /** One sentence per check that held. */
  readonly held: readonly string[];
}

/**
 * Why the database container's published ports are not this stack's, or `null` when they are.
 *
 * @param ports the ports the container publishes
 * @param dbPort the port the config names
 * @returns a sentence naming the mismatch, or `null`
 */
function portsProblem({
  ports,
  projectId,
  dbPort,
}: {
  ports: readonly PublishedPort[];
  projectId: string;
  dbPort: number;
}): string | null {
  if (ports.length === 0) {
    return `the ${projectId} database container publishes no port`;
  }
  if (ports.some(({ port }) => port !== dbPort)) {
    const numbers = ports.map(({ port }) => String(port)).join(", ");
    return `the ${projectId} database container publishes ${numbers}, the config names ${String(dbPort)}`;
  }
  return null;
}

/**
 * Lock the stack.
 *
 * @param request the home, the stack, the selection and whether to rotate
 * @param deps the effects
 * @returns what it did, or the first step that refused
 */
export async function reconcileLock({
  request,
  deps,
}: {
  request: LockRequest;
  deps: LockDeps;
}): Promise<Result<LockReport, StoreLockError>> {
  const start = lockStart({ selection: request.selection, stack: request.stack });
  if (start.isErr()) {
    return err(start.error);
  }
  const { projectId, dbPort } = request.stack;
  const ports = deps.publishedPorts({ projectId });
  if (ports.isErr()) {
    return err(ports.error);
  }
  const notThisStack = portsProblem({ dbPort, ports: ports.value, projectId });
  if (notThisStack !== null) {
    return err(StoreLockErrors.notLocalStack({ detail: notThisStack }));
  }
  // Before the gateway read, the stack lock and every write: a port another machine can reach means a login can
  // arrive from an address the rule never names (Docker Desktop's default binding: 192.168.65.1, not the gateway).
  const exposures = exposuresOf({ ports: ports.value });
  if (exposures.length > 0) {
    return err(StoreLockErrors.portExposed({ exposures }));
  }
  const gateway = deps.stackGateway({ projectId });
  if (gateway.isErr()) {
    return err(gateway.error);
  }
  const held = deps.holdStackLock({ projectId });
  if (held.isErr()) {
    return err(held.error);
  }
  try {
    return await lockedRun({ deps, gateway: gateway.value, request, start: start.value });
  } finally {
    held.value.release();
  }
}

/**
 * Everything between taking the stack lock and releasing it.
 *
 * @param request what was asked
 * @param start the database and current URL
 * @param gateway the address Mac logins arrive from
 * @param deps the effects
 * @returns the report, or the first refusal
 */
async function lockedRun({
  request,
  start,
  gateway,
  deps,
}: {
  request: LockRequest;
  start: LockStart;
  gateway: string;
  deps: LockDeps;
}): Promise<Result<LockReport, StoreLockError>> {
  const { projectId, dbPort } = request.stack;
  const socketStart = deps.postmasterStartOverSocket({ projectId });
  if (socketStart.isErr()) {
    return err(socketStart.error);
  }
  const settled = await settlePassword({ deps, request, socketStart: socketStart.value, start });
  if (settled.isErr()) {
    return err(settled.error);
  }
  const { plan, backup, superseded } = settled.value;
  const login = await writeProvenLogin({
    deps,
    request,
    settled: settled.value,
    socketStart: socketStart.value,
    start,
  });
  if (login.isErr()) {
    return err(login.error);
  }
  const doors = await closeDoors({ database: start.database, deps, gateway, port: dbPort, projectId, superseded });
  if (doors.isErr()) {
    return err(doors.error);
  }
  return ok({
    backup,
    database: start.database,
    evicted: doors.value.evicted,
    gateway,
    hbaRewritten: doors.value.hbaRewritten,
    password: plan.kind,
    projectId,
    proofs: [login.value.proof, ...doors.value.proofs],
    storeUrlWritten: login.value.storeUrlWritten,
  });
}

/**
 * Prove the settled password logs in as the lock's login on this stack's server, write it to `secrets/store-url`
 * when it changed or may not be durable, and then clear the parked copy unless a different one must stay.
 *
 * @param settled the password, whether it may have replaced the role's earlier one, and whether the parked copy stays
 * @param socketStart the server start time read over the socket, which the login must match
 * @returns the proof line and whether store-url was written, or the step that refused
 */
async function writeProvenLogin({
  deps,
  request,
  settled,
  socketStart,
  start,
}: {
  deps: LockDeps;
  request: LockRequest;
  settled: { readonly password: string; readonly superseded: boolean; readonly keepParked: boolean };
  socketStart: string;
  start: LockStart;
}): Promise<Result<{ proof: string; storeUrlWritten: boolean }, StoreLockError>> {
  const { home, stack } = request;
  const url = loginUrl({ database: start.database, password: settled.password, port: stack.dbPort });
  if (url.isErr()) {
    return err(url.error);
  }
  const proven = loginProblem({ attempt: await deps.tryLogin({ url: url.value }), postmasterStart: socketStart });
  if (proven !== null) {
    return err(StoreLockErrors.proofFailed({ detail: proven, proof: "the new store URL" }));
  }
  // A parked password means an earlier run may have died between renaming store-url into place and syncing its
  // directory, so the visible URL is not yet durable: write it again before the pending copy goes.
  const storeUrlWritten = url.value !== start.currentUrl || settled.superseded;
  if (storeUrlWritten) {
    const written = deps.writeStoreUrl({ home, url: url.value });
    if (written.isErr()) {
      return err(written.error);
    }
  }
  if (settled.keepParked) {
    deps.progress({ line: "store lock: a parked password that does not log in is left in place" });
  } else {
    deps.clearPending({ home, projectId: stack.projectId });
  }
  return ok({
    proof: `the new store URL logs in as ${LOCK_LOGIN_ROLE}, runs as postgres, on this stack's server`,
    storeUrlWritten,
  });
}

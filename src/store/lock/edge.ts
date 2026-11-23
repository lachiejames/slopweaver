/**
 * The store lock's Docker effects: the Docker network's gateway, SQL over the database container's own socket, the
 * container's `pg_hba.conf`, and the stack-wide run lock. A thin edge over `docker`; the judgements live in the pure
 * modules beside it (`./edgeParse.ts` reads what this prints), and logins from the Mac are `./macLogin.ts`'s.
 *
 * **Why SQL goes over the socket as `supabase_admin`.** The image's `pg_hba.conf` trusts `supabase_admin` on the
 * container's Unix socket (`local all supabase_admin trust`), and `docker exec` is the only way
 * to reach that socket. So the lock needs no password to change the server — the rule it installs closes TCP
 * from the Mac and leaves the socket alone, which is also how it repairs itself after a recreate. Every
 * statement travels on psql's STDIN, never its argv, so nothing it carries appears in a process list.
 *
 * **Why the run lock is the USER's, not the home's.** The role, the rule file and the server are one per STACK, and
 * a stack is one per Docker daemon, not one per home — so two homes reconciling the same stack must exclude each
 * other. The lock is `../../admit/operationLock.ts`'s, made in this user's machine-wide runtime directory
 * (`../../stateRuntime.ts` `userRuntimeLockDir`) and never stale while its holder lives: a crashed run frees it the
 * moment its pid is gone. It is not a Postgres advisory lock: holding one needs a long-lived ASYNC psql child, which
 * rule 2's `no-headless` gate refuses tree-wide.
 */
import { spawnSync } from "node:child_process";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import { acquireOperationLock, type OperationLockResult } from "../../admit/operationLock.js";
import { userRuntimeLockDir } from "../../stateRuntime.js";

import type { PublishedPort } from "../dockerPublication.js";
import {
  gatewayFromInspect,
  HBA_RULES_QUERY,
  POSTMASTER_START_SQL,
  parseLoadedRules,
  parsePublishedPorts,
} from "./edgeParse.js";
import { type StoreLockError, StoreLockErrors } from "./errors.js";
import type { LoadedHbaRule } from "./hba.js";

/**
 * Milliseconds one `docker` call may take. Every call here is a `network inspect`, a `port`, a `cat`, a file
 * install or one psql script over the socket — each seconds on a live stack — so a minute is far past the slowest
 * legitimate run, and a call still going then is a daemon that stopped answering, not work in progress.
 */
const DOCKER_TIMEOUT_MS = 60_000;

/**
 * The database container of a stack.
 *
 * @param projectId the stack's `project_id`
 * @returns `supabase_db_<project>`
 */
function dbContainer({ projectId }: { projectId: string }): string {
  return `supabase_db_${projectId}`;
}

/**
 * The Docker network every container of a stack shares.
 *
 * @param projectId the stack's `project_id`
 * @returns `supabase_network_<project>`
 */
function stackNetwork({ projectId }: { projectId: string }): string {
  return `supabase_network_${projectId}`;
}

/**
 * Run `docker` with optional stdin and report a failure as a lock error. Never echoes the stdin.
 *
 * @param args docker's argv
 * @param step how a failure names this step
 * @param input text for stdin
 * @returns stdout, or the step with docker's stderr — or that it did not finish within {@link DOCKER_TIMEOUT_MS}
 */
function docker({
  args,
  step,
  input,
}: {
  args: readonly string[];
  step: string;
  input?: string;
}): Result<string, StoreLockError> {
  const result = spawnSync("docker", [...args], {
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: DOCKER_TIMEOUT_MS,
    ...(input === undefined ? {} : { input }),
  });
  if (result.error !== undefined) {
    const timedOut = "code" in result.error && result.error.code === "ETIMEDOUT";
    const detail = timedOut
      ? `docker did not finish within ${String(DOCKER_TIMEOUT_MS / 1000)}s`
      : result.error.message;
    return err(StoreLockErrors.stepFailed({ detail, step }));
  }
  if (result.status !== 0) {
    return err(StoreLockErrors.stepFailed({ detail: String(result.stderr).trim(), step }));
  }
  return ok(String(result.stdout));
}

/**
 * The one IPv4 gateway of the stack's Docker network — the address every Mac login arrives from.
 *
 * @param projectId the stack's `project_id`
 * @returns the gateway, or why it could not be read as exactly one IPv4 address
 */
export function stackGateway({ projectId }: { projectId: string }): Result<string, StoreLockError> {
  const network = stackNetwork({ projectId });
  const read = docker({
    args: ["network", "inspect", network, "--format", "{{json .}}"],
    step: `docker network inspect ${network}`,
  });
  if (read.isErr()) {
    return err(StoreLockErrors.gatewayUnresolved({ detail: read.error.message, network }));
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: `docker network inspect ${network}`, text: read.value });
  } catch (cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return err(StoreLockErrors.gatewayUnresolved({ detail: why, network }));
  }
  return gatewayFromInspect({ network, value });
}

/**
 * The host addresses and ports the database container publishes 5432 on.
 *
 * @param projectId the stack's `project_id`
 * @returns every publication — one per address family, normally the same port
 */
export function publishedPorts({ projectId }: { projectId: string }): Result<readonly PublishedPort[], StoreLockError> {
  const container = dbContainer({ projectId });
  return docker({ args: ["port", container, "5432/tcp"], step: `docker port ${container}` }).map((output) =>
    parsePublishedPorts({ output }),
  );
}

/**
 * Run a psql script as `supabase_admin` over the database container's socket.
 *
 * @param projectId the stack's `project_id`
 * @param database the database to connect to
 * @param script the statements
 * @param step how a failure names this step — never the script, which may carry a verifier
 * @returns psql's unaligned, tuples-only stdout
 */
export function adminSql({
  projectId,
  database,
  script,
  step,
}: {
  projectId: string;
  database: string;
  script: string;
  step: string;
}): Result<string, StoreLockError> {
  return docker({
    args: [
      "exec",
      "-i",
      dbContainer({ projectId }),
      "psql",
      "-U",
      "supabase_admin",
      "-d",
      database,
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      "-",
    ],
    input: script,
    step,
  });
}

/**
 * One integer read over the socket.
 *
 * @param projectId the stack's `project_id`
 * @param database the database to read
 * @param query a query printing one non-negative integer
 * @param step how a failure names this step
 * @returns the integer
 */
export function adminCount({
  projectId,
  database,
  query,
  step,
}: {
  projectId: string;
  database: string;
  query: string;
  step: string;
}): Result<number, StoreLockError> {
  const read = adminSql({ database, projectId, script: `${query};\n`, step });
  if (read.isErr()) {
    return err(read.error);
  }
  const count = Number(read.value.trim());
  if (!Number.isInteger(count) || count < 0) {
    return err(StoreLockErrors.stepFailed({ detail: `psql printed ${read.value.trim()}`, step }));
  }
  return ok(count);
}

/**
 * When the server's postmaster started, read over the socket — compared with the same value read through the
 * selected URL, so the lock proves the URL reaches THIS container's server and not another on the same Mac.
 *
 * @param projectId the stack's `project_id`
 * @returns the start instant in epoch seconds
 */
export function postmasterStartOverSocket({ projectId }: { projectId: string }): Result<string, StoreLockError> {
  return adminSql({
    database: "postgres",
    projectId,
    script: `select ${POSTMASTER_START_SQL};\n`,
    step: "reading the server's start time",
  }).map((out) => out.trim());
}

/**
 * The path and text of the `pg_hba.conf` the server was started with.
 *
 * @param projectId the stack's `project_id`
 * @returns both
 */
export function readHbaFile({
  projectId,
}: {
  projectId: string;
}): Result<{ path: string; text: string }, StoreLockError> {
  const path = adminSql({ database: "postgres", projectId, script: "show hba_file;\n", step: "reading hba_file" });
  if (path.isErr()) {
    return err(path.error);
  }
  const hbaPath = path.value.trim();
  if (!hbaPath.startsWith("/")) {
    return err(StoreLockErrors.hbaUnplaceable({ detail: `the server names hba_file ${hbaPath}` }));
  }
  return docker({ args: ["exec", dbContainer({ projectId }), "cat", hbaPath], step: `reading ${hbaPath}` }).map(
    (text) => ({
      path: hbaPath,
      text,
    }),
  );
}

/**
 * Replace the container's `pg_hba.conf` atomically as the file's own owner, keeping its mode: write a sibling,
 * copy the mode, rename over. A failure part-way leaves the old file in place.
 *
 * @param projectId the stack's `project_id`
 * @param path the file the server reads
 * @param text the whole new file
 * @returns nothing once it is in place
 */
export function installHbaFile({
  projectId,
  path,
  text,
}: {
  projectId: string;
  path: string;
  text: string;
}): Result<void, StoreLockError> {
  return docker({
    args: [
      "exec",
      "-i",
      "-u",
      "postgres",
      dbContainer({ projectId }),
      "sh",
      "-c",
      'set -e; mode=$(stat -c %a "$1"); cat > "$1.slopweaver-new"; chmod "$mode" "$1.slopweaver-new"; mv "$1.slopweaver-new" "$1"',
      "install-hba",
      path,
    ],
    input: text.endsWith("\n") ? text : `${text}\n`,
    step: `installing ${path}`,
  }).map(() => undefined);
}

/**
 * Signal a reload, then read the rules as Postgres parses the file now. The view parses the FILE at query time;
 * the login proofs are what prove the running server enforces it.
 *
 * @param projectId the stack's `project_id`
 * @returns the parsed rules in file order
 */
export function reloadAndReadRules({
  projectId,
}: {
  projectId: string;
}): Result<readonly LoadedHbaRule[], StoreLockError> {
  const reloaded = adminSql({
    database: "postgres",
    projectId,
    script: "select pg_reload_conf();\n",
    step: "pg_reload_conf()",
  });
  if (reloaded.isErr()) {
    return err(reloaded.error);
  }
  return readRules({ projectId });
}

/**
 * The rules as Postgres parses the file now, with no reload.
 *
 * @param projectId the stack's `project_id`
 * @returns the parsed rules in file order
 */
export function readRules({ projectId }: { projectId: string }): Result<readonly LoadedHbaRule[], StoreLockError> {
  const read = adminSql({
    database: "postgres",
    projectId,
    script: HBA_RULES_QUERY,
    step: "reading pg_hba_file_rules",
  });
  if (read.isErr()) {
    return err(read.error);
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: "pg_hba_file_rules", text: read.value.trim() });
  } catch (cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return err(StoreLockErrors.stepFailed({ detail: why, step: "reading pg_hba_file_rules" }));
  }
  return parseLoadedRules({ value });
}

/** A held run lock — release it once, at the end of the run. */
export interface StackLock {
  readonly release: () => void;
}

/**
 * Take the run lock: the user's own never-stale operation lock, held until released or until this process dies. It
 * is ONE key for every stack, not one per stack: two stacks' runs sharing a home share its `store-lock/pending-login`
 * and `secrets/store-url`, so one run could clear the other's parked password. Runs are
 * rare and short, so serialising them all costs nothing.
 *
 * @param projectId the stack's `project_id`, named in the refusal
 * @returns the held lock, or a refusal when another live run holds it or the lock directory is unusable
 */
export function holdStackLock({ projectId }: { projectId: string }): Result<StackLock, StoreLockError> {
  const step = `taking the store lock's run lock for ${projectId}`;
  const directory = userRuntimeLockDir();
  if (directory.isErr()) {
    return err(StoreLockErrors.stepFailed({ detail: directory.error.message, step }));
  }
  let held: OperationLockResult;
  try {
    held = acquireOperationLock({
      directory: directory.value,
      // `home` only feeds the default directory, which `directory` replaces: the lock is the user's, not a home's.
      home: directory.value,
      key: "store-lock",
      nowIso: new Date().toISOString(),
      staleAfterMs: Number.POSITIVE_INFINITY,
    });
  } catch (cause: unknown) {
    return err(StoreLockErrors.stepFailed({ detail: cause instanceof Error ? cause.message : String(cause), step }));
  }
  if (held.isErr()) {
    return err(
      StoreLockErrors.stepFailed({
        detail: `another \`store lock\` run is in progress — let it finish, then run again (${held.error})`,
        step,
      }),
    );
  }
  return ok({ release: held.value.release });
}

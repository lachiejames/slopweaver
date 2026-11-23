/**
 * The PURE half of "which stack, which database, and is it already locked": the stack's identity out of a
 * checkout's `supabase/config.toml`, and what the lock will do given the store selection it finds.
 *
 * The lock only ever acts on the stack the config names. A selection reaching another host, another port, or
 * arriving from `SLOPWEAVER_STORE_URL` is refused rather than guessed at: the lock writes `secrets/store-url`,
 * and an exported variable would go on overriding the file it just wrote.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type StoreLockError, StoreLockErrors } from "./errors.js";
import { namesLoginRole } from "./login.js";

/** Supabase's own credentials for a freshly started local stack — the door the lock closes. Not a secret. */
export const DEFAULT_STACK_CREDENTIALS = "postgres:postgres";

/** The database a fresh stack's store lives in when nothing is selected yet. */
const DEFAULT_STACK_DATABASE = "postgres";

/** The hosts a selection may name and still be this Mac's stack. */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** A stack as its config names it. */
export interface StackIdentity {
  /** `project_id` — every container and the network are named after it. */
  readonly projectId: string;
  /** `[db] port` — the host port the database is published on. */
  readonly dbPort: number;
}

/**
 * The stack's identity out of `supabase/config.toml`.
 *
 * @param configToml the file's text
 * @returns its project id and database port, or why either is missing
 */
export function stackIdentity({ configToml }: { configToml: string }): Result<StackIdentity, StoreLockError> {
  const lines = configToml.split("\n").map((line) => line.trim());
  const firstSection = lines.findIndex((line) => line.startsWith("["));
  const topLevel = lines.slice(0, firstSection === -1 ? lines.length : firstSection);
  const project = topLevel
    .map((line) => /^project_id\s*=\s*"([a-z0-9_-]+)"$/.exec(line))
    .find((match): match is RegExpExecArray => match !== null);
  if (project === undefined) {
    return err(StoreLockErrors.notLocalStack({ detail: "supabase/config.toml names no project_id" }));
  }
  const start = lines.indexOf("[db]");
  if (start === -1) {
    return err(StoreLockErrors.notLocalStack({ detail: "supabase/config.toml has no [db] section" }));
  }
  const next = lines.findIndex((line, index) => index > start && line.startsWith("["));
  const port = lines
    .slice(start + 1, next === -1 ? lines.length : next)
    .map((line) => /^port\s*=\s*(\d+)$/.exec(line))
    .find((match): match is RegExpExecArray => match !== null);
  if (port === undefined) {
    return err(StoreLockErrors.notLocalStack({ detail: "supabase/config.toml's [db] section names no port" }));
  }
  return ok({ dbPort: Number(port[1]), projectId: project[1]! });
}

/** The selection the lock found, as `storeUrlSelection` reports it — or none. */
export type FoundSelection = { readonly origin: "environment" | "secret"; readonly url: string } | null;

/** What the lock is working from. */
export interface LockStart {
  /** The database the store lives in, which the login URL will name. */
  readonly database: string;
  /** The URL that reaches the store now — the selection, or the stack's default when there is none. */
  readonly currentUrl: string;
  /** Whether the selection already logs in as the lock's role, so nothing is rotated unless it fails to log in. */
  readonly selectionIsLogin: boolean;
}

/**
 * Whether a connection string reaches THIS stack: a loopback host on the stack's published port. `store verify` uses
 * it so an exported `SLOPWEAVER_STORE_URL` aimed at the local stack is a finding rather than "not measured" — that
 * selection bypasses the lock's login for every verb, so passing verify over it would be green on an open door.
 *
 * @param url the selected connection string
 * @param stack the stack the config names
 * @returns true when the URL names this stack's loopback port
 */
export function reachesStack({ url, stack }: { url: string; stack: StackIdentity }): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return LOOPBACK.has(parsed.hostname) && Number(parsed.port) === stack.dbPort;
}

/**
 * What the lock works from, or why this selection is not one it may touch.
 *
 * @param selection the store selection, or `null` when none is set
 * @param stack the stack the config names
 * @returns the database, the current URL and whether it is already the lock's login
 */
export function lockStart({
  selection,
  stack,
}: {
  selection: FoundSelection;
  stack: StackIdentity;
}): Result<LockStart, StoreLockError> {
  if (selection === null) {
    return ok({
      currentUrl: `postgresql://${DEFAULT_STACK_CREDENTIALS}@127.0.0.1:${String(stack.dbPort)}/${DEFAULT_STACK_DATABASE}`,
      database: DEFAULT_STACK_DATABASE,
      selectionIsLogin: false,
    });
  }
  if (selection.origin === "environment") {
    return err(
      StoreLockErrors.notLocalStack({
        detail:
          "the store is selected by SLOPWEAVER_STORE_URL, which would go on overriding the secrets/store-url the lock writes — unset it so the file selects the store",
      }),
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(selection.url);
  } catch {
    return err(StoreLockErrors.notLocalStack({ detail: "secrets/store-url is not a connection string" }));
  }
  if (!LOOPBACK.has(parsed.hostname)) {
    return err(StoreLockErrors.notLocalStack({ detail: "secrets/store-url reaches another host" }));
  }
  if (Number(parsed.port) !== stack.dbPort) {
    return err(
      StoreLockErrors.notLocalStack({
        detail: `secrets/store-url names port ${parsed.port.length > 0 ? parsed.port : "(none)"}, the ${stack.projectId} stack is on ${String(stack.dbPort)}`,
      }),
    );
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (database.length === 0) {
    return err(StoreLockErrors.notLocalStack({ detail: "secrets/store-url names no database" }));
  }
  return ok({ currentUrl: selection.url, database, selectionIsLogin: namesLoginRole({ url: selection.url }) });
}

/** How the login's password is settled on this run. */
export type PasswordPlan =
  /** The selection already logs in as the role — keep it. */
  | { readonly kind: "keep" }
  /** A password a crashed earlier run left pending logs in — adopt it. */
  | { readonly kind: "adopt-pending" }
  /** The role does not exist yet — create it with a new password. */
  | { readonly kind: "create" }
  /** The role exists and nothing this home holds logs in as it, and the caller asked to rotate. */
  | { readonly kind: "rotate" };

/**
 * Settle how this run gets a working login, without ever silently replacing a password another home may hold.
 *
 * @param selectionLogsIn whether the selected URL logs in as the role right now
 * @param pendingLogsIn whether a pending password from an interrupted run logs in
 * @param roleExists whether the role is already in the cluster
 * @param rotate whether the caller passed `--rotate`
 * @returns the plan, or a refusal naming `--rotate` when the role exists and nothing here logs in as it
 */
export function passwordPlan({
  selectionLogsIn,
  pendingLogsIn,
  roleExists,
  rotate,
}: {
  selectionLogsIn: boolean;
  pendingLogsIn: boolean;
  roleExists: boolean;
  rotate: boolean;
}): Result<PasswordPlan, StoreLockError> {
  // A working pending password with no working selection is the ONLY copy of the role's current password, so it is
  // adopted even under `--rotate`: minting over it first deletes it, and a run killed then leaves a role nothing
  // logs in as. The adopting run converges, and a later `--rotate` rotates from there.
  if (pendingLogsIn && !selectionLogsIn) {
    return ok({ kind: "adopt-pending" });
  }
  if (rotate) {
    return ok({ kind: roleExists ? "rotate" : "create" });
  }
  if (selectionLogsIn) {
    return ok({ kind: "keep" });
  }
  if (!roleExists) {
    return ok({ kind: "create" });
  }
  return err(
    StoreLockErrors.proofFailed({
      detail:
        "the stack already has its login role, and nothing in this home logs in as it — another home on this Mac may hold its password. Pass --rotate to give this home a new one (any other home's store-url then stops working)",
      proof: "this home's login",
    }),
  );
}

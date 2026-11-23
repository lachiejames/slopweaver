/**
 * The PURE half of the verbs' one login: its password's shape, the SCRAM verifier the server is given in its
 * place, the statements that create or rotate the role, and the connection string the verbs read.
 *
 * ## Why a separate login role rather than a new `postgres` password
 *
 * Supabase Storage logs in as `postgres` with the CLI's default password on every start, from inside the Docker
 * network. MEASURED on a throwaway stack: after `alter role postgres password '<random>'`, a restart of
 * `supabase_storage_<project>` crash-looped on `password authentication failed for user "postgres"` until the
 * default came back. So `postgres` keeps its password and the Mac is refused it by the login rule (`./hba.ts`),
 * and the verbs log in as {@link LOCK_LOGIN_ROLE}, whose sessions run as `postgres` through a `SET role` default.
 * Measured the same day through that role: `select session_user, current_user` read
 * `slopweaver_login|postgres`, the role still bypassed row level security, `set role slopweaver_owner` worked, and
 * `slopweaver store push` built and verified the whole schema on an empty database.
 *
 * ## Why the server is handed a verifier, never the password
 *
 * `alter role … password '<SCRAM-SHA-256$…>'` stores a verifier the client computed, so the password itself never
 * reaches Postgres — not its statement log should one be switched on, not `pg_stat_activity`, not an error
 * message. The statements travel on psql's stdin, never its argv, so the verifier stays out of a process list too.
 */
import { createHash, createHmac, pbkdf2Sync } from "node:crypto";

import { err, ok, type Result } from "#lib/result.js";

import { type StoreLockError, StoreLockErrors } from "./errors.js";
import { LOCK_LOGIN_ROLE } from "./hba.js";

/** Bytes of randomness in a generated password — 256 bits, base64url-encoded to 43 characters. */
export const PASSWORD_BYTES = 32;

/** PBKDF2 iterations in the verifier — the server's own default (`scram_iterations`, measured 4096 on the stack). */
export const SCRAM_ITERATIONS = 4096;

/**
 * The comment a role carries once a lock run has taken its verified backup — written in the same transaction that
 * creates the role, or straight after the backup for a role the lock found unmarked. A role without it (one made by
 * hand, say) proves no backup ever ran, so every run takes the backup before changing anything (`--rotate` over a hand-made role changed its password with no backup taken).
 */
export const LOCK_ROLE_MARKER = "slopweaver store lock: a verified backup was taken before this role was trusted";

/**
 * The statement that marks the login role as backed up.
 *
 * @returns the SQL, for psql's stdin as `supabase_admin`
 */
export function markRoleStatement(): string {
  return `comment on role ${LOCK_LOGIN_ROLE} is '${LOCK_ROLE_MARKER}';`;
}

/**
 * The count query that says whether the login role carries {@link LOCK_ROLE_MARKER}.
 *
 * @returns the SQL, answering 1 when marked and 0 when not (or when the role is absent)
 */
export function roleMarkedQuery(): string {
  return `select count(*) from pg_roles r join pg_shdescription d on d.objoid = r.oid and d.classoid = 'pg_authid'::regclass where r.rolname = '${LOCK_LOGIN_ROLE}' and d.description = '${LOCK_ROLE_MARKER}'`;
}

/** A generated password: base64url, so it needs no escaping in a SQL literal or a URL. */
const PASSWORD_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Whether a string has the shape {@link passwordFrom} mints — 43 base64url characters, nothing to escape.
 *
 * @param password the candidate, e.g. a parked pending password read back from disk
 * @returns true for a generated-shape password
 */
export function isGeneratedPassword({ password }: { password: string }): boolean {
  return PASSWORD_SHAPE.test(password);
}

/**
 * A password from random bytes.
 *
 * @param random {@link PASSWORD_BYTES} bytes from a CSPRNG — passed in so this stays pure
 * @returns the base64url password, or a refusal when the bytes are the wrong length
 */
export function passwordFrom({ random }: { random: Uint8Array }): Result<string, StoreLockError> {
  if (random.length !== PASSWORD_BYTES) {
    return err(
      StoreLockErrors.stepFailed({
        detail: `expected ${String(PASSWORD_BYTES)} random bytes, got ${String(random.length)}`,
        step: "generating the login's password",
      }),
    );
  }
  return ok(Buffer.from(random).toString("base64url"));
}

/**
 * The SCRAM-SHA-256 verifier Postgres stores for a password (RFC 5802, as `pg_authid.rolpassword` spells it).
 *
 * @param salt sixteen random bytes
 * @returns `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>`, each part base64
 */
export function scramVerifier({ password, salt }: { password: string; salt: Uint8Array }): string {
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  const b64 = ({ bytes }: { bytes: Uint8Array }): string => Buffer.from(bytes).toString("base64");
  return `SCRAM-SHA-256$${String(SCRAM_ITERATIONS)}:${b64({ bytes: salt })}$${b64({ bytes: storedKey })}:${b64({ bytes: serverKey })}`;
}

/**
 * The statements that create or rotate the login role, set its verifier, and make every session it opens run as
 * `postgres`. A `create` FAILS when the role already exists and a `rotate` fails when it does not, so neither
 * can silently replace a password some other home holds — the plan that picked the mode read the cluster first
 * (`./localStack.ts` `passwordPlan`), and the run holds the stack lock in between.
 *
 * @param verifier the SCRAM verifier from {@link scramVerifier}
 * @param mode whether the role is being created or its password rotated
 * @returns the script, for psql's stdin as `supabase_admin` — or a refusal for a verifier that could break out of
 *   its literal
 */
export function loginRoleScript({
  verifier,
  mode,
}: {
  verifier: string;
  mode: "create" | "rotate";
}): Result<string, StoreLockError> {
  if (!/^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(verifier)) {
    return err(
      StoreLockErrors.stepFailed({
        detail: "the verifier is not a SCRAM-SHA-256 string",
        step: "building the login role",
      }),
    );
  }
  const guard =
    mode === "create"
      ? `create role ${LOCK_LOGIN_ROLE} login;\n${markRoleStatement()}`
      : `do $$ begin if not exists (select from pg_roles where rolname = '${LOCK_LOGIN_ROLE}') then raise exception 'the role ${LOCK_LOGIN_ROLE} is not there to rotate'; end if; end $$;`;
  return ok(
    [
      "\\set ON_ERROR_STOP on",
      "begin;",
      // The commit is flushed before psql answers, whatever a role or the server sets: the run writes store-url
      // straight after, and an asynchronous commit lost to a power cut would leave both files ahead of the role
      // The setting in force AT COMMIT governs, so a transaction-local one is enough.
      "set local synchronous_commit = on;",
      guard,
      `alter role ${LOCK_LOGIN_ROLE} with login noinherit password '${verifier}';`,
      `grant postgres to ${LOCK_LOGIN_ROLE} with inherit false, set true;`,
      `alter role ${LOCK_LOGIN_ROLE} set role = 'postgres';`,
      "commit;",
      "",
    ].join("\n"),
  );
}

/**
 * The connection string the verbs read: the login role and its password at the local stack's own port.
 *
 * @param password a generated password — refused unless it has the generated shape, so nothing needs escaping
 * @param port the stack's `[db] port`
 * @param database the database the store lives in
 * @returns `postgresql://slopweaver_login:<password>@127.0.0.1:<port>/<database>`
 */
export function loginUrl({
  password,
  port,
  database,
}: {
  password: string;
  port: number;
  database: string;
}): Result<string, StoreLockError> {
  if (!PASSWORD_SHAPE.test(password)) {
    return err(
      StoreLockErrors.stepFailed({ detail: "the password is not a generated one", step: "building the store URL" }),
    );
  }
  return ok(`postgresql://${LOCK_LOGIN_ROLE}:${password}@127.0.0.1:${String(port)}/${encodeURIComponent(database)}`);
}

/**
 * Whether a connection string already logs in as the lock's role — the test a re-run uses to keep the password it
 * has rather than rotate it.
 *
 * @param url the selected store URL
 * @returns true when its user is {@link LOCK_LOGIN_ROLE}
 */
export function namesLoginRole({ url }: { url: string }): boolean {
  try {
    return decodeURIComponent(new URL(url).username) === LOCK_LOGIN_ROLE;
  } catch {
    return false;
  }
}

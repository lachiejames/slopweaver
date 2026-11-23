/**
 * The one impure edge of the real-Chrome lane: the owner's profile's cookie database, the OS keyring, and nothing
 * else. No browser is launched here, and no browser CAN be launched here — that is the point of the file.
 *
 * ## What it does, and the one thing it deliberately cannot do
 *
 * It reads. A pipeline whose endpoints want a signed-in cookie gets one out of the browser the owner is
 * already signed in to, so there is no login step, no second profile and no session to keep alive. A pipeline
 * that needs a RENDERED PAGE gets nothing from here: it is carried out in the owner's real Chrome instead
 * (`docs/browser-route.md`), either as a brief the visible session walks and the verb judges
 * (`docs/browser-route/proof-and-capture-verbs.md` § "Two mechanisms") or over Playwright's extension relay
 * (`docs/browser-route/target-proof-and-playwright.md`). Neither goes through `--remote-debugging-port`,
 * which is unproven on the owner's default profile (`docs/browser-route/proof-and-capture-verbs.md`).
 *
 * ## The copy, and why it is not paranoia
 *
 * Chrome holds the cookie database open with SQLite's WAL journal. Reading it in place while Chrome is
 * running returns rows without the un-checkpointed tail, which shows up as a session cookie that is
 * present in the browser and absent here. The file is copied — with its `-wal` sidecar when there is one —
 * into a `0700` temporary directory, read, and removed in a `finally`.
 *
 * ## What never happens to a value
 *
 * A cookie value is returned to the caller and nothing else. It is never logged, never printed, never
 * written to `$SLOPWEAVER_HOME`, and never included in an error — the errors in `./errors.ts` carry paths,
 * origins and platform names only. The retired lane's `github-web-session.json` is gone with the rest of
 * it: there is no saved credential to leak, because the jar is re-read per call.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { importSqliteQuietly } from "../lib/sqlite.js";
import { decryptCookieValue, deriveCookieKey } from "./cookieCrypto.js";
import { cookieAppliesToHost, expiresFromChrome, hostOfOrigin, type JarCookie } from "./cookieScope.js";
import { type RealChromeError, RealChromeErrors } from "./errors.js";
import { type ChromeProfile, parseChromeProfiles, resolveRecordedProfile } from "./profileIndex.js";

/** The keyring account Chrome stores its cookie key under, on every desktop platform. */
const KEYRING_SERVICE = "Chrome Safe Storage";

/**
 * Chrome's user-data root per platform.
 *
 * @param platform `process.platform`
 * @returns the directory Chrome keeps `Local State` and every profile in, or `undefined` when unsupported
 * @internal
 */
export function chromeUserDataRoot({ platform }: { platform: string }): string | undefined {
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Google", "Chrome");
  }
  if (platform === "linux") {
    return join(homedir(), ".config", "google-chrome");
  }
  return undefined;
}

/**
 * List the profiles Chrome knows about.
 *
 * @param platform `process.platform`
 * @returns every profile in Chrome's own index, or why the index could not be read
 */
export function listChromeProfiles({
  platform,
}: {
  platform: string;
}): Result<readonly ChromeProfile[], RealChromeError> {
  const root = chromeUserDataRoot({ platform });
  if (root === undefined) {
    return err(RealChromeErrors.unsupportedPlatform({ platform }));
  }
  const path = join(root, "Local State");
  if (!existsSync(path)) {
    return err(RealChromeErrors.userDataMissing({ path: root }));
  }
  let json: string;
  try {
    json = readFileSync(path, "utf8");
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(RealChromeErrors.localStateUnreadable({ detail, path }));
  }
  return parseChromeProfiles({ json, path });
}

/**
 * Read every cookie in the recorded profile that a browser would send to one origin.
 *
 * @param origin the origin being asked about, e.g. `https://github.com`
 * @param directory the recorded profile directory name
 * @param platform `process.platform`
 * @returns the applicable cookies, or why the jar could not be read
 */
export async function readOriginCookies({
  origin,
  directory,
  platform,
}: {
  origin: string;
  directory: string;
  platform: string;
}): Promise<Result<readonly JarCookie[], RealChromeError>> {
  const host = hostOfOrigin({ origin });
  if (host === undefined) {
    return err(RealChromeErrors.jarUnreadable({ detail: `${origin} is not an absolute origin` }));
  }
  const root = chromeUserDataRoot({ platform });
  if (root === undefined) {
    return err(RealChromeErrors.unsupportedPlatform({ platform }));
  }
  const profiles = listChromeProfiles({ platform });
  if (profiles.isErr()) {
    return err(profiles.error);
  }
  const resolved = resolveRecordedProfile({ directory, profiles: profiles.value });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  const key = cookieKey({ platform });
  if (key.isErr()) {
    return err(key.error);
  }
  return withJarCopy({
    jarPath: join(root, resolved.value.directory, "Cookies"),
    read: (db) => selectOriginRows({ db, host, key: key.value }),
  });
}

/**
 * How long the keyring read may wait before it is stopped. The read itself is instant; what it can wait on
 * is the keychain's own permission dialog, which macOS raises once per binary. Two minutes leaves a person
 * at the screen time to find the dialog and type a password, and ends a seat nobody is watching rather than
 * leaving it blocked on a window it cannot see — a synchronous child blocks the event loop, so this bound is
 * the only thing that can end one.
 *
 * @internal — exported so a unit test can assert the bound the timeout error names.
 */
export const KEYRING_READ_TIMEOUT_MS = 120_000;

/** Read the raw keyring password, throwing as `execFileSync` throws — the seam a test replaces. */
type ReadKeyringPassword = () => string;

/** The production {@link ReadKeyringPassword}: macOS's `security`, bounded. */
const readKeyringPassword: ReadKeyringPassword = () =>
  execFileSync("security", ["find-generic-password", "-s", KEYRING_SERVICE, "-w"], {
    encoding: "utf8",
    // SIGKILL, not the default SIGTERM: a child that traps TERM would outlive the bound.
    killSignal: "SIGKILL",
    timeout: KEYRING_READ_TIMEOUT_MS,
  });

/**
 * Fetch and derive Chrome's own cookie key from the OS keyring.
 *
 * `security find-generic-password` is the macOS door and prompts ONCE per binary, which is why the refusal
 * says so: a first run that looks like a hang is the keyring dialog waiting behind a window. A read still
 * waiting at {@link KEYRING_READ_TIMEOUT_MS} is killed and answers `KEY_READ_TIMED_OUT`, never a hang.
 *
 * @internal — exported so a unit test can hand it a keyring that never answers.
 * @param platform `process.platform`
 * @param readKeyring the keyring read; the bounded `security` call unless a test supplies a fake
 * @returns the derived AES key, or why the keyring would not answer
 */
export function cookieKey({
  platform,
  readKeyring = readKeyringPassword,
}: {
  platform: string;
  readKeyring?: ReadKeyringPassword;
}): Result<Buffer, RealChromeError> {
  if (platform !== "darwin") {
    return err(RealChromeErrors.unsupportedPlatform({ platform }));
  }
  let password: string;
  try {
    password = readKeyring().trim();
  } catch (cause: unknown) {
    // Node reports a child killed at its bound as `code: "ETIMEDOUT"` on the thrown error.
    if (isRecord(cause) && cause["code"] === "ETIMEDOUT") {
      return err(RealChromeErrors.keyReadTimedOut({ timeoutMs: KEYRING_READ_TIMEOUT_MS }));
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(RealChromeErrors.keyUnavailable({ detail }));
  }
  if (password.length === 0) {
    return err(RealChromeErrors.keyUnavailable({ detail: "the keyring returned an empty password" }));
  }
  return ok(deriveCookieKey({ password, platform }));
}

/**
 * Copy the jar (and its WAL sidecar) somewhere private, hand the open database to `read`, and remove the
 * copy whatever happens.
 *
 * @param jarPath the live `Cookies` database inside the profile
 * @param read what to do with the opened copy
 * @returns whatever `read` returned, or why the copy could not be made
 */
async function withJarCopy({
  jarPath,
  read,
}: {
  jarPath: string;
  read: (db: DatabaseSync) => Result<readonly JarCookie[], RealChromeError>;
}): Promise<Result<readonly JarCookie[], RealChromeError>> {
  if (!existsSync(jarPath)) {
    return err(RealChromeErrors.jarUnreadable({ detail: `no cookie database at ${jarPath}` }));
  }
  let staging: string;
  try {
    staging = mkdtempSync(join(tmpdir(), "slopweaver-jar-"));
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(RealChromeErrors.jarUnreadable({ detail }));
  }
  try {
    const copy = join(staging, "Cookies");
    copyFileSync(jarPath, copy);
    if (existsSync(`${jarPath}-wal`)) {
      copyFileSync(`${jarPath}-wal`, `${copy}-wal`);
    }
    const { DatabaseSync: Database } = await importSqliteQuietly();
    const db = new Database(copy, { readOnly: true });
    try {
      return read(db);
    } finally {
      db.close();
    }
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(RealChromeErrors.jarUnreadable({ detail }));
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
}

/**
 * Select the rows out of the opened copy and hand them to {@link cookiesFromRows}.
 *
 * The SQL and the BigInt flag are the whole of this function. The row-to-cookie DECISION is next door and
 * pure, and the split is what makes a jar read provable at all: the decision needs rows, and rows are the
 * one thing only the owner's own Chrome can supply.
 *
 * @param db the opened copy
 * @param host the hostname the rows must apply to
 * @param key the derived AES key
 * @returns the decrypted cookies, or the first row that would not decrypt
 */
function selectOriginRows({
  db,
  host,
  key,
}: {
  db: DatabaseSync;
  host: string;
  key: Buffer;
}): Result<readonly JarCookie[], RealChromeError> {
  // `expires_utc` is MICROseconds since 1601, which is past `Number.MAX_SAFE_INTEGER` for every live cookie
  // — node:sqlite refuses such a value outright rather than losing precision, so the whole read fails on the
  // first row. Reading integers as BigInt is what makes the column readable at all; `expiresFromChrome`
  // takes it from there. Reproduce the refusal by removing this line: `Value is too large to be represented
  // as a JavaScript number: 13459480961651281`.
  const statement = db.prepare(
    "select host_key, name, path, expires_utc, is_httponly, is_secure, encrypted_value from cookies",
  );
  statement.setReadBigInts(true);
  return cookiesFromRows({ host, key, rows: statement.all() });
}

/**
 * Turn the jar rows that apply to one host into cookies, decrypting each value.
 *
 * Two row shapes are DROPPED rather than refused, and neither is a defensive flourish — both are ordinary
 * contents of a real profile. A row filed under another host is not this origin's cookie, and a row whose
 * `encrypted_value` is not bytes is one Chrome wrote before it encrypted anything. A row that IS for this
 * host and will not DECRYPT is the opposite: it means the keyring password belongs to a different Chrome
 * install, so the whole read fails on it rather than quietly returning whichever cookies came first.
 *
 * A value is returned to the caller and nowhere else — never logged, never printed, and never carried into
 * an error. The errors here name a host, a path or a prefix.
 *
 * @param rows every row the jar returned, its integers read as BigInt
 * @param host the hostname the rows must apply to
 * @param key the derived AES key
 * @returns the decrypted cookies, or the first row that would not decrypt
 *
 * @internal
 */
export function cookiesFromRows({
  rows,
  host,
  key,
}: {
  rows: readonly Record<string, unknown>[];
  host: string;
  key: Buffer;
}): Result<readonly JarCookie[], RealChromeError> {
  const cookies: JarCookie[] = [];
  for (const row of rows) {
    const hostKey = String(row["host_key"]);
    if (!cookieAppliesToHost({ host, hostKey })) {
      continue;
    }
    const encrypted = row["encrypted_value"];
    if (!(encrypted instanceof Uint8Array)) {
      continue;
    }
    const value = decryptCookieValue({ encrypted: Buffer.from(encrypted), hostKey, key });
    if (value.isErr()) {
      return err(value.error);
    }
    cookies.push({
      domain: hostKey,
      expires: expiresFromChrome({ expiresUtc: row["expires_utc"] }),
      httpOnly: Number(row["is_httponly"]) === 1,
      name: String(row["name"]),
      path: String(row["path"]),
      secure: Number(row["is_secure"]) === 1,
      value: value.value,
    });
  }
  return ok(cookies);
}

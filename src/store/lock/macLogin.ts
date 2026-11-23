/**
 * The store lock's logins from the Mac: split a connection string the way the store's own client reads it, decide
 * whether its host is this machine, and try one login — or retry one until `pg_hba.conf` refuses it. A thin edge
 * over the `postgres` client and DNS; it never touches Docker, which `./edge.ts` owns.
 */
import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";
import { networkInterfaces } from "node:os";

import postgres from "postgres";

import { POSTMASTER_START_SQL } from "./edgeParse.js";

/** Seconds a Mac login attempt may take before it counts as failed. */
const LOGIN_TIMEOUT_SECONDS = 5;

/** Attempts given a reload to take effect before a refusal proof is judged. */
const RELOAD_SETTLE_ATTEMPTS = 10;

/** Milliseconds between two refusal attempts while a reload settles. */
const RELOAD_SETTLE_MS = 200;

/** What one Mac login attempt did. */
export type LoginAttempt =
  | {
      readonly kind: "accepted";
      readonly sessionUser: string;
      readonly currentUser: string;
      readonly postmasterStart: string;
    }
  | { readonly kind: "refused"; readonly byRule: boolean; readonly why: string }
  /** It logged in, but the server would not say who the session is or when it started. */
  | { readonly kind: "unidentified"; readonly why: string };

/** A login's connection fields, split out of its URL. */
export interface LoginOptions {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly database: string;
}

/**
 * Split a connection string into the fields the client takes. The client's own URL parser splits a host on
 * `:` to read a host list, so a bracketed IPv6 literal such as `[::1]` reaches DNS as `[`; passing the fields
 * with the brackets removed is what lets the lock try the IPv6 loopback door at all.
 *
 * @param url a `postgresql://` connection string
 * @returns the fields, or `null` when the string is not a URL with a host, a port and a database
 */
export function loginOptions({ url }: { url: string }): LoginOptions | null {
  if (!URL.canParse(url)) {
    return null;
  }
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^\[(.*)\]$/u, "$1");
  const port = Number(parsed.port);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  if (host.length === 0 || !Number.isInteger(port) || port <= 0 || database.length === 0) {
    return null;
  }
  return {
    database,
    host,
    password: decodeURIComponent(parsed.password),
    port,
    username: decodeURIComponent(parsed.username),
  };
}

/**
 * Whether an address is this Mac's own: loopback, or one of its interfaces' addresses.
 *
 * @param address an IPv4 or IPv6 literal
 * @param own every address this Mac's interfaces carry
 * @returns true when a connection to it lands on this machine
 */
export function isOwnAddress({ address, own }: { address: string; own: readonly string[] }): boolean {
  const bare = address.replace(/^::ffff:/iu, "");
  if (isIPv4(bare) && bare.startsWith("127.")) {
    return true;
  }
  if (isIPv6(bare) && (bare === "::1" || bare === "0:0:0:0:0:0:0:1")) {
    return true;
  }
  return own.includes(bare);
}

/**
 * Whether a store URL's host resolves to this Mac — so a port forward on it could lead anywhere this Mac reaches,
 * this checkout's stack included. A host that does not resolve reaches nothing and is not local.
 *
 * @param url the connection string
 * @returns true when any address its host resolves to is this Mac's own
 */
export async function hostIsLocal({ url }: { url: string }): Promise<boolean> {
  const hosts = connectionHosts({ url });
  if (hosts === null) {
    return false;
  }
  const own: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    if (addresses !== undefined) {
      own.push(...addresses.map((entry) => entry.address));
    }
  }
  for (const host of hosts) {
    // A host that is a path is a Unix socket, and a socket is always on this Mac.
    if (host.startsWith("/")) {
      return true;
    }
    try {
      const resolved = await lookup(host, { all: true });
      if (resolved.some((entry) => isOwnAddress({ address: entry.address, own }))) {
        return true;
      }
    } catch {
      // A host that does not resolve reaches nothing; the next one in the list may.
    }
  }
  return false;
}

/**
 * Whether a connection string's host is a bracketed IPv6 literal — the one shape the store's client cannot
 * connect to (its parser splits `[::1]` on `:` and asks DNS for `[`), so the one shape the lock splits itself.
 *
 * @param url the connection string
 * @returns true when the URL parses and its host is in brackets
 */
export function hasBracketedHost({ url }: { url: string }): boolean {
  return URL.canParse(url) && new URL(url).hostname.startsWith("[");
}

/**
 * Every host a connection string can connect to, read by postgres.js's own parser — the one every store client
 * hands the raw string to — so the lock can never call a URL elsewhere that the store's client would connect home
 * with, whatever the string's shape: a host LIST, a missing port, a percent-encoded path.
 * Only a bracketed IPv6 host, which that parser cannot read, is split here instead.
 *
 * @param url the connection string
 * @returns the hosts, in the order the client tries them, or `null` when the client could not parse it either
 */
export function connectionHosts({ url }: { url: string }): readonly string[] | null {
  if (hasBracketedHost({ url })) {
    const options = loginOptions({ url });
    return options === null ? null : [options.host];
  }
  const client = clientFromUrl({ url });
  if (client === null) {
    return null;
  }
  const hosts = [...client.options.host];
  void client.end({ timeout: 0 });
  return hosts;
}

/**
 * Build a one-connection client from the raw string exactly as the store's own clients do. postgres.js parses the
 * string synchronously and connects only on the first query, so a string it cannot parse is a throw here.
 *
 * @param url the connection string
 * @returns the client, not yet connected, or `null` when postgres.js could not parse the string
 */
function clientFromUrl({ url }: { url: string }): postgres.Sql | null {
  try {
    return postgres(url, { connect_timeout: LOGIN_TIMEOUT_SECONDS, max: 1, onnotice: () => {} });
  } catch {
    return null;
  }
}

/**
 * Try one login from the Mac and close it. The connection string is never part of what is returned.
 *
 * @param url the connection string to try
 * @returns who the session ran as and the server's start time; why it was refused — `byRule` when `pg_hba.conf`
 *   itself refused it; or, when it logged in but the identity probe failed, why the server could not be identified
 */
export async function tryLogin({ url }: { url: string }): Promise<LoginAttempt> {
  // The raw string goes to the client exactly as the store's clients pass it, so the probe and the store can never
  // disagree about where, as whom or into which database a URL connects. Only a bracketed IPv6 host, which that
  // client cannot connect to at all, is split into fields here.
  const options = hasBracketedHost({ url }) ? loginOptions({ url }) : null;
  const sql =
    options === null
      ? clientFromUrl({ url })
      : postgres({ ...options, connect_timeout: LOGIN_TIMEOUT_SECONDS, max: 1, onnotice: () => {} });
  if (sql === null) {
    return { byRule: false, kind: "refused", why: "the connection string did not parse" };
  }
  try {
    await sql`select 1`;
  } catch (cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    await sql.end({ timeout: 2 });
    return { byRule: why.includes("pg_hba.conf rejects connection"), kind: "refused", why };
  }
  // Logged in. A probe refused from here on is a server that would not identify itself — never a refused login,
  // which a caller would read as "this URL cannot reach the store".
  try {
    const rows = await sql<{ session_user: string; current_user: string; started: string }[]>`
      select session_user, current_user, ${sql.unsafe(POSTMASTER_START_SQL)} as started`;
    const [row] = rows;
    if (row === undefined) {
      return { kind: "unidentified", why: "the identity probe returned no row" };
    }
    return {
      currentUser: row.current_user,
      kind: "accepted",
      postmasterStart: row.started,
      sessionUser: row.session_user,
    };
  } catch (cause: unknown) {
    return { kind: "unidentified", why: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/**
 * Try a login until `pg_hba.conf` refuses it, for the moment a reload signal may take to land.
 *
 * @param url the connection string that must be refused
 * @returns the last attempt — accepted only if it was still accepted after every retry
 */
export async function loginUntilRefused({ url }: { url: string }): Promise<LoginAttempt> {
  let last = await tryLogin({ url });
  for (let attempt = 1; attempt < RELOAD_SETTLE_ATTEMPTS && !(last.kind === "refused" && last.byRule); attempt += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, RELOAD_SETTLE_MS);
    });
    last = await tryLogin({ url });
  }
  return last;
}

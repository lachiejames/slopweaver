/**
 * Whether a store connection string reaches a database on this machine — the check every store selection,
 * migration and recovery refuses through. Split from `./lifecycleCore.ts`, the pure half of the store's
 * lifecycle, which classifies a database once this check has admitted its URL.
 *
 * One reader here builds an UNCONNECTED postgres.js client: {@link isLocalStoreUrl} asks the store's own client
 * parser which hosts a string names, because that parser and the URL standard disagree on some strings.
 */
import { connectionHosts } from "./lock/macLogin.js";

/** The hosts a LOCAL database can be reached on. Nothing else is local, whatever a tunnel says. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/**
 * Whether a connection string reaches a database on this machine.
 *
 * The store works with a local database only, the owner's hard rule, and refuses every other host at the URL,
 * before anything connects. The URL standard's hostname must be loopback, and the string must give postgres.js
 * — the client each store connection hands the raw string to — no other reading: that client takes the host after
 * the FIRST `@` up to the first `/` or `?`, where the standard takes the LAST `@` and also stops at `#`, so
 * `postgresql://u:p@db.example.com,x@localhost/store` reads as `localhost` to one and connects to
 * `db.example.com` through the other. So a second `@` or a `#` in that span, a comma host list, and a `host` or
 * `hostaddr` parameter are refused outright, and every host the client parses must be loopback too. A string the
 * client cannot parse connects nowhere; a bracketed IPv6 host is the one it cannot read, so the span decides it.
 *
 * @param url a `postgresql://` connection string
 * @returns true only when every reading of the string names this machine
 */
export function isLocalStoreUrl({ url }: { url: string }): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const parsed = new URL(url);
  if (!LOOPBACK_HOSTS.has(parsed.hostname) || parsed.searchParams.has("host") || parsed.searchParams.has("hostaddr")) {
    return false;
  }
  // `split` always yields at least one element.
  const span = url.slice(url.indexOf("://") + 3).split(/[?/]/u)[0]!;
  const hostPart = span.slice(span.indexOf("@") + 1);
  if (span.includes("#") || span.split("@").length > 2 || hostPart.includes(",")) {
    return false;
  }
  if (parsed.hostname.startsWith("[")) {
    return true;
  }
  const hosts = connectionHosts({ url });
  return hosts === null || hosts.every((host) => isLocalHost({ host }));
}

/**
 * Whether one host, as the store's client reads it, is on this machine.
 *
 * @param host a hostname or address from a connection string's host list, or a Unix socket directory
 * @returns true for a loopback name or address, or a socket path
 */
export function isLocalHost({ host }: { host: string }): boolean {
  return LOOPBACK_HOSTS.has(host) || host.startsWith("/");
}

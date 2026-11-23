/**
 * Which of a jar's rows belong to one origin — pure, so the matching rule is testable without a browser,
 * a keyring or a database anywhere near it.
 *
 * Chrome files a cookie under a `host_key`, and the leading dot is load-bearing: `.github.com` is a DOMAIN
 * cookie that applies to `github.com` and every subdomain of it, while `github.com` applies to that host
 * alone. Treating the two the same in either direction is wrong in a way that shows up as an
 * intermittently-missing session cookie, so the distinction is the whole of this file.
 */

/** One decrypted row, in the shape a `storageState` document wants. */
export interface JarCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  /** Epoch SECONDS, or `-1` for a session cookie Chrome ends on its own schedule. */
  readonly expires: number;
  readonly httpOnly: boolean;
  readonly secure: boolean;
}

/**
 * Whether a jar row applies to a host.
 *
 * @param hostKey the row's own `host_key`, dot-prefixed for a domain cookie
 * @param host the hostname being asked about
 * @returns true when a browser would send that row to that host
 */
export function cookieAppliesToHost({ hostKey, host }: { hostKey: string; host: string }): boolean {
  const key = hostKey.toLowerCase();
  const target = host.toLowerCase();
  if (!key.startsWith(".")) {
    return key === target;
  }
  const bare = key.slice(1);
  return target === bare || target.endsWith(key);
}

/**
 * The hostname of an origin, or `undefined` when the value is not an absolute URL.
 *
 * @param origin the origin as a caller spells it, e.g. `https://github.com`
 * @returns the lowercased hostname
 */
export function hostOfOrigin({ origin }: { origin: string }): string | undefined {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host.length > 0 ? host : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Chrome's `expires_utc` is microseconds since 1601-01-01; `storageState` wants epoch seconds, and `-1` for
 * a session cookie. Chrome writes `0` for the latter.
 *
 * Not a `Date` anywhere in it, deliberately — `typescript-patterns.md` bans scaling an epoch into one
 * outside `lib/date.ts`, and this conversion's output is a number a JSON document carries, never an instant
 * this repo reasons about.
 */
const WINDOWS_EPOCH_OFFSET_SECONDS = 11644473600;

/** A row's `expires_utc` in whole microseconds: the bigint as read, else the value as a number, and zero for NaN. */
function chromeMicros({ expiresUtc }: { expiresUtc: unknown }): bigint {
  if (typeof expiresUtc === "bigint") {
    return expiresUtc;
  }
  const micros = Number(expiresUtc);
  if (Number.isNaN(micros)) {
    return 0n;
  }
  return BigInt(Math.trunc(micros));
}

/**
 * Convert one row's `expires_utc` to the epoch seconds a `storageState` cookie carries.
 *
 * Accepts a `bigint` because that is what the column actually holds: microseconds since 1601 is past
 * `Number.MAX_SAFE_INTEGER` for every live cookie, so `cookieJar.ts` reads the column as BigInt and the
 * division back down to seconds happens here, in one place, where it is testable. The parameter is
 * `unknown` rather than `bigint` because a SQLite column is what it is at runtime, and a wrong assumption
 * here silently mis-dates every cookie instead of failing.
 *
 * @param expiresUtc Chrome's own value, in microseconds since 1601-01-01, or `0` for a session cookie
 * @returns epoch seconds, or `-1` when Chrome owns the schedule
 */
export function expiresFromChrome({ expiresUtc }: { expiresUtc: unknown }): number {
  const micros = chromeMicros({ expiresUtc });
  if (micros <= 0n) {
    return -1;
  }
  return Number(micros / 1000000n) - WINDOWS_EPOCH_OFFSET_SECONDS;
}

/**
 * Render selected rows as the Playwright `storageState` document every HTTP client in this repo already
 * knows how to read.
 *
 * The shape is kept identical to what the retired `attach login` used to write, so the pipelines that
 * consume it needed no change when the browser under them went away.
 *
 * @param cookies the rows that apply to the origin
 * @returns the `storageState` JSON
 */
export function storageStateFromJar({ cookies }: { cookies: readonly JarCookie[] }): string {
  return JSON.stringify({
    cookies: cookies.map((cookie) => ({
      domain: cookie.domain,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      name: cookie.name,
      path: cookie.path,
      sameSite: "Lax",
      secure: cookie.secure,
      value: cookie.value,
    })),
    origins: [],
  });
}

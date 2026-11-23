/**
 * The always-loaded context read from its last-known-good copy alone — the half of `./load.ts` that opens no store.
 *
 * Its own module so a caller can reach the cache without reaching `../store/client.ts`, whose `postgres` and
 * `drizzle-orm` imports esbuild hoists to the top of any bundle that names the module at all, a dynamic `import()`
 * included (measured on esbuild 0.28.2 with the shipped `--bundle
 * --packages=external` shape). The PreToolUse dispatcher runs on every guarded tool call, so the profile-held check it
 * carries (`../admit/profileHeldRunner.ts`) reloads from here: the fleet's cost per call stays the marker's one `stat`.
 *
 * The cache is refreshed by every live read (`./load.ts`), so it is as fresh as the last session start or `profile
 * context` that reached the store, and its banner says how old it is.
 */
import { storeUrl } from "../store/config.js";

import {
  ALWAYS_LOADED_MARKER,
  buildAlwaysLoadedContext,
  contextHeaderLines,
  unavailableSection,
} from "./alwaysLoaded.js";
import { cacheAgeMinutes, readContextCache, storeFingerprint } from "./cache.js";

/** Where the lines a caller is holding actually came from, so nothing has to infer it from their shape. *
 * @internal
 */
export type ContextOrigin = "live" | "cache" | "none";

/** The rendered context and the honest account of how it was obtained. */
export interface LoadedContext {
  readonly lines: readonly string[];
  readonly origin: ContextOrigin;
  /** Why the live read did not happen, empty when it did. */
  readonly reason: string;
  /**
   * Set on a live read that found NO owner row: the store answered, and the owner has no profile in it yet. Such a read writes
   * no cache, and on a machine with no other trace of the owner's profile it is a first boot, not a load (`./load.ts`).
   */
  readonly ownerAbsent?: true;
  /**
   * The fingerprint of the store that answered with no owner row — set exactly when `ownerAbsent` is. A mark is
   * withdrawn for THIS store, never one read separately: the selection can change between two reads, and an empty read
   * of one store would then erase another's mark.
   */
  readonly ownerAbsentIn?: string;
}

/**
 * Whether a load carried no profile of the owner's: nothing loaded, or the store answered that none exists.
 *
 * @param loaded what the load produced
 * @returns true when there was no profile in it
 */
export function noProfileIn({ loaded }: { loaded: LoadedContext }): boolean {
  return loaded.origin === "none" || loaded.ownerAbsent === true;
}

/** The heading the owner's own facts print under. Named once so the hook and the verb cannot drift apart. */
export const OWNER_TITLE = "About the owner";

/**
 * Whether these context lines print the owner section `unavailable` rather than the owner's profile. A cache written by a
 * checkout without `ownerReadFailure` (`./load.ts`) can hold exactly that block, since every checkout shares one cache
 * file, and serving it as `origin: cache` would record a load for a session whose context holds no profile.
 *
 * @param lines a rendered context, cached or live
 * @returns true when the owner heading is followed by its unavailable line
 */
export function ownerUnavailableIn({ lines }: { lines: readonly string[] }): boolean {
  const heading = lines.indexOf(`## ${OWNER_TITLE}`);
  return heading !== -1 && lines[heading + 1]?.startsWith("unavailable: ") === true;
}

/** The unavailable block, origin `none`: neither the store nor the cache had the owner's profile. */
function noContext({ detail, nowIso, reason }: { detail: string; nowIso: string; reason: string }): LoadedContext {
  return {
    lines: buildAlwaysLoadedContext({
      capturedAtIso: nowIso,
      sections: [unavailableSection({ detail, provider: "owner-profile", title: OWNER_TITLE })],
    }),
    origin: "none",
    reason,
  };
}

/**
 * The cached context, stamped with its own age, or one honest line saying there is none. A cached copy whose own
 * owner section is unavailable is none (see {@link ownerUnavailableIn}).
 *
 * The banner is rebuilt rather than reused from the cache, because the cache holds the lines as they were
 * injected LIVE — stamping the age at emit time is what keeps a four-day-old capture from reading as a
 * fresh one.
 *
 * @param cachePath where the last-known-good copy sits
 * @param fingerprint the fingerprint of the database being read now, empty when none was configured
 * @param nowIso the instant this is being emitted at
 * @param reason why the live read did not happen
 * @returns the cached lines, or the unavailable block
 */
export function contextFromCache({
  cachePath,
  fingerprint,
  nowIso,
  reason,
}: {
  cachePath: string;
  fingerprint: string;
  nowIso: string;
  reason: string;
}): LoadedContext {
  const cached = readContextCache({ expectedFingerprint: fingerprint, path: cachePath });
  if (cached.isErr()) {
    return noContext({ detail: `${reason}, and ${cached.error.message}`, nowIso, reason });
  }
  if (ownerUnavailableIn({ lines: cached.value.lines })) {
    return noContext({ detail: `${reason}, and the cached copy's owner section is unavailable too`, nowIso, reason });
  }
  const age = cacheAgeMinutes({ cache: cached.value, nowIso });
  const banner = `captured ${String(age)} minute(s) ago, because the live read failed: ${reason}`;
  const body = cached.value.lines.filter((line) => !line.startsWith(ALWAYS_LOADED_MARKER));
  return {
    lines: [...contextHeaderLines({ capturedAtIso: cached.value.capturedAtIso, staleReason: banner }), ...body],
    origin: "cache",
    reason,
  };
}

/**
 * The cached context for a caller that must not open the store — bound to the database configured now, exactly as
 * the live loader's own fallback is, so a copy captured from another database is refused rather than served.
 *
 * @param home the Slopweaver home whose remembered store selection names the database being read now
 * @param cachePath where the last-known-good copy sits
 * @param nowIso the instant this is being emitted at
 * @param reason why the store is not being read, carried into the banner
 * @param env the environment the store selection is read from, the caller's own seam
 * @returns the cached lines, or the unavailable block
 */
export function loadCachedContext({
  home,
  cachePath,
  nowIso,
  reason,
  env,
}: {
  home: string;
  cachePath: string;
  nowIso: string;
  reason: string;
  env: Readonly<Record<string, string | undefined>>;
}): LoadedContext {
  const url = storeUrl({ env, home });
  if (url.isErr()) {
    return contextFromCache({ cachePath, fingerprint: "", nowIso, reason: `${reason}; ${url.error.message}` });
  }
  return contextFromCache({ cachePath, fingerprint: storeFingerprint({ url: url.value }), nowIso, reason });
}

/**
 * Reading every voice call lease the consoles on this machine hold, for two readers that must never act during a
 * call: the desktop install, which quits the app and the call with it, and the `fseventsd-bloated` monitor, whose
 * restart stalls configd for about a minute while the new fseventsd rebuilds (measured: watchdogd
 * killed configd and the IPv4 routes dropped for about 370 ms, which is what dropped the owner's call).
 *
 * Whether a lease is LIVE is `./buildStamp.ts`'s `liveCallLeases`; this reads the texts it judges. The reads go
 * through a seam so a test drives the failures a real disk can produce without one.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { cachePaths } from "../cacheHome.js";
import { stateHomePaths } from "../stateHome.js";

/** The suffix `scripts/docs-site.sh` gives a console's hold directory, beside its run record. */
const HOLD_SUFFIX = ".hold";

/** The two reads a lease listing makes. Each throws as `node:fs` does, `code` and all. */
export interface CallLeaseSeams {
  /**
   * A folder's entry names alone, never stat'd: a call lease's heartbeat renames a temporary file in beside it, so a
   * stat of a name just listed can find it gone.
   */
  readonly names: (folder: { path: string }) => readonly string[];
  readonly readText: (target: { path: string }) => string;
}

/**
 * A lease path that could not be read, for a reason other than its not being there.
 *
 * @internal -- the one member of {@link CallLeaseError}, which is what every caller names.
 */
export interface LeaseUnreadableError {
  readonly code: "LEASE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly detail: string;
}

/** Every way reading the call leases can fail. */
export type CallLeaseError = LeaseUnreadableError;

/** Factories for {@link CallLeaseError}. */
export const CallLeaseErrors = {
  leaseUnreadable: ({ path, cause }: { path: string; cause: unknown }): LeaseUnreadableError => {
    const detail = cause instanceof Error ? cause.message : "refused";
    return {
      code: "LEASE_UNREADABLE",
      detail,
      message: `could not read the voice call leases at ${path}: ${detail}`,
      path,
    };
  },
} as const;

/**
 * Whether a filesystem failure says the path is simply not there. Only that is "no call"; a permission, I/O or
 * descriptor failure says nothing about whether a lease exists — and `existsSync` answers false for those too, so
 * it cannot be the test.
 */
function isGone({ cause }: { cause: unknown }): boolean {
  if (!(cause instanceof Error) || !("code" in cause)) {
    return false;
  }
  return cause.code === "ENOENT" || cause.code === "ENOTDIR";
}

/**
 * A folder's entry names, none when the folder itself is gone: a console that stops removes its hold folder, and one
 * removed before or during the listing held no call by the time it was read. Any other failure to list is an error,
 * never "no call" — reading a live lease as absent is the one mistake that ends the owner's call.
 */
function namesIfThere({
  seams,
  path,
}: {
  seams: CallLeaseSeams;
  path: string;
}): Result<readonly string[], CallLeaseError> {
  try {
    return ok(seams.names({ path }));
  } catch (cause) {
    if (isGone({ cause })) {
      return ok([]);
    }
    return err(CallLeaseErrors.leaseUnreadable({ cause, path }));
  }
}

/** One lease's text, `undefined` when it was swept as lapsed between the listing and the read. */
function leaseIfThere({
  seams,
  path,
}: {
  seams: CallLeaseSeams;
  path: string;
}): Result<string | undefined, CallLeaseError> {
  try {
    return ok(seams.readText({ path }));
  } catch (cause) {
    if (isGone({ cause })) {
      return ok(undefined);
    }
    return err(CallLeaseErrors.leaseUnreadable({ cause, path }));
  }
}

/** One lease read: where it sits under its docs-site directory, which names the call, and its text. */
interface LeaseRead {
  readonly key: string;
  readonly text: string;
}

/** Every lease under one docs-site directory, in listing order. */
function leasesUnder({
  seams,
  docsSite,
}: {
  seams: CallLeaseSeams;
  docsSite: string;
}): Result<readonly LeaseRead[], CallLeaseError> {
  const holds = namesIfThere({ path: docsSite, seams });
  if (holds.isErr()) {
    return err(holds.error);
  }
  const leases: LeaseRead[] = [];
  for (const hold of holds.value.filter((name) => name.endsWith(HOLD_SUFFIX))) {
    const calls = join(docsSite, hold, "calls");
    const names = namesIfThere({ path: calls, seams });
    if (names.isErr()) {
      return err(names.error);
    }
    for (const lease of names.value.filter((name) => name.endsWith(".json"))) {
      const text = leaseIfThere({ path: join(calls, lease), seams });
      if (text.isErr()) {
        return err(text.error);
      }
      if (text.value !== undefined) {
        leases.push({ key: `${hold}/${lease}`, text: text.value });
      }
    }
  }
  return ok(leases);
}

/** A lease's `untilMs`, or `undefined` when it does not parse to one — such a lease holds nothing. */
function untilOf({ text }: { text: string }): number | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || !("untilMs" in parsed)) {
    return undefined;
  }
  return typeof parsed.untilMs === "number" ? parsed.untilMs : undefined;
}

/** Of two reads of one call's lease, the one that holds longer, so the call reads live when either copy is. */
function longerHeld({ kept, read }: { kept: string; read: string }): string {
  const keptUntil = untilOf({ text: kept });
  const readUntil = untilOf({ text: read });
  if (readUntil === undefined) {
    return kept;
  }
  if (keptUntil === undefined || readUntil > keptUntil) {
    return read;
  }
  return kept;
}

/**
 * Every call lease any console on this machine holds: `<docs-site>/<record>.hold/calls/*.json`, the files
 * `site/app/api/console/call/route.ts` writes while a call is live. Every console, not just the main checkout's,
 * because the app's voice may be on any of them. A lease that vanishes between the listing and the read was lapsed
 * and swept, and holds nothing; the heartbeat's temporary file is never a `.json`.
 *
 * The docs-site directory lives under the cache root, and the home's legacy one is read as well: a console started
 * before the move writes there until `scripts/docs-site.sh` migrates it, and the migration leaves a symlink, so the
 * same lease can be listed twice, and a heartbeat between the two scans makes the two texts differ.
 * So a lease is one call by where it sits — `<record>.hold/calls/<call>.json` under either root — and the copy
 * holding longer is the one returned: one call reads once, and live when either copy is.
 *
 * @param home the state home whose legacy docs-site directory is also read
 * @param cacheRoot the cache root holding the current docs-site directory, this process's own when omitted
 * @param seams the listing and the read, `node:fs` in production
 * @returns each lease's text, or the path that could not be read
 */
export function readCallLeases({
  seams,
  home,
  cacheRoot,
}: {
  seams: CallLeaseSeams;
  home: string;
  cacheRoot?: string;
}): Result<readonly string[], CallLeaseError> {
  const root = cachePaths(cacheRoot === undefined ? {} : { root: cacheRoot }).root;
  return readCallLeaseCopies({ cacheRoots: [root], homes: [home], seams }).map((copies) => {
    const leases = new Map<string, string>();
    for (const { key, text } of copies) {
      const kept = leases.get(key);
      leases.set(key, kept === undefined ? text : longerHeld({ kept, read: text }));
    }
    return [...leases.values()];
  });
}

/**
 * Every copy of every call lease, under every state home and cache root named, NOT merged: {@link readCallLeases}
 * keeps the copy holding longer, which drops a copy that does not parse beside one that does. The e2e on-call hold
 * reads every copy instead, since a copy it cannot read may be the owner's call, and names the owner's
 * default home and cache root beside this process's own, so neither `SLOPWEAVER_HOME` nor `SLOPWEAVER_CACHE_HOME` can
 * point it away from the owner's console. A directory named twice is read once.
 *
 * @param homes the state homes whose legacy docs-site directories are read, in order
 * @param cacheRoots the cache roots whose current docs-site directories are read after them, in order
 * @param seams the listing and the read, `node:fs` in production
 * @returns each copy's key and text, home roots first, or the path that could not be read
 */
export function readCallLeaseCopies({
  seams,
  homes,
  cacheRoots,
}: {
  seams: CallLeaseSeams;
  homes: readonly string[];
  cacheRoots: readonly string[];
}): Result<readonly { readonly key: string; readonly text: string }[], CallLeaseError> {
  const homeDocsSites = homes.map((home) => stateHomePaths({ home }).homeDocsSite);
  const cacheDocsSites = cacheRoots.map((root) => cachePaths({ root }).docsSite);
  const copies: { readonly key: string; readonly text: string }[] = [];
  // The homes FIRST: `scripts/docs-site.sh` only ever moves a lease from the home to the cache root, so a lease the
  // home scan misses had already moved, and the cache scan after it sees it. The other order can miss
  // one that moves between the two scans.
  for (const docsSite of new Set([...homeDocsSites, ...cacheDocsSites])) {
    const found = leasesUnder({ docsSite, seams });
    if (found.isErr()) {
      return err(found.error);
    }
    copies.push(...found.value);
  }
  return ok(copies);
}

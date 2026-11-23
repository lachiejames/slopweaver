/**
 * What the fleet's LIVE read last said about each Codex store's sign-in — the pure half.
 *
 * Routing already skips a store nothing usable is signed into (`./rank.ts`, a `signed-out` exclusion whose
 * reason IS the sign-in command), and until this record existed that skip was only ever PRINTED. Falling back to Claude
 * is right when a plan is paused, but the owner also expects a very high priority, top-of-the-queue card saying
 * the fleet could not sign into this Codex plan and which commands to run. The `codex-plan-signed-out` monitor puts that card up, and it cannot run the
 * live read itself — one batch takes seconds and talks to the provider — so the read that already runs files
 * its answer here.
 *
 * ## Why the record, and not the store's `auth.json` alone
 *
 * `auth.json` proves a sign-in HAPPENED, never that it still works (`./auth.ts` § Presence is not validity). A
 * revoked or expired sign-in leaves the file in place while the app-server answers `account: null`, and routing
 * skips the store exactly as it skipped one with no file at all. Only the live read can see that case.
 *
 * ## Why the record carries the auth file's STAMP
 *
 * A refusal is evidence about ONE version of the store's sign-in. The stamp — `auth.json`'s mtime, ctime and
 * size, never a byte of it — names that version, so the monitor holds the refusal against the file only while
 * the file is still the one refused: a sign-in the owner makes afterwards changes the stamp, the card clears, and the
 * next live read confirms it or files a fresh refusal. A stamp that moved WHILE the read was in flight means
 * the answer may describe the old file, so that refusal is not filed at all.
 *
 * Pure: an observation in, the next state of one alias's record out, and the decoder every stored or imported
 * value passes through before anything is ordered against it. No I/O — where a record lives is
 * `./signInRecordStore.ts`'s business.
 */
import { parseIsoMs } from "#lib/date.js";
import { isRecord } from "#lib/parsers.js";

import type { CodexAccountLive } from "./accountLiveParse.js";

/**
 * Whether the filed read is no earlier an INSTANT than the live one. Compared as instants, never as strings: two
 * valid ISO-8601 stamps with different offsets sort wrongly as text. A tie — the same
 * millisecond, the precision instants are compared at — keeps what is filed: a kept refusal costs a card for one
 * more read, an overwritten one hides it.
 *
 * @returns true only when both parse and the filed one is not the earlier
 */
function filedIsNotOlder({ filedIso, liveIso }: { filedIso: string; liveIso: string }): boolean {
  const filedMs = parseIsoMs({ tsIso: filedIso });
  const liveMs = parseIsoMs({ tsIso: liveIso });
  return filedMs !== undefined && liveMs !== undefined && filedMs >= liveMs;
}

/** `$CODEX_HOME/auth.json`'s identity on disk — which version of the sign-in, never what it says. */
export type CodexAuthStamp =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly mtimeMs: number; readonly ctimeMs: number; readonly size: number };

/** The two live answers that mean nothing usable is signed into a store. */
type CodexSignInFailure = "signed-out" | "store-missing";

/** The newest live answer about one store's sign-in. */
export interface CodexSignInRecord {
  /** The register alias the record is filed under. */
  readonly alias: string;
  /** The store the read looked at — compared on read, so a re-pointed alias never inherits an old failure. */
  readonly codexHome: string;
  readonly state: "signed-in" | CodexSignInFailure;
  /** The live read this answer came from. A signed-in read older than the one filed never replaces it. */
  readonly readAtIso: string;
  /** The first read of this unbroken run of failure, on a failing state only. */
  readonly failingSinceIso: string | undefined;
  /** The auth file the read judged, as it stood once the read had answered. */
  readonly authStamp: CodexAuthStamp;
}

/** What one live answer does to one alias's record. */
export type CodexSignInRecordChange =
  { readonly kind: "write"; readonly record: CodexSignInRecord } | { readonly kind: "keep"; readonly why: string };

/**
 * Whether two stamps name the same version of the auth file.
 *
 * @returns true when both are absent, or both are present with every field equal
 */
export function sameCodexAuthStamp({ left, right }: { left: CodexAuthStamp; right: CodexAuthStamp }): boolean {
  if (left.kind === "absent" || right.kind === "absent") {
    return left.kind === right.kind;
  }
  return left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.size === right.size;
}

/**
 * The change one live answer makes to the record filed under its alias.
 *
 * Three answers KEEP what is filed. `unreadable` says nothing about the sign-in — a deadline or a missing
 * binary — and replacing a refusal on it would take a real card off the owner's queue because a read failed. A
 * signed-in answer OLDER than the filed one lost a race with a concurrent pass and must not undo its refusal.
 * And a failure read while the auth file changed under it may describe the file the owner has since replaced.
 *
 * The ordering guard is one-sided on purpose: a refusal always files, whatever the filed instant says. Two
 * racing passes, or a clock set backwards, can then only leave a card up one read too
 * long — which the next read or the owner's new sign-in clears — and never hide one routing is really skipping.
 *
 * @param alias the register alias the store is filed under
 * @param live what the store's app-server answered this read
 * @param previous the record already filed under the alias, when there is one
 * @param authBefore the auth file's stamp just before the live batch ran
 * @param authAfter the auth file's stamp once it had answered
 * @returns write, or keep with why
 */
export function nextCodexSignInRecord({
  alias,
  authAfter,
  authBefore,
  live,
  previous,
}: {
  alias: string;
  authAfter: CodexAuthStamp;
  authBefore: CodexAuthStamp;
  live: CodexAccountLive;
  previous: CodexSignInRecord | undefined;
}): CodexSignInRecordChange {
  if (live.kind === "unreadable") {
    return { kind: "keep", why: `the live read was unreadable: ${live.reason}` };
  }
  const base = { alias, authStamp: authAfter, codexHome: live.codexHome, readAtIso: live.readAtIso };
  if (live.kind === "signed-in") {
    if (previous !== undefined && filedIsNotOlder({ filedIso: previous.readAtIso, liveIso: live.readAtIso })) {
      return { kind: "keep", why: `a read no older (${previous.readAtIso}) is already filed` };
    }
    return { kind: "write", record: { ...base, failingSinceIso: undefined, state: "signed-in" } };
  }
  if (!sameCodexAuthStamp({ left: authBefore, right: authAfter })) {
    return { kind: "keep", why: "auth.json changed while the live read was in flight" };
  }
  const continues =
    previous?.failingSinceIso !== undefined && previous.codexHome === live.codexHome && previous.state === live.kind;
  return {
    kind: "write",
    record: { ...base, failingSinceIso: continues ? previous.failingSinceIso : live.readAtIso, state: live.kind },
  };
}

/**
 * Whether a filed time is exactly what `Date.prototype.toISOString` writes — the only form a record is ever
 * written in. Anything else is not trusted as an instant: `Date.parse` quietly rolls an impossible day into the next month, and
 * an offset or a sub-millisecond digit compares wrongly.
 *
 * @returns true only for a canonical UTC instant that round-trips unchanged
 */
function isCanonicalInstant({ value }: { value: string }): boolean {
  const ms = parseIsoMs({ tsIso: value });
  return ms !== undefined && new Date(ms).toISOString() === value;
}

/**
 * Decode a filed stamp, or undefined when the value is not one.
 *
 * @returns the stamp, or undefined
 */
function decodeStamp({ value }: { value: unknown }): CodexAuthStamp | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value["kind"] === "absent") {
    return { kind: "absent" };
  }
  const { ctimeMs, mtimeMs, size } = value;
  if (value["kind"] !== "present" || typeof ctimeMs !== "number" || typeof mtimeMs !== "number") {
    return undefined;
  }
  if (typeof size !== "number") {
    return undefined;
  }
  return { ctimeMs, kind: "present", mtimeMs, size };
}

/**
 * Decode one stored or imported value into a record, or say which field stops it decoding.
 *
 * `jsonb` is not validation, and neither is a file that parsed: both reach the ordering guard only through here.
 *
 * @param value the parsed JSON — a store row's `record` column or an import file's contents
 * @param alias the alias the value is filed under, which the record must name
 * @returns the record, or why it is not one
 */
export function decodeCodexSignInRecord({
  alias,
  value,
}: {
  alias: string;
  value: unknown;
}): { readonly record: CodexSignInRecord } | { readonly why: string } {
  if (!isRecord(value)) {
    return { why: "is not a JSON object" };
  }
  const { codexHome, failingSinceIso, readAtIso, state } = value;
  if (value["alias"] !== alias) {
    return { why: `names alias ${JSON.stringify(value["alias"])}, not ${alias}` };
  }
  if (typeof codexHome !== "string" || typeof readAtIso !== "string") {
    return { why: "is missing codexHome or readAtIso" };
  }
  if (!isCanonicalInstant({ value: readAtIso })) {
    return { why: `carries readAtIso ${JSON.stringify(readAtIso)}, which is not an instant` };
  }
  const authStamp = decodeStamp({ value: value["authStamp"] });
  if (authStamp === undefined) {
    return { why: "carries no readable authStamp" };
  }
  if (state === "signed-in") {
    // A signed-in record is written with no failingSinceIso at all, so one that carries it was not written here.
    if (failingSinceIso !== undefined) {
      return { why: "is signed-in yet carries a failingSinceIso" };
    }
    return { record: { alias, authStamp, codexHome, failingSinceIso: undefined, readAtIso, state } };
  }
  if (state !== "signed-out" && state !== "store-missing") {
    return { why: `carries state ${JSON.stringify(state)}, not signed-in, signed-out or store-missing` };
  }
  if (typeof failingSinceIso !== "string") {
    return { why: `is ${state} with no failingSinceIso` };
  }
  if (!isCanonicalInstant({ value: failingSinceIso })) {
    return { why: `carries failingSinceIso ${JSON.stringify(failingSinceIso)}, which is not an instant` };
  }
  return { record: { alias, authStamp, codexHome, failingSinceIso, readAtIso, state } };
}

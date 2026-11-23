/**
 * The one durable claim an incident channel's board row is registered under: `incidents/claims/<channel id>`,
 * created exclusively BEFORE the row doc and never moved or removed once a row exists.
 *
 * "One row per channel id" needs an identity claim that exists no later than the row doc and survives everything the
 * doc does not: a rename (the claim is the id), the doc being moved to the archive by hand (the claim never moves), a
 * process dying between the doc and its journal (the claim was written first), and a lost seen ledger (the claim is a
 * separate file). Every other check — the ledger, the row-doc lookup, the board's exclusive create — narrows a window;
 * this closes it, because `wx` is atomic and nothing un-claims a channel that has a row.
 *
 * A claim with no row doc is a sweep MID-registration or one that died after claiming and before the doc. A young one
 * refuses, named in the sweep's skips. One older than {@link CLAIM_STALE_MS} — or with no readable stamp, which is a
 * sweep that died between creating the file and writing it — is a dead sweep's, and the next sweep takes it over, so
 * a crash costs a delay rather than the incident's row. The takeover restamps in place, so no crash
 * leaves the channel unclaimed. Two sweeps taking one stale claim over at once can both register; the board's
 * exclusive create of the one id-named doc still lets only one row in.
 */
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { ATOMIC_WRITE_TEMP_TAIL, fsyncDirectories, fsyncFile, writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

import { type IncidentClaimAction, type IncidentClaimError, IncidentClaimErrors } from "./errors.js";

/** Owner-only permissions, matching the seen ledger beside it. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * How old a claim with no row doc must be before a sweep takes it over. A registration is one local `handover
 * register` that finishes in seconds, so half an hour is far past any live one, and well inside the 48-hour window.
 */
export const CLAIM_STALE_MS = 30 * 60 * 1000;

/**
 * What one claim attempt found: this call took the claim, took over a dead sweep's stale one, or one was already
 * there. A `reclaimed` claim is never given back on a failure — it may be what keeps the channel a candidate.
 */
export interface IncidentClaim {
  readonly state: "claimed" | "reclaimed" | "held";
  readonly path: string;
}

/**
 * Where a channel's claim lives.
 *
 * @param home the state home
 * @param channelId the channel, as Slack spells its id
 * @returns the claim file's path
 */
export function incidentClaimPath({ home, channelId }: { home: string; channelId: string }): string {
  return join(stateHomePaths({ home }).incidents, "claims", channelId);
}

/**
 * What a sweep writes into a claim it takes, and what its release compares against before removing one. The instant
 * says how old the claim is; the holder says WHOSE it is, since two sweeps can share an instant to the millisecond
 * and a stamp of the instant alone would let one remove the other's.
 *
 * @param atIso the sweep's instant
 * @param holder an id minted once per sweep, never shared
 * @returns the claim file's whole contents
 */
export function incidentClaimStamp({ atIso, holder }: { atIso: string; holder: string }): string {
  return `${atIso} ${holder}\n`;
}

/**
 * The instant a claim's stamp carries, as epoch milliseconds — `NaN` for one with no readable instant, which a dead
 * sweep leaves when it dies between creating the file and writing it.
 *
 * @param stamp the claim file's contents
 * @returns epoch milliseconds, or `NaN`
 */
function stampedAtMs({ stamp }: { stamp: string }): number {
  const [instant] = stamp.trim().split(" ");
  if (instant === undefined) {
    return Number.NaN;
  }
  return Date.parse(instant);
}

/**
 * The claim error for one refused filesystem call.
 *
 * @param path the claim, or the claims directory
 * @param action what the sweep was doing to it
 * @param error what the filesystem threw
 * @returns the typed error
 */
function claimIo({
  path,
  action,
  error,
}: {
  path: string;
  action: IncidentClaimAction;
  error: unknown;
}): IncidentClaimError {
  return IncidentClaimErrors.io({ action, cause: errorMessage({ error }), path });
}

/**
 * Every channel id with a claim. A claimed channel was admitted when its claim was taken, so detection keeps it a
 * candidate past the live window until its row exists — a sweep that crashed near the window's end would otherwise
 * strand the channel at zero rows, its claim going stale only after it stopped being a candidate.
 *
 * @param home the state home
 * @returns the claimed ids, empty when nothing was ever claimed, or why the claims would not list
 */
export function claimedIncidentChannelIds({ home }: { home: string }): Result<ReadonlySet<string>, IncidentClaimError> {
  const dir = join(stateHomePaths({ home }).incidents, "claims");
  try {
    // A takeover's restamp is staged beside the claim under the atomic writer's temp name, never a channel's.
    return ok(new Set(readdirSync(dir).filter((name) => !ATOMIC_WRITE_TEMP_TAIL.test(name))));
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok(new Set());
    }
    return err(claimIo({ action: "list", error, path: dir }));
  }
}

/**
 * Take a channel's claim, exclusively.
 *
 * @param home the state home
 * @param atIso when, written into the claim so a stranded one says how old it is
 * @param holder this sweep's id, written beside the instant so only this sweep ever gives the claim back
 * @returns `claimed` when this call created it, `held` when it already existed, or why it would not write
 */
export function claimIncidentChannel({
  home,
  channelId,
  atIso,
  holder,
}: {
  home: string;
  channelId: string;
  atIso: string;
  holder: string;
}): Result<IncidentClaim, IncidentClaimError> {
  const path = incidentClaimPath({ channelId, home });
  try {
    mkdirSync(join(stateHomePaths({ home }).incidents, "claims"), { mode: DIR_MODE, recursive: true });
  } catch (error: unknown) {
    // Its own catch: a FILE where the directory belongs also throws EEXIST, which must never read as `held`.
    return err(claimIo({ action: "write", error, path }));
  }
  return createdExclusively({ path, stamp: incidentClaimStamp({ atIso, holder }) }).map((created): IncidentClaim => ({
    path,
    state: created ? "claimed" : "held",
  }));
}

/**
 * Take over a claim a dead sweep left: one stamped longer ago than {@link CLAIM_STALE_MS}, or with no readable stamp.
 * The caller only asks once no row doc names the channel.
 *
 * The takeover RESTAMPS the claim in place through the durable atomic writer, so the claim file never stops existing.
 * Removing it and creating it again would leave a moment with no claim, and a crash there drops a channel already past
 * the 48-hour window for good, since only its claim kept it a candidate. A claim that vanished in
 * between — its holder released it — is taken afresh with the same `wx` create.
 *
 * @param path the held claim
 * @param nowMs the sweep's instant, epoch milliseconds — the stamp's age is judged against it, never the wall clock
 * @param holder this sweep's id, which the restamp carries
 * @returns true when this sweep now holds the claim, false when it is young enough to be a live sweep's or another
 *   sweep took a released one first
 */
export function reclaimStaleIncidentClaim({
  path,
  nowMs,
  holder,
}: {
  path: string;
  nowMs: number;
  holder: string;
}): Result<boolean, IncidentClaimError> {
  const restamp = incidentClaimStamp({ atIso: new Date(nowMs).toISOString(), holder });
  let stamp: string;
  try {
    stamp = readFileSync(path, "utf8");
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return createdExclusively({ path, stamp: restamp });
    }
    return err(claimIo({ action: "read", error, path }));
  }
  const at = stampedAtMs({ stamp });
  if (!Number.isNaN(at) && nowMs - at < CLAIM_STALE_MS) {
    return ok(false);
  }
  try {
    writeFileAtomic({ contents: restamp, fileMode: FILE_MODE, path });
  } catch (error: unknown) {
    return err(claimIo({ action: "restamp", error, path }));
  }
  return ok(true);
}

/**
 * Create a claim file only if none is there, and flush it to the device before saying so.
 *
 * The flush is the claim's whole job past the 48-hour window: once a channel is that old, only its claim keeps it a
 * candidate, so a claim a power loss could drop would lose the incident's row for good. The file,
 * the claims directory's entry for it, and the two directory entries above that a fresh install just made are each
 * flushed. A flush that fails leaves the file standing and reports why, so the next sweep finds it and retakes it
 * once stale.
 *
 * @param path the claim
 * @param stamp the claim's contents
 * @returns true when this call created it, false when another sweep's already stood there, or why it would not write
 */
function createdExclusively({ path, stamp }: { path: string; stamp: string }): Result<boolean, IncidentClaimError> {
  try {
    writeFileSync(path, stamp, { flag: "wx", mode: FILE_MODE });
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "EEXIST") {
      return ok(false);
    }
    return err(claimIo({ action: "write", error, path }));
  }
  try {
    fsyncFile({ path });
    const claims = dirname(path);
    fsyncDirectories({ paths: [claims, dirname(claims)] });
  } catch (error: unknown) {
    return err(claimIo({ action: "write", error, path }));
  }
  return ok(true);
}

/**
 * How long a sweep may hold its own claim and still give it back. Half the stale bound, so a claim is only ever
 * removed while no other sweep could yet call it stale and take it over.
 */
export const CLAIM_RELEASE_BY_MS = CLAIM_STALE_MS / 2;

/**
 * Give back a claim THIS sweep took and then failed to register under, so the next sweep tries the channel again —
 * but only while it is young enough that nobody else can have taken it over, and still carries this sweep's stamp.
 *
 * A sweep whose probe ran past {@link CLAIM_STALE_MS} holds a claim another sweep may be restamping that same
 * moment. Removing it would drop a channel already past the 48-hour window for good, should the other sweep then
 * crash, since only its claim kept it a candidate. So a claim held {@link CLAIM_RELEASE_BY_MS} or
 * longer stays, and a sweep retakes it once stale; one restamped by anyone else stays too. The residue is a sweep
 * suspended for a quarter of an hour between this age check and the remove.
 *
 * @param path the claim this sweep created
 * @param atIso the instant this sweep stamped it with
 * @param holder this sweep's id, which must be the one the claim still carries
 * @param nowMs the instant of the release itself, epoch milliseconds — read when giving back, not when the sweep began
 * @returns true when the claim is gone, false when it stays because it is too old to give back or another sweep
 *   restamped it, or why it would not read or remove — an absent claim is already released
 */
export function releaseIncidentClaim({
  path,
  atIso,
  holder,
  nowMs,
}: {
  path: string;
  atIso: string;
  holder: string;
  nowMs: number;
}): Result<boolean, IncidentClaimError> {
  if (nowMs - Date.parse(atIso) >= CLAIM_RELEASE_BY_MS) {
    return ok(false);
  }
  try {
    if (readFileSync(path, "utf8") !== incidentClaimStamp({ atIso, holder })) {
      return ok(false);
    }
    unlinkSync(path);
  } catch (error: unknown) {
    if (!(isRecord(error) && error["code"] === "ENOENT")) {
      return err(claimIo({ action: "remove", error, path }));
    }
  }
  return ok(true);
}

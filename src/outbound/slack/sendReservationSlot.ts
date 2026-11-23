/**
 * One Slack send slot on disk: its record, its lock, and which of its takes THIS process owns. The policy that
 * decides whether a send may go out lives in `./sendReservation.ts`, and its header says why each rule here
 * exists — one lock per slot, a record landing whole, a release dropping only its own reservation. This module
 * is how those rules are kept; nothing here judges a window or a permission.
 */
import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { createFileExclusive, fsyncDirectories, writeFileAtomic } from "#lib/writeAtomic.js";

import { isRecord } from "../../lib/parsers.js";
import { acquireWaitingLock } from "../../live/automation/waitingLock.js";
import { stateHomePaths } from "../../stateHome.js";

/**
 * The reservation file for one duplicate key (the key is a hex digest, so it is a safe filename).
 *
 * @returns the slot's path under the state home's ledgers
 */
export function reservationPath({ home, duplicateKey }: { home: string; duplicateKey: string }): string {
  return join(stateHomePaths({ home }).ledgers, "slack-sends", duplicateKey);
}

/** Ensure the reservation directory exists. */
export function ensureSlotDir({ home }: { home: string }): void {
  mkdirSync(join(stateHomePaths({ home }).ledgers, "slack-sends"), { recursive: true });
}

/** The part of a reservation that dates it and says whether it landed — what a re-take has to give back. */
interface DatedReservation {
  readonly reservedIso: string;
  readonly sentTs?: string | undefined;
}

/**
 * What a reservation file holds once parsed. `claim` is a random id minted by the caller that took the slot,
 * so a later release can tell its own reservation from one somebody else has since put there. `prior` is the
 * reservation an explicit resend re-took the slot from, so that resend's own proven failure gives it back
 * rather than emptying a slot whose earlier message may have landed.
 */
export interface ReservationRecord extends DatedReservation {
  readonly claim?: string | undefined;
  readonly prior?: DatedReservation | undefined;
}

/** A parsed `{ reservedIso, sentTs? }`, or undefined when the value is not one. */
function parseDated({ value }: { value: unknown }): DatedReservation | undefined {
  if (!isRecord(value) || typeof value["reservedIso"] !== "string") {
    return undefined;
  }
  const sentTs = value["sentTs"];
  return { reservedIso: value["reservedIso"], ...(typeof sentTs === "string" ? { sentTs } : {}) };
}

/**
 * What THIS process has taken of each slot, by slot path: the claim of its latest take, and how many of its
 * takes are still unsettled. A failed send is settled by the process that reserved it, so this is where its
 * proof of ownership lives — never on the wire, never in a caller's hands.
 *
 * A settlement does not say WHICH take it belongs to. With two takes in flight at once (a send reserved, its
 * slot aged out, and the same message reserved again by the same process), a late failure of the first would
 * match the second's claim, and no count can say which send is settling once they settle in either order. So
 * the moment a take lands while another is still outstanding, the slot is `shared` until EVERY take of it has
 * settled, and a shared slot is never released, only kept. A release is certain only for a take that was the
 * one outstanding take from the moment it was made. A take that never settles keeps the slot shared for the
 * process's life, which only ever keeps a later reservation, never drops one.
 */
const takesHere = new Map<
  string,
  { readonly latest: string; readonly outstanding: number; readonly shared: boolean }
>();

/** Record that one of this process's takes of a slot has been settled, confirmed or failed. */
export function settledHere({ path }: { path: string }): void {
  const taken = takesHere.get(path);
  if (taken === undefined) {
    return;
  }
  if (taken.outstanding <= 1) {
    takesHere.delete(path);
    return;
  }
  takesHere.set(path, { latest: taken.latest, outstanding: taken.outstanding - 1, shared: taken.shared });
}

/**
 * Parse a reservation file's contents, accepting BOTH formats.
 *
 * The record used to be a bare ISO instant and is now JSON. Reading both is not politeness to old files —
 * a reservation written by PR5 that re-parsed as garbage would read as "no evidence", i.e. as `fresh`, and
 * the very next run would cheerfully double-post it. So the legacy form is a first-class case.
 */
function parseReservation({ raw }: { raw: string }): ReservationRecord | undefined {
  if (raw.length === 0) {
    return undefined;
  }
  if (!raw.startsWith("{")) {
    return { reservedIso: raw };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const dated = parseDated({ value: parsed });
    if (dated === undefined || !isRecord(parsed)) {
      return undefined;
    }
    const claim = parsed["claim"];
    const prior = parseDated({ value: parsed["prior"] });
    return {
      ...dated,
      ...(typeof claim === "string" ? { claim } : {}),
      ...(prior === undefined ? {} : { prior }),
    };
  } catch {
    return undefined;
  }
}

/**
 * Read the reservation standing at a slot.
 *
 * @returns the record, or undefined when it is absent or unreadable
 */
export function readReservation({ path }: { path: string }): ReservationRecord | undefined {
  try {
    return parseReservation({ raw: readFileSync(path, "utf8").trim() });
  } catch {
    return undefined;
  }
}

/** The reservation as it is written to disk. */
function serialiseReservation({ record }: { record: ReservationRecord }): string {
  return JSON.stringify(record);
}

/**
 * Run one slot's critical section under that slot's lock — `./sendReservation.ts`'s header says why every
 * change to a slot goes through here. The lock waits out a busy holder a few times (`acquireWaitingLock`,
 * ~155ms in all); past that the section does not run and the caller takes its own safe direction from the
 * refusal.
 *
 * @param duplicateKey the slot the section reads and changes
 * @param body the read-then-change, run only while the lock is held
 * @returns what the section returned, or why the lock could not be taken: the lock's refusal or the thrown
 *   cause, which every caller drops for its own fail-closed direction
 */
export function withSlotLock<T>({
  home,
  duplicateKey,
  body,
}: {
  home: string;
  duplicateKey: string;
  body: () => T;
}): Result<T, unknown> {
  let lock: ReturnType<typeof acquireWaitingLock>;
  try {
    lock = acquireWaitingLock({
      home,
      key: `slack-send:${duplicateKey}`,
      // The lock's own clock is the process's, never the caller's `nowIso`: that dates the send window and
      // may be a fixture's instant, and a lock judged by it could age a live holder out mid-section.
      nowIso: new Date().toISOString(),
      staleAfterMs: Number.POSITIVE_INFINITY,
    });
  } catch (cause) {
    // The lock directory itself is broken (its `mkdir` throws). That fails closed like a busy lock: a confirm
    // runs AFTER a real post, so a throw from here would end the send's caller on a message that landed.
    return err(cause);
  }
  if (lock.isErr()) {
    return err(lock.error);
  }
  try {
    return ok(body());
  } finally {
    lock.value.release();
  }
}

/** Remove whatever stands at a slot. Only ever called with the slot's lock held. */
export function removeSlot({ path }: { path: string }): void {
  try {
    unlinkSync(path);
  } catch {
    // Already gone is the desired state; an unwritable ledger surfaces on the create that follows.
  }
}

/**
 * Create the reservation if the slot is empty, landing the record WHOLE: it is written in full to a private
 * sibling and then `link`ed into place, which fails `EEXIST` rather than replacing anything, so no reader ever
 * sees the slot exist empty — the state an `O_EXCL` create-then-write passes through.
 *
 * @returns `true` iff THIS caller's record is now the slot's
 */
function tryCreate({ path, record }: { path: string; record: ReservationRecord }): boolean {
  const staged = `${path}.staged-${String(process.pid)}-${randomUUID()}`;
  try {
    createFileExclusive({ contents: serialiseReservation({ record }), path: staged });
    linkSync(staged, path);
    // The link is a new directory entry, and `createFileExclusive` flushed the directory BEFORE it. Flush it
    // again so a reservation already reported `fresh` survives a machine crash, as the old exclusive create's did.
    removeSlot({ path: staged });
    fsyncDirectories({ paths: [path] });
    return true;
  } catch {
    return false; // the slot is taken (or unwritable — treated as "not ours", the safe direction)
  } finally {
    removeSlot({ path: staged });
  }
}

/**
 * Take an empty slot for this process under a fresh claim id, and remember the claim here so only this
 * process's own failure can release it. Only ever called with the slot's lock held.
 *
 * The residue, stated: the claim is a random UUID, 122 random bits, so two processes minting the SAME claim
 * for one slot inside one window would let the older one's proven failure release the newer one's
 * reservation. Nothing here closes that, by design; a pid or a counter beside it would not make it absolute
 * either, since pids are reused. Only a claim carried by the caller from reserve to settle would.
 *
 * @param prior the reservation an explicit resend is replacing, kept in the record so that resend's own proven
 *   failure gives it back
 * @returns `true` iff this process's record now holds the slot
 */
export function takeSlot({ path, nowIso, prior }: { path: string; nowIso: string; prior?: DatedReservation }): boolean {
  const claim = randomUUID();
  if (!tryCreate({ path, record: { claim, reservedIso: nowIso, ...(prior === undefined ? {} : { prior }) } })) {
    return false;
  }
  const before = takesHere.get(path);
  if (before === undefined) {
    takesHere.set(path, { latest: claim, outstanding: 1, shared: false });
  } else {
    takesHere.set(path, { latest: claim, outstanding: before.outstanding + 1, shared: true });
  }
  return true;
}

/**
 * The instant a confirmation dates the slot by: its own, unless what stands there is a datable instant that
 * its own does not reach. Pure.
 *
 * @returns the later of the two datable instants, keeping the standing one when the new one cannot be dated
 */
function laterReservedIso({ standing, nowIso }: { standing: ReservationRecord | undefined; nowIso: string }): string {
  if (standing === undefined) {
    return nowIso;
  }
  const standingMs = Date.parse(standing.reservedIso);
  if (!Number.isFinite(standingMs)) {
    return nowIso;
  }
  const nowMs = Date.parse(nowIso);
  if (Number.isFinite(nowMs) && nowMs >= standingMs) {
    return nowIso;
  }
  return standing.reservedIso;
}

/**
 * Write a confirmed record over the slot, under its lock, as a temp-then-rename so a reader never catches the
 * slot empty — the state an in-place rewrite passed through, and which read as "unreadable, take it over".
 *
 * @param nowIso the instant the send completed
 * @param sentTs the Slack message timestamp the send returned
 * @returns `true` iff the confirmed record is now the slot's
 */
export function confirmSlot({
  home,
  duplicateKey,
  nowIso,
  sentTs,
}: {
  home: string;
  duplicateKey: string;
  nowIso: string;
  sentTs: string;
}): boolean {
  ensureSlotDir({ home });
  const path = reservationPath({ duplicateKey, home });
  const written = withSlotLock({
    body: () => {
      // Never date the slot EARLIER than what stands there. A confirmation settled late, after the slot aged
      // out and a newer send took it, would otherwise back-date that newer reservation out of its own window,
      // and the next identical send inside it would read the slot as aged and claim it fresh.
      // An instant that cannot be dated never replaces one that can, for the same reason: it would read as aged.
      const reservedIso = laterReservedIso({ nowIso, standing: readReservation({ path }) });
      try {
        writeFileAtomic({ contents: serialiseReservation({ record: { reservedIso, sentTs } }), path });
        return true;
      } catch {
        return false;
      }
    },
    duplicateKey,
    home,
  });
  return written.isOk() && written.value;
}

/**
 * Drop THIS process's own reservation, on a failure that PROVES nothing landed. Never called because a send
 * merely THREW: releasing on an unread failure is how a timed-out-but-delivered message gets posted twice.
 *
 * It changes the slot only while the record standing there carries the claim of this process's one take of
 * it, a take that never overlapped another ({@link takesHere} says why). The lock alone serialises a release;
 * it does not say WHOSE reservation is being released. A failure settled late — after the slot aged out and
 * another send took it, or after an override re-took it — would otherwise delete that newer reservation, and
 * the next identical send would read the slot empty and post a second time.
 *
 * A take that replaced an earlier reservation (an override's re-take, {@link retakeSlot}) is released by
 * putting that earlier reservation BACK, never by emptying the slot: the override's failure proves only that
 * the override did not land, and the message it was repeating may well have.
 *
 * @returns `true` once the slot no longer holds this process's reservation; `false` when its lock stayed busy,
 *   somebody else's reservation stands there, or the earlier one could not be put back, and the slot was left
 *   as it was
 */
export function releaseOwnTake({ home, duplicateKey }: { home: string; duplicateKey: string }): boolean {
  const path = reservationPath({ duplicateKey, home });
  const released = withSlotLock({
    body: () => {
      const record = readReservation({ path });
      const taken = takesHere.get(path);
      // Absent or unreadable: there is no reservation to protect, and any sender would take an unreadable one.
      if (record === undefined) {
        removeSlot({ path });
        return true;
      }
      if (taken === undefined || taken.shared || taken.outstanding !== 1 || record.claim !== taken.latest) {
        return false;
      }
      if (record.prior === undefined) {
        removeSlot({ path });
        return true;
      }
      try {
        writeFileAtomic({ contents: serialiseReservation({ record: record.prior }), path });
        return true;
      } catch {
        return false; // the override's own record stays: kept, which over-warns and never double-posts
      }
    },
    duplicateKey,
    home,
  });
  return released.isOk() && released.value;
}

/**
 * Re-take a reservation the caller has explicitly decided to send again, in ONE critical section, keeping the
 * record it replaces as the new one's `prior`.
 *
 * Replace rather than leave the old record: leaving it would mean the next run still sees the stale outcome
 * and halts on a message this run has already resolved.
 *
 * The lock serialises two overrides; it does not coalesce them. Two callers that each carry an explicit
 * resend permission for the same message both send, one after the other, because each was told to repeat it.
 * Closing that needs an override bound to the record it saw, a contract change rather than a wider section.
 *
 * @returns `true` iff this caller's fresh record now holds the slot; `false` means do not send
 */
export function retakeSlot({
  home,
  duplicateKey,
  nowIso,
}: {
  home: string;
  duplicateKey: string;
  nowIso: string;
}): boolean {
  // Unreachable through `claimSend`, whose reserve already refused an undatable instant; kept so this section
  // can never write a record that reads as aged.
  if (!Number.isFinite(Date.parse(nowIso))) {
    return false;
  }
  const path = reservationPath({ duplicateKey, home });
  const retaken = withSlotLock({
    body: () => {
      const standing = readReservation({ path });
      removeSlot({ path });
      if (standing === undefined) {
        return takeSlot({ nowIso, path });
      }
      const prior: DatedReservation = {
        reservedIso: standing.reservedIso,
        ...(standing.sentTs === undefined ? {} : { sentTs: standing.sentTs }),
      };
      return takeSlot({ nowIso, path, prior });
    },
    duplicateKey,
    home,
  });
  return retaken.isOk() && retaken.value;
}

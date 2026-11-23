/**
 * What a load-slot lane holds, as pure text: the one marker file whose NAME is the whole state of a lane, and how a
 * lane's listing is read. The filesystem half — which rename moves a lane between these states — is `./loadSlots.ts`,
 * whose module doc says why a lane is exclusive.
 *
 * A marker is `free`, or `busy.<pid>.<startedAtMs>.<ceilingMib>.<limit>.<start>.<lease id>`: everything a holder is
 * judged and reported by, in the name, so a lane changes state by ONE rename and is never half-written. `<start>` is
 * the holder's `ps` start stamp in base64url — which carries no `.`, so the fields never run together — or `-` for a
 * holder `ps` gave none. `<limit>` is the limit the holder derived when it took the lane, so a caller deriving a
 * larger one can still count it at the smaller.
 */
import { randomUUID } from "node:crypto";

import { usableStamp } from "./processIdentity.js";

/** One held slot: which process holds it, since when, and the ceiling it may grow to. */
export interface LoadSlot {
  readonly pid: number;
  readonly startedAtIso: string;
  readonly ceilingMib: number;
  /**
   * The holder's start stamp as `ps -o lstart=` printed it when it took the slot — what binds the pid to ONE
   * process. Absent when `ps` gave none.
   */
  readonly start?: string;
}

/** A lease on one lane: the holder, and the limit it derived when it took the lane. */
export interface SlotLease {
  readonly slot: LoadSlot;
  readonly limit: number;
}

/** What one lane's listing says it holds. */
export type LaneMarker =
  | { readonly kind: "absent" }
  | { readonly kind: "free" }
  | { readonly kind: "held"; readonly marker: string; readonly lease: SlotLease }
  | { readonly kind: "malformed"; readonly marker: string }
  | { readonly kind: "crowded"; readonly entries: number };

/** The marker of a lane nobody holds. */
export const FREE_MARKER = "free";

/** A lane directory's name: `lane-<k>`, `k` written without leading zeros so one lane has exactly one name. */
const LANE_NAME = /^lane-(0|[1-9]\d{0,5})$/u;

/**
 * A held lane's marker. The pid is a positive integer because `kill(0, 0)` and `kill(-n, 0)` probe a process GROUP,
 * never one process; the lease id is a UUID no other lease carries.
 */
const BUSY_MARKER =
  /^busy\.([1-9]\d{0,9})\.(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,9})\.([1-9]\d{0,5})\.(-|[\w-]{2,})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u;

/** The largest epoch-milliseconds value a `Date` can hold; one past it has no `toISOString`. */
const MAX_DATE_MS = 8.64e15;

/**
 * The lane index a slot-directory entry names, or `undefined` for an entry that is not a lane.
 *
 * @param name one entry of the slot directory
 * @returns the index
 */
export function laneIndex({ name }: { name: string }): number | undefined {
  const match = LANE_NAME.exec(name);
  return match === null ? undefined : Number(match[1]);
}

/**
 * The name of lane `index`.
 *
 * @param index the lane's position, from 0
 * @returns `lane-<index>`
 */
export function laneName({ index }: { index: number }): string {
  return `lane-${String(index)}`;
}

/**
 * The busy marker naming a lease — the exact file name a lane holds while that lease stands.
 *
 * @param lease the holder and the limit it took the lane under
 * @param leaseId what makes this lease's name unique, so a reaper that judged an earlier lease dead cannot rename
 *   this one — a fresh UUID unless a test pins it
 * @returns the marker file name
 */
export function slotMarker({ lease, leaseId = randomUUID() }: { lease: SlotLease; leaseId?: string }): string {
  const { slot } = lease;
  const start = slot.start === undefined ? "-" : Buffer.from(slot.start, "utf8").toString("base64url");
  return `busy.${String(slot.pid)}.${String(Date.parse(slot.startedAtIso))}.${String(slot.ceilingMib)}.${String(lease.limit)}.${start}.${leaseId}`;
}

/**
 * The lease a busy marker names, or `undefined` for a name {@link slotMarker} would never have written.
 *
 * A present start stamp is only ever written from `usableStamp`, so one that does not decode to a usable stamp, or is
 * not the canonical base64url of what it decodes to, is malformed — never a slot judged by order instead.
 *
 * @param marker the marker's file name
 * @returns the lease, or `undefined`
 */
export function leaseFromMarker({ marker }: { marker: string }): SlotLease | undefined {
  const match = BUSY_MARKER.exec(marker);
  if (match === null) {
    return undefined;
  }
  const [, pid = "", startedAtMs = "", ceilingMib = "", limit = "", startToken = ""] = match;
  if (Number(startedAtMs) > MAX_DATE_MS) {
    return undefined;
  }
  const slot = {
    ceilingMib: Number(ceilingMib),
    pid: Number(pid),
    startedAtIso: new Date(Number(startedAtMs)).toISOString(),
  };
  if (startToken === "-") {
    return { limit: Number(limit), slot };
  }
  const start = Buffer.from(startToken, "base64url").toString("utf8");
  const canonical = Buffer.from(start, "utf8").toString("base64url") === startToken;
  if (!canonical || usableStamp({ text: start }) === undefined) {
    return undefined;
  }
  return { limit: Number(limit), slot: { ...slot, start } };
}

/**
 * What a lane holds, from its listing. No entries is a lane to mint — a rename replaces an empty directory — and more
 * than one was written by something other than this module, so it is never guessed free. A single marker this module
 * would never have written is malformed, and taken over by its exact name like a dead holder's.
 *
 * @param entries the lane directory's entries, or `undefined` when it does not exist
 * @returns the lane's state
 */
export function laneMarkerOf({ entries }: { entries: readonly string[] | undefined }): LaneMarker {
  if (entries === undefined || entries.length === 0) {
    return { kind: "absent" };
  }
  if (entries.length !== 1) {
    return { entries: entries.length, kind: "crowded" };
  }
  const marker = entries[0]!;
  if (marker === FREE_MARKER) {
    return { kind: "free" };
  }
  const lease = leaseFromMarker({ marker });
  return lease === undefined ? { kind: "malformed", marker } : { kind: "held", lease, marker };
}

/**
 * The filesystem half of a load-slot lane: reading every lane in a slot directory, and the renames that move one
 * between free, held and taken over. Each transition is ONE `rename(2)`, so of any number of callers making the same
 * one exactly one wins; why that makes acquisition exclusive is `./loadSlots.ts`'s module doc, and what a lane's
 * marker says is `./loadSlotMarker.ts`.
 *
 * Whether a holder still runs is injected ({@link HolderLive}) rather than decided here, so the liveness rule lives
 * once, beside the rest of the slot policy.
 */
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  FREE_MARKER,
  type LaneMarker,
  type LoadSlot,
  laneIndex,
  laneMarkerOf,
  laneName,
  leaseFromMarker,
  type SlotLease,
  slotMarker,
} from "./loadSlotMarker.js";

/** Whether a slot's holder still runs — `slotHolderLive` over the real process, in production. */
export type HolderLive = (slot: LoadSlot) => boolean;

/** A lane whose holder still runs. */
export interface LiveLease {
  readonly index: number;
  readonly marker: string;
  readonly lease: SlotLease;
}

/** Every live lease in a directory, lowest lane first, and a sentence for each lane that could not be read as one. */
export interface LaneObservation {
  readonly live: readonly LiveLease[];
  readonly obstacles: readonly string[];
}

/** What one attempt to take a lane came to: the lane won, or none, with any filesystem failure that stopped it. */
export type LaneClaim =
  | { readonly kind: "won"; readonly index: number; readonly marker: string }
  | { readonly kind: "lost"; readonly obstacles: readonly string[] };

/** How many passes over the lanes one caller makes — each miss means another caller won that lane. */
const CLAIM_PASSES = 3;

/** Whether a thrown filesystem error carries one of these errno codes. */
function errnoIn({ cause, codes }: { cause: unknown; codes: readonly string[] }): boolean {
  return cause instanceof Error && "code" in cause && typeof cause.code === "string" && codes.includes(cause.code);
}

/** A thrown value as one sentence's tail. */
function causeText({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** One lane's state, or the sentence saying why it could not be read. */
function readLane({ path }: { path: string }): LaneMarker | { readonly kind: "unreadable"; readonly why: string } {
  try {
    return laneMarkerOf({ entries: readdirSync(path) });
  } catch (cause) {
    if (errnoIn({ cause, codes: ["ENOENT"] })) {
      return laneMarkerOf({ entries: undefined });
    }
    return { kind: "unreadable", why: `${path} will not list (${causeText({ cause })})` };
  }
}

/**
 * Every lane in a slot directory, read once each. READS ONLY. A directory that does not exist holds no lanes; one
 * that will not list is an obstacle, never an empty machine.
 *
 * @param dir the slot directory
 * @param isLive whether a slot's holder still runs
 * @returns the live leases, lowest lane first, and the lanes that could not be read
 */
export function observeLanes({ dir, isLive }: { dir: string; isLive: HolderLive }): LaneObservation {
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch (cause) {
    const obstacles = errnoIn({ cause, codes: ["ENOENT"] }) ? [] : [`${dir} will not list (${causeText({ cause })})`];
    return { live: [], obstacles };
  }
  const live: LiveLease[] = [];
  const obstacles: string[] = [];
  const lanes = names.flatMap((name) => {
    const index = laneIndex({ name });
    return index === undefined ? [] : [index];
  });
  for (const index of lanes.toSorted((a, b) => a - b)) {
    const path = join(dir, laneName({ index }));
    const state = readLane({ path });
    if (state.kind === "unreadable") {
      obstacles.push(state.why);
    } else if (state.kind === "crowded") {
      obstacles.push(
        `${path} holds ${String(state.entries)} entries, which this module never writes — skipped, never guessed free`,
      );
    } else if (state.kind === "held" && isLive(state.lease.slot)) {
      live.push({ index, lease: state.lease, marker: state.marker });
    }
  }
  return { live, obstacles };
}

/**
 * Rename, reporting whether this process won it. Every contention errno — `ENOENT` (the source was already renamed
 * away), `EEXIST` and `ENOTEMPTY` (another minter's lane is there) — is a loss; anything else throws.
 */
function renameWon({ from, to }: { from: string; to: string }): boolean {
  try {
    renameSync(from, to);
    return true;
  } catch (cause) {
    if (errnoIn({ cause, codes: ["ENOENT", "EEXIST", "ENOTEMPTY"] })) {
      return false;
    }
    throw cause;
  }
}

/** Mint a lane already holding this caller's busy marker, renamed into place whole. False when another won it. */
function mintLane({ dir, marker, path }: { dir: string; marker: string; path: string }): boolean {
  const minting = mkdtempSync(join(dir, ".mint-"));
  try {
    writeFileSync(join(minting, marker), "");
    return renameWon({ from: minting, to: path });
  } finally {
    rmSync(minting, { force: true, recursive: true });
  }
}

/**
 * Try to take one lane: mint it, take it free, or take it over from a dead or malformed holder by that holder's
 * exact name. A live holder, a lane this module did not write, or a lost rename is `false`; a filesystem failure
 * that is not contention throws.
 */
function takeLane({
  dir,
  isLive,
  marker,
  path,
}: {
  dir: string;
  isLive: HolderLive;
  marker: string;
  path: string;
}): boolean {
  const state = readLane({ path });
  switch (state.kind) {
    case "absent":
      return mintLane({ dir, marker, path });
    case "free":
      return renameWon({ from: join(path, FREE_MARKER), to: join(path, marker) });
    case "malformed":
      return renameWon({ from: join(path, state.marker), to: join(path, marker) });
    case "held":
      return !isLive(state.lease.slot) && renameWon({ from: join(path, state.marker), to: join(path, marker) });
    case "crowded":
    case "unreadable":
      return false;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

/** One pass over the lanes below the lease's limit, lowest first: the lane won, or `undefined`. Throws on failure. */
function claimPass({
  dir,
  isLive,
  lease,
}: {
  dir: string;
  isLive: HolderLive;
  lease: SlotLease;
}): { readonly index: number; readonly marker: string } | undefined {
  for (let index = 0; index < lease.limit; index += 1) {
    const marker = slotMarker({ lease });
    if (takeLane({ dir, isLive, marker, path: join(dir, laneName({ index })) })) {
      return { index, marker };
    }
  }
  return undefined;
}

/**
 * Why a lease may not be acted on at all, before anything is read or written: its marker would not parse back. A NaN
 * ceiling, or a limit that is zero, negative or fractional, writes a marker every reader skips, so release could never
 * find it; and a re-entrant call under such a limit refuses with no holder or obstacle to name.
 *
 * @param lease the slot and limit a caller is about to act under
 * @returns the sentence saying so, or `undefined` for a lease whose marker reads back
 */
export function unparsableLease({ lease }: { lease: SlotLease }): string | undefined {
  const probe = slotMarker({ lease });
  if (leaseFromMarker({ marker: probe }) !== undefined) {
    return undefined;
  }
  return `${probe} is a marker no reader parses back — refused rather than written`;
}

/**
 * Take the lowest lane below the lease's limit this caller can win, making another pass while the live holders
 * leave room — a miss with room means another caller won that lane and may already have given it back.
 *
 * @param dir the slot directory, created when absent
 * @param isLive whether a slot's holder still runs
 * @param lease the slot and limit this caller's marker records
 * @returns the lane won, or none with the filesystem failure that stopped it — or, before touching the directory, the
 *   lease whose marker would not parse back (a non-integer ceiling or limit), which release could never find
 */
export function claimLane({ dir, isLive, lease }: { dir: string; isLive: HolderLive; lease: SlotLease }): LaneClaim {
  const unparsable = unparsableLease({ lease });
  if (unparsable !== undefined) {
    return { kind: "lost", obstacles: [unparsable] };
  }
  try {
    mkdirSync(dir, { recursive: true });
    for (let pass = 0; pass < CLAIM_PASSES; pass += 1) {
      const won = claimPass({ dir, isLive, lease });
      if (won !== undefined) {
        return { kind: "won", ...won };
      }
      if (observeLanes({ dir, isLive }).live.length >= lease.limit) {
        break;
      }
    }
    return { kind: "lost", obstacles: [] };
  } catch (cause) {
    return { kind: "lost", obstacles: [`${dir} would not take a lane (${causeText({ cause })})`] };
  }
}

/**
 * Give one lane back: this exact busy marker renamed to `free`. Never throws. A lane that will not rename stays held,
 * and counts as a live holder until this pid exits, so it is SAID rather than swallowed: the caller reports it.
 *
 * @param dir the slot directory
 * @param index the lane
 * @param marker the busy marker this caller placed there
 * @returns nothing when the lane was freed or the marker was already gone, else the sentence saying it is still held
 */
export function freeLane({ dir, index, marker }: { dir: string; index: number; marker: string }): readonly string[] {
  const path = join(dir, laneName({ index }));
  try {
    renameWon({ from: join(path, marker), to: join(path, FREE_MARKER) });
    return [];
  } catch (cause) {
    return [`${path} would not free (${causeText({ cause })}) — held, and counted live, until this process exits`];
  }
}

/**
 * Give back every lane naming `pid`, whatever start stamp it carries: one that is not the caller's own names an
 * earlier holder of the same pid, which is dead by construction.
 *
 * A lane that cannot be read cannot be told apart from one of `pid`'s, so it is reported too rather than passed over:
 * if it is this caller's, it stays counted live until the caller exits.
 *
 * @param dir the slot directory
 * @param pid the caller's own pid
 * @returns a sentence for each lane naming `pid` that stayed held, and for each lane that could not be read to tell;
 *   empty when every lane was read and every one of `pid`'s freed
 */
export function freeLanesOf({ dir, pid }: { dir: string; pid: number }): readonly string[] {
  const named = observeLanes({ dir, isLive: (slot) => slot.pid === pid });
  const unread = named.obstacles.map(
    (why) => `not checked for pid ${String(pid)}'s lane, so possibly still held: ${why}`,
  );
  return [...unread, ...named.live.flatMap((lane) => freeLane({ dir, index: lane.index, marker: lane.marker }))];
}

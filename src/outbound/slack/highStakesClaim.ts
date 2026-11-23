/**
 * The claim a LIVE fleet send takes on a high-stakes channel before it reads that channel's last day.
 *
 * The second-post rule (`./highStakesChannel.ts`) reads the day and then posts, a test-and-set split in two: two
 * finding cards started at the same moment both read an empty day, both pass, and both land — the double post
 * the gate exists to stop. So a live send first WRITES its own claim file under
 * `$SLOPWEAVER_HOME/ledgers/high-stakes-claims/<channel>/`, named for the instant it was taken, the writing
 * process's pid and a random id, and only then LISTS the directory: any other claim still standing refuses the
 * send. Two sends that both write before either lists each see the other and both refuse, which fails closed;
 * whichever order they run in, the later of the two lists after both files exist and sees the earlier one.
 *
 * **A claim stands for as long as the send that wrote it can still post**, which a clock alone cannot say: the
 * day read, the uploads and the post run on a `WebClient` that sleeps a rate limit away, and a laptop can sleep
 * between the claim and the post. So a claim whose writer's pid is still alive stands for the whole
 * {@link HIGH_STAKES_WINDOW_MS}, and one whose writer has exited stands only until {@link HIGH_STAKES_CLAIM_WINDOW_MS}
 * from when it was taken — the writer posted, or failed, before it exited. A reused pid holds a channel longer than it should, never shorter, and
 * the second-post hatch is the way past it.
 *
 * No send ever removes a claim another send may be relying on. A file is unlinked only by the send that wrote
 * it, or once it no longer stands, when no check counts it any more. An earlier single-file shape re-took an
 * aged-out claim by unlinking it, and a second send could unlink the claim the first had just re-created: both
 * held the channel, and after the first post that was the ordinary path.
 *
 * The one release is the gate's own, when the day it read refuses the send, so nothing was attempted.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { stateHomePaths } from "../../stateHome.js";
import { type ChannelClaim, HIGH_STAKES_CLAIM_WINDOW_MS, HIGH_STAKES_WINDOW_MS } from "./highStakesChannel.js";

/** A claim file's name: the epoch milliseconds it was taken at, the writer's pid, then a random id. */
const CLAIM_NAME = /^(\d+)-(\d+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether a process is still in the process table; the live seam is `kill(pid, 0)`. */
type ProcessAlive = (args: { pid: number }) => boolean;

/** The directory holding one channel's claims; the id is encoded so a caller's spelling can never leave it. */
function claimDir({ home, channel }: { home: string; channel: string }): string {
  return join(stateHomePaths({ home }).ledgers, "high-stakes-claims", encodeURIComponent(channel));
}

/** The message of a thrown value, for a reason line. */
function reasonOf({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}

/** One claim file standing in a channel's directory: its name, the instant its name dates it to, its writer. */
interface StandingClaim {
  readonly name: string;
  readonly takenMs: number;
  readonly pid: number;
}

/** What listing a channel's claims came to. */
type Listing =
  | { readonly kind: "listed"; readonly claims: readonly StandingClaim[] }
  | { readonly kind: "failed"; readonly reason: string };

/** Every claim file in the directory; a name this module did not write is not a claim. An absent directory is none. */
function listClaims({ dir }: { dir: string }): Listing {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { claims: [], kind: "listed" };
    }
    return { kind: "failed", reason: reasonOf({ error }) };
  }
  const claims = names.flatMap((name) => {
    const match = CLAIM_NAME.exec(name);
    return match === null ? [] : [{ name, pid: Number(match[2]), takenMs: Number(match[1]) }];
  });
  return { claims, kind: "listed" };
}

/**
 * Whether a claim still stands at `nowMs`: inside the claim window, or inside the day window while its writer is
 * alive. One dated after now stands too.
 */
function stillStands({ claim, nowMs, alive }: { claim: StandingClaim; nowMs: number; alive: ProcessAlive }): boolean {
  const age = nowMs - claim.takenMs;
  if (age < HIGH_STAKES_CLAIM_WINDOW_MS) {
    return true;
  }
  return age < HIGH_STAKES_WINDOW_MS && alive({ pid: claim.pid });
}

/** The earliest claim still standing among `claims`, or undefined when none does. */
function earliestStanding({
  claims,
  nowMs,
  alive,
}: {
  claims: readonly StandingClaim[];
  nowMs: number;
  alive: ProcessAlive;
}): StandingClaim | undefined {
  const standing = claims.filter((claim) => stillStands({ alive, claim, nowMs }));
  return standing.toSorted((a, b) => a.takenMs - b.takenMs)[0];
}

/** Remove claims that no longer stand; one already gone, or not removable, is left to the next. */
function pruneFallen({
  dir,
  claims,
  nowMs,
  alive,
}: {
  dir: string;
  claims: readonly StandingClaim[];
  nowMs: number;
  alive: ProcessAlive;
}): void {
  for (const claim of claims) {
    if (!stillStands({ alive, claim, nowMs })) {
      try {
        unlinkSync(join(dir, claim.name));
      } catch {
        // a claim that no longer stands counts for nothing, so leaving it costs only a later prune
      }
    }
  }
}

/**
 * Take a claim on the channel for a live send, or say which send holds it.
 *
 * This caller's claim file is written first and the directory listed after, so of two concurrent sends at least
 * one sees the other. When another claim stands, this caller's own file is removed again and the send is
 * `taken`. A claim that cannot be written or listed is `unwritable`, which the gate refuses on: the send could not
 * be told apart from a concurrent one.
 *
 * @param home the state home
 * @param channel the high-stakes channel's id
 * @param nowIso the instant the send is judged at, which names the claim file
 * @param pid this send's process, which keeps the claim standing while it lives
 * @param alive whether another claim's writer is still running
 * @returns held with this caller's claim id, taken naming when another send's claim began, or why it failed
 */
export function takeHighStakesClaim({
  home,
  channel,
  nowIso,
  pid,
  alive,
}: {
  home: string;
  channel: string;
  nowIso: string;
  pid: number;
  alive: ProcessAlive;
}): ChannelClaim {
  const dir = claimDir({ channel, home });
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(nowMs)) {
    return { kind: "unwritable", reason: `${nowIso} is not an instant, so no claim could be dated` };
  }
  const claimId = `${String(nowMs)}-${String(pid)}-${randomUUID()}`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, claimId), nowIso, { flag: "wx" });
  } catch (error: unknown) {
    return { kind: "unwritable", reason: reasonOf({ error }) };
  }
  const listing = listClaims({ dir });
  if (listing.kind === "failed") {
    releaseHighStakesClaim({ channel, claimId, home });
    return { kind: "unwritable", reason: listing.reason };
  }
  const others = listing.claims.filter((claim) => claim.name !== claimId);
  pruneFallen({ alive, claims: others, dir, nowMs });
  const holder = earliestStanding({ alive, claims: others, nowMs });
  if (holder !== undefined) {
    releaseHighStakesClaim({ channel, claimId, home });
    return { claimedIso: new Date(holder.takenMs).toISOString(), kind: "taken" };
  }
  return { claimId, kind: "held" };
}

/**
 * Whether another send holds a claim on the channel, taking nothing: what a dry run, a draft recorder and the
 * send's own pre-flight ask, so each refuses what the live send would.
 *
 * @param home the state home
 * @param channel the high-stakes channel's id
 * @param nowIso the instant the send is judged at
 * @param alive whether a claim's writer is still running
 * @returns taken when a claim still stands, free when none does, or why the claims could not be listed
 */
export function peekHighStakesClaim({
  home,
  channel,
  nowIso,
  alive,
}: {
  home: string;
  channel: string;
  nowIso: string;
  alive: ProcessAlive;
}): ChannelClaim {
  const listing = listClaims({ dir: claimDir({ channel, home }) });
  if (listing.kind === "failed") {
    return { kind: "unwritable", reason: listing.reason };
  }
  const holder = earliestStanding({ alive, claims: listing.claims, nowMs: Date.parse(nowIso) });
  if (holder === undefined) {
    return { kind: "free" };
  }
  return { claimedIso: new Date(holder.takenMs).toISOString(), kind: "taken" };
}

/**
 * Drop the claim this caller took, when the day it read refused the send and so nothing was attempted. Only the
 * named file goes, so another send's claim is never touched.
 *
 * @param home the state home
 * @param channel the high-stakes channel's id
 * @param claimId the id `takeHighStakesClaim` returned with `held`
 */
export function releaseHighStakesClaim({
  home,
  channel,
  claimId,
}: {
  home: string;
  channel: string;
  claimId: string;
}): void {
  try {
    unlinkSync(join(claimDir({ channel, home }), claimId));
  } catch {
    // already gone is the state this asks for
  }
}

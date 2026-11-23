/**
 * Which listed conversations a `chatgpt live-sync` run reads whole: every one the live copy does not hold, and every
 * one whose listed update moved since it was read, newest first. Pure.
 *
 * **The live copy is the resume state.** A snapshot is written the moment its conversation is read, and its manifest
 * keeps the update the listing gave it. So a run stopped part way, by a refusal, a closed laptop or its own bound,
 * leaves every chat it read held, and the next run's plan is exactly what it did not reach. No cursor or phase file
 * has to agree with the snapshots, because nothing but the snapshots is consulted.
 *
 * **Newest first** is the owner's order of value: the last month matters most, so a run cut short still holds it.
 *
 * Nothing is ever planned for removal. A conversation the listing no longer names (deleted on chatgpt.com) keeps its
 * snapshot, as an export keeps a chat deleted after it: a local history, not a mirror.
 */
import type { LiveSnapshotManifest } from "../../../corpus/chatgpt/liveSnapshotStore.js";
import type { ListedChatgptConversation } from "./listing.js";

/** What one run will read, and how much of the listing is already held as listed. */
export interface LiveSyncPlan {
  /** The conversations to read whole, newest listed update first. */
  readonly toFetch: readonly ListedChatgptConversation[];
  /** Listed conversations the live copy already holds at the update the listing gives. */
  readonly current: number;
}

/**
 * The run's plan. Pure.
 *
 * @param listed every distinct conversation the listing named
 * @param held each held conversation's manifest, by id
 * @returns the conversations to read, newest first, and how many are already current
 */
export function planLiveSync({
  listed,
  held,
}: {
  listed: readonly ListedChatgptConversation[];
  held: ReadonlyMap<string, LiveSnapshotManifest>;
}): LiveSyncPlan {
  const toFetch = listed.filter((one) => held.get(one.id)?.listedUpdatedIso !== one.updatedIso);
  return {
    current: listed.length - toFetch.length,
    toFetch: toFetch.toSorted((a, b) => b.updatedIso.localeCompare(a.updatedIso) || a.id.localeCompare(b.id)),
  };
}

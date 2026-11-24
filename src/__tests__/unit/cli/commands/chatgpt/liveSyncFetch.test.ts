/**
 * `chatgpt live-sync`'s listing and reading legs together over a throwaway live root: a walk that stops names where
 * it stopped, plans nothing and leaves no carry, while a walk that completes is carried for the next run and its plan
 * is read. The listing walk and the GET edge are plain fakes passed in; the snapshot store and the carry are real.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { type ChatgptError, ChatgptErrors } from "../../../../../cli/commands/chatgpt/errors.js";
import type { ChatgptInventory } from "../../../../../cli/commands/chatgpt/listing.js";
import { readListingCarry } from "../../../../../cli/commands/chatgpt/liveSyncCarry.js";
import { fetchLeg, type LiveSyncFetchDeps } from "../../../../../cli/commands/chatgpt/liveSyncFetch.js";
import { heldLiveManifests } from "../../../../../corpus/chatgpt/liveSnapshotStore.js";
import { err, ok, type Result, unwrap } from "../../../../../lib/result.js";
import { NO_PROTECTION } from "../../../../noProtection.js";
import { tempDir, useTempDirs } from "../../../corpus/chatgpt/ingest/harness.js";
import { bodyOf, listed, NO_PACE, tableFetch, Y } from "./liveSyncFakes.js";

useTempDirs();

const LISTED_AT = "2026-11-18T00:00:00.000Z";
const OPTIONS = { maxConversations: undefined, maxPages: 500, relist: false };

/**
 * The legs' edges over one listing answer.
 *
 * @param walk what the listing walk answers, after naming one page it asked for
 * @returns the edges
 */
function depsOver({ walk }: { walk: Result<ChatgptInventory, ChatgptError> }): LiveSyncFetchDeps {
  return {
    backoff: () => Promise.resolve(),
    listInventory: ({ deps }) => {
      deps.onPage?.({ kind: "offset", lane: "archived", offset: 28 });
      return Promise.resolve(walk);
    },
    nowIso: () => LISTED_AT,
    pacer: NO_PACE,
    protection: NO_PROTECTION,
  };
}

describe("fetchLeg", () => {
  it("names where a stopped walk stopped, plans nothing and writes no carry", async () => {
    const root = join(tempDir(), "live");
    const refusal = ChatgptErrors.httpRefused({ path: "/backend-api/conversations?offset=28", status: 429 });
    const table = tableFetch({ answers: new Map() });
    const outcome = await fetchLeg({
      deps: depsOver({ walk: err(refusal) }),
      fetchText: table.fetchText,
      held: new Map(),
      home: tempDir(),
      listStartedIso: LISTED_AT,
      options: OPTIONS,
      root,
    });
    expect(outcome.stoppedBy!.message).toBe(refusal.message);
    expect(outcome.listingStoppedAt).toEqual({ kind: "offset", lane: "archived", offset: 28 });
    expect(outcome.planned).toBe(0);
    expect(table.asked).toEqual([]);
    expect(unwrap(readListingCarry({ root }))).toBe(undefined);
  });

  it("carries a completed walk for the next run and reads what it planned", async () => {
    const root = join(tempDir(), "live");
    const table = tableFetch({
      answers: new Map<string, Result<string, ChatgptError>>([
        [`/backend-api/conversation/${Y}`, ok(bodyOf({ name: "conv-y", text: "why" }))],
      ]),
    });
    const conversations = [listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" })];
    const outcome = await fetchLeg({
      deps: depsOver({ walk: ok({ conversations, projects: [], repeats: 0, requests: 2 }) }),
      fetchText: table.fetchText,
      held: new Map(),
      home: tempDir(),
      listStartedIso: LISTED_AT,
      options: OPTIONS,
      root,
    });
    expect(outcome.stoppedBy).toBe(undefined);
    expect(outcome.listingStoppedAt).toBe(undefined);
    expect(outcome.listedSinceIso).toBe(undefined);
    expect(outcome.listingRequests).toBe(2);
    expect(outcome.read).toBe(1);
    expect([...unwrap(heldLiveManifests({ root })).keys()]).toEqual([Y]);
    expect(unwrap(readListingCarry({ root }))).toEqual({
      conversations,
      walkStartedIso: LISTED_AT,
      wholeWalkStartedIso: LISTED_AT,
    });
  });
});

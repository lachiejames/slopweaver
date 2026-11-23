/** Which listed chats a live-sync run reads: the ones not held, and the ones whose listed update moved, newest first. */
import { describe, expect, it } from "vitest";

import type { ListedChatgptConversation } from "../../../../../cli/commands/chatgpt/listing.js";
import { planLiveSync } from "../../../../../cli/commands/chatgpt/liveSyncPlan.js";
import type { LiveSnapshotManifest } from "../../../../../corpus/chatgpt/liveSnapshotStore.js";

/** One listed chat. */
function listed({ id, updatedIso }: { id: string; updatedIso: string }): ListedChatgptConversation {
  return { createdIso: "2026-01-01T00:00:00.000Z", id, lane: "active", projectId: null, title: null, updatedIso };
}

/** One held manifest, at the listed update it was read at. */
function manifest({ id, listedUpdatedIso }: { id: string; listedUpdatedIso: string }): LiveSnapshotManifest {
  return {
    bodyHash: "0".repeat(64),
    bodyUpdatedIso: listedUpdatedIso,
    bytes: 3,
    conversationId: id,
    fetchedAtIso: "2026-11-17T00:00:00.000Z",
    listedUpdatedIso,
    schemaVersion: 1,
  };
}

describe("planLiveSync", () => {
  it("reads every chat when nothing is held, newest update first, ties by id", () => {
    const plan = planLiveSync({
      held: new Map(),
      listed: [
        listed({ id: "b", updatedIso: "2026-10-01T00:00:00.000Z" }),
        listed({ id: "c", updatedIso: "2026-11-01T00:00:00.000Z" }),
        listed({ id: "a", updatedIso: "2026-10-01T00:00:00.000Z" }),
      ],
    });
    expect(plan.toFetch.map((one) => one.id)).toEqual(["c", "a", "b"]);
    expect(plan.current).toBe(0);
  });

  it("skips a chat held at its listed update and re-reads one whose update moved", () => {
    const plan = planLiveSync({
      held: new Map([
        ["a", manifest({ id: "a", listedUpdatedIso: "2026-10-01T00:00:00.000Z" })],
        ["b", manifest({ id: "b", listedUpdatedIso: "2026-10-01T00:00:00.000Z" })],
      ]),
      listed: [
        listed({ id: "a", updatedIso: "2026-10-01T00:00:00.000Z" }),
        listed({ id: "b", updatedIso: "2026-11-02T00:00:00.000Z" }),
      ],
    });
    expect(plan.toFetch.map((one) => one.id)).toEqual(["b"]);
    expect(plan.current).toBe(1);
  });

  it("plans nothing for a held chat the listing no longer names, and nothing on an empty listing", () => {
    const plan = planLiveSync({
      held: new Map([["gone", manifest({ id: "gone", listedUpdatedIso: "2026-10-01T00:00:00.000Z" })]]),
      listed: [],
    });
    expect(plan).toEqual({ current: 0, toFetch: [] });
  });
});

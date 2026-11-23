/*
 * `fetchSlackActivity` — what the crawl enumerates and shapes, the window and cursor bounds it reads each channel
 * between, the thread cursors it advances, and which failures sink it. It moved here when `fetch.test.ts` was split
 * by behaviour.
 */
import { describe, expect, it } from "vitest";

import { fetchSlackActivity, type SlackApi } from "../../../../../corpus/slack/fetch.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { fakeApi, type HistoryCall, window } from "./harness.js";

describe("fetchSlackActivity", () => {
  it("enumerates EVERY channel (not just member ones) and shapes messages + reactions + files + replies", async () => {
    const result = unwrap(await fetchSlackActivity({ api: fakeApi({ calls: [] }), window }));
    expect(result.retainedChannels.map((c) => c.channelId)).toEqual(["C_A", "C_B"]); // C_B kept despite is_member:false
    const channel = result.retainedChannels[0]!;
    expect(channel.messages[0]!.reactions).toEqual([":+1: x2"]);
    expect(channel.messages[0]!.files.map((f) => f.id)).toEqual(["F1"]);
    expect(channel.messages[0]!.permalink).toBe("https://acme.slack.com/archives/C_A/p1700000000000100");
    expect(channel.replies).toHaveLength(1);
    expect(channel.replies[0]!.ts).toBe("1700000100.000200");
  });

  it("keeps raw Slack message, reply, and file objects on shaped items", async () => {
    const result = unwrap(await fetchSlackActivity({ api: fakeApi({ calls: [] }), window }));
    const message = result.retainedChannels[0]!.messages[0]!;
    const reply = result.retainedChannels[0]!.replies[0]!;
    expect(message.raw).toEqual({
      files: [{ id: "F1", mimetype: "image/png", title: "pic.png", user: "U2" }],
      reactions: [{ count: 2, name: "+1" }],
      reply_count: 1,
      text: "hello team, see #12",
      ts: "1700000000.000100",
      user: "U1",
    });
    expect(message.files[0]!.raw).toEqual({ id: "F1", mimetype: "image/png", title: "pic.png", user: "U2" });
    expect(reply.raw).toEqual({ text: "a reply", ts: "1700000100.000200", user: "U2" });
  });

  it("builds the id→name user + channel maps once and captures each file's uploader id", async () => {
    const result = unwrap(await fetchSlackActivity({ api: fakeApi({ calls: [] }), window }));
    expect(result.maps.userNames).toEqual({ U1: "Ada", U2: "grace" }); // display_name wins, else name
    expect(result.maps.channelNames).toEqual({ C_A: "alpha", C_B: "beta" }); // from discovery (every channel)
    expect(result.retainedChannels[0]!.messages[0]!.files[0]!.user).toBe("U2"); // uploader id threaded for author resolution
  });

  it("keeps the user directory non-fatal: a users.list failure warns but still returns channels", async () => {
    const api: SlackApi = {
      ...fakeApi({ calls: [] }),
      listUsers: async () => {
        throw new Error("ratelimited");
      },
    };
    const result = unwrap(await fetchSlackActivity({ api, window }));
    expect(result.retainedChannels.map((c) => c.channelId)).toEqual(["C_A", "C_B"]);
    expect(result.maps.userNames).toEqual({});
    expect(result.warnings.some((w) => w.includes("user directory unavailable"))).toBe(true);
  });

  it("passes BOTH oldest and latest window bounds to conversations.history for a backfilled channel", async () => {
    const calls: HistoryCall[] = [];
    await fetchSlackActivity({
      api: fakeApi({ calls }),
      // Both channels are pinned to the window's own floor by their cursors, which is the only shape in
      // which this assertion is about the window's `oldest` at all — `latest` is the window's either way.
      channelCursors: new Map([
        ["C_A", { cursor: "2023-11-01T00:00:00.000Z" }],
        ["C_B", { cursor: "2023-11-01T00:00:00.000Z" }],
      ]),
      window,
    });
    expect(calls.length).toBeGreaterThan(0);
    // the `since` day → 1698796800 ; the `until` day → 1701388800 (epoch seconds)
    expect(calls.every((c) => c.oldest === "1698796800")).toBe(true);
    expect(calls.every((c) => c.latest === "1701388800")).toBe(true);
    expect(calls.every((c) => c.latest !== "" && c.latest !== "9999999999")).toBe(true);
  });

  it("backfills a channel with NO stored cursor from the epoch, still bounded by the window's latest", async () => {
    const calls: HistoryCall[] = [];
    await fetchSlackActivity({ api: fakeApi({ calls }), window });
    expect(calls.map((c) => c.oldest)).toEqual(["0", "0"]);
    expect(calls.every((c) => c.latest === "1701388800")).toBe(true);
  });

  it("honours an explicit window over the epoch backfill when the caller pinned one", async () => {
    const calls: HistoryCall[] = [];
    await fetchSlackActivity({ api: fakeApi({ calls }), backfillNewChannels: false, window });
    expect(calls.map((c) => c.oldest)).toEqual(["1698796800", "1698796800"]);
  });

  it("reads a channel from its OWN cursor when the pooled window floor would skip past it", async () => {
    const calls: HistoryCall[] = [];
    await fetchSlackActivity({
      api: fakeApi({ calls }),
      channelCursors: new Map([
        ["C_A", { cursor: "2023-11-15T00:00:00.000Z" }],
        ["C_B", { cursor: "2023-10-01T00:00:00.000Z" }],
      ]),
      window,
    });
    // Each channel reads from its OWN cursor — one ahead of the pooled floor, one behind it.
    expect(calls.map((c) => c.oldest)).toEqual(["1700006400", "1696118400"]);
  });

  it("reports every VISITED channel, including one that turned out to hold nothing", async () => {
    const result = unwrap(await fetchSlackActivity({ api: fakeApi({ calls: [] }), window }));
    expect(result.visitedChannels).toEqual(["C_A", "C_B"]); // C_B returns no messages, and is still visited
  });

  it("omits a channel whose history threw from the visited list, so it stays eligible for a backfill", async () => {
    const result = unwrap(await fetchSlackActivity({ api: fakeApi({ calls: [], failChannel: "C_A" }), window }));
    expect(result.visitedChannels).toEqual(["C_B"]);
  });

  it("returns every DISCOVERED channel so a caller can measure reach against what it crawled", async () => {
    const result = unwrap(await fetchSlackActivity({ api: fakeApi({ calls: [] }), window }));
    expect(result.discovered.map((c) => c.id)).toEqual(["C_A", "C_B"]);
  });

  it("skips an unreadable channel with a warning without sinking the others", async () => {
    const result = unwrap(await fetchSlackActivity({ api: fakeApi({ calls: [], failChannel: "C_A" }), window }));
    expect(result.retainedChannels.map((c) => c.channelId)).toEqual(["C_B"]); // C_A skipped, C_B still ingested
    expect(result.warnings.some((w) => w.includes("C_A") && w.includes("not_in_channel"))).toBe(true);
  });

  it("reads a thread's replies incrementally from its stored cursor and advances it", async () => {
    const replyOldest: string[] = [];
    // Stored cursor sits between the parent (…100) and the reply (…200): the reply is new, the cursor advances.
    const cursors = { "C_A:1700000000.000100": { ts: "1700000050.000000" } };
    const result = unwrap(
      await fetchSlackActivity({ api: fakeApi({ calls: [], replyOldest }), threadCursors: cursors, window }),
    );
    expect(replyOldest).toContain("1700000050.000000"); // replies fetched FROM the stored cursor, not the window
    expect(result.retainedChannels[0]!.replies).toHaveLength(1);
    expect(result.threadCursors["C_A:1700000000.000100"]!.ts).toBe("1700000100.000200"); // advanced to newest reply
  });

  it("re-polls a KNOWN thread whose parent is OUT of the window (off-window delta still caught)", async () => {
    const replyOldest: string[] = [];
    // C_B's history window returns NO parent, but the store has a cursor for an older thread in C_B.
    const cursors = { "C_B:1699000000.000000": { ts: "1699500000.000000" } };
    const result = unwrap(
      await fetchSlackActivity({ api: fakeApi({ calls: [], replyOldest }), threadCursors: cursors, window }),
    );
    const cB = result.retainedChannels.find((c) => c.channelId === "C_B")!;
    expect(cB.replies.map((r) => r.threadTs)).toContain("1699000000.000000"); // the off-window thread's new reply
    expect(replyOldest).toContain("1699500000.000000"); // fetched FROM the stored cursor, not the window
    expect(result.threadCursors["C_B:1699000000.000000"]!.ts).toBe("1700000100.000200"); // cursor advanced
  });

  it("re-reads nothing new when the cursor is already at the latest reply", async () => {
    const cursors = { "C_A:1700000000.000100": { ts: "1700000100.000200" } };
    const result = unwrap(await fetchSlackActivity({ api: fakeApi({ calls: [] }), threadCursors: cursors, window }));
    expect(result.retainedChannels[0]!.replies).toHaveLength(0); // the boundary reply is dropped — nothing new
  });

  it("honours an explicit channel filter", async () => {
    const result = unwrap(
      await fetchSlackActivity({ api: fakeApi({ calls: [] }), channelFilter: ["C_MISSING"], window }),
    );
    expect(result.retainedChannels).toHaveLength(0);
  });

  it("is fatal (FETCH_FAILED) when channel discovery throws", async () => {
    const api: SlackApi = {
      ...fakeApi({ calls: [] }),
      listChannels: async () => {
        throw new Error("missing_scope");
      },
    };
    const result = await fetchSlackActivity({ api, window });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("FETCH_FAILED");
    expect(unwrapErr(result).message).toBe("channel discovery failed: missing_scope");
  });

  it("is fatal (WORKSPACE_URL_UNRESOLVED) when auth.test resolves with no team URL", async () => {
    const api: SlackApi = { ...fakeApi({ calls: [] }), workspaceUrl: async () => undefined };
    const result = await fetchSlackActivity({ api, window });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("WORKSPACE_URL_UNRESOLVED");
  });
});

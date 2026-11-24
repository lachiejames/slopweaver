/**
 * `chatgpt live-sync`'s reading leg over a throwaway live root: each planned chat read whole and held in the order
 * planned, a body older than its listing held at its own update, the first refusal stopping every further request, a
 * chat the account no longer has skipped, and the owner's protect list refusing the write. The GET edge is a plain
 * fake passed in; the snapshot store is real.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { type ChatgptError, ChatgptErrors } from "../../../../../cli/commands/chatgpt/errors.js";
import { bodyBehindListing, readPlannedConversations } from "../../../../../cli/commands/chatgpt/liveSyncRead.js";
import type { OwnerProtectionResolver } from "../../../../../corpus/bronzeProtection.js";
import { conversationDir, heldLiveManifests } from "../../../../../corpus/chatgpt/liveSnapshotStore.js";
import { err, ok, type Result, unwrap } from "../../../../../lib/result.js";
import { chatId } from "../../../../chatgptFixture.js";
import { UNPROTECTED } from "../../../../noProtection.js";
import { tempDir, useTempDirs } from "../../../corpus/chatgpt/ingest/harness.js";
import { bodyOf, listed, NO_PACE, STALE_UPDATE, tableFetch, Y, Z } from "./liveSyncFakes.js";

useTempDirs();

describe("readPlannedConversations", () => {
  it("holds each chat as it is read, in the order planned", async () => {
    const root = join(tempDir(), "live");
    const table = tableFetch({
      answers: new Map<string, Result<string, ChatgptError>>([
        [`/backend-api/conversation/${Y}`, ok(bodyOf({ name: "conv-y", text: "why" }))],
        [`/backend-api/conversation/${Z}`, ok(bodyOf({ name: "conv-z", text: "zed" }))],
      ]),
    });
    const outcome = await readPlannedConversations({
      ...UNPROTECTED,
      fetchText: table.fetchText,
      nowIso: () => "2026-11-18T00:00:00.000Z",
      onProgress: () => undefined,
      pacer: NO_PACE,
      root,
      toRead: [
        listed({ id: Z, updatedIso: "2026-11-02T00:00:00.000Z" }),
        listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" }),
      ],
    });
    expect(outcome).toEqual({ behind: 0, gone: [], read: 2, stoppedBy: undefined });
    expect(table.asked).toEqual([`/backend-api/conversation/${Z}`, `/backend-api/conversation/${Y}`]);
    const held = unwrap(heldLiveManifests({ root }));
    expect(held.get(Z)!.listedUpdatedIso).toBe("2026-11-02T00:00:00.000Z");
    expect(held.get(Y)!.bodyUpdatedIso).toBe("2026-11-06T21:20:00.000Z");
  });

  it("holds a body older than its listing at the body's own update, so the next plan reads it again", async () => {
    const root = join(tempDir(), "live");
    const table = tableFetch({
      answers: new Map<string, Result<string, ChatgptError>>([
        [`/backend-api/conversation/${Y}`, ok(bodyOf({ name: "conv-y", text: "why", updateTime: STALE_UPDATE }))],
      ]),
    });
    const outcome = await readPlannedConversations({
      ...UNPROTECTED,
      fetchText: table.fetchText,
      nowIso: () => "2026-11-18T00:00:00.000Z",
      onProgress: () => undefined,
      pacer: NO_PACE,
      root,
      toRead: [listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" })],
    });
    expect(outcome).toEqual({ behind: 1, gone: [], read: 1, stoppedBy: undefined });
    expect(unwrap(heldLiveManifests({ root })).get(Y)!.listedUpdatedIso).toBe("2026-09-22T18:00:00.000Z");
  });

  it("stops at the first refusal, keeping what it held and asking for nothing after", async () => {
    const root = join(tempDir(), "live");
    const third = chatId({ name: "conv-x" });
    const table = tableFetch({
      answers: new Map<string, Result<string, ChatgptError>>([
        [`/backend-api/conversation/${Z}`, ok(bodyOf({ name: "conv-z", text: "zed" }))],
        [
          `/backend-api/conversation/${Y}`,
          err(ChatgptErrors.httpRefused({ path: `/backend-api/conversation/${Y}`, status: 429 })),
        ],
      ]),
    });
    const outcome = await readPlannedConversations({
      ...UNPROTECTED,
      fetchText: table.fetchText,
      nowIso: () => "2026-11-18T00:00:00.000Z",
      onProgress: () => undefined,
      pacer: NO_PACE,
      root,
      toRead: [
        listed({ id: Z, updatedIso: "2026-11-03T00:00:00.000Z" }),
        listed({ id: Y, updatedIso: "2026-11-02T00:00:00.000Z" }),
        listed({ id: third, updatedIso: "2026-11-01T00:00:00.000Z" }),
      ],
    });
    expect(outcome.read).toBe(1);
    expect(outcome.stoppedBy!.code).toBe("HTTP_REFUSED");
    expect(table.asked).toEqual([`/backend-api/conversation/${Z}`, `/backend-api/conversation/${Y}`]);
    expect([...unwrap(heldLiveManifests({ root })).keys()]).toEqual([Z]);
  });

  it("skips a chat ChatGPT no longer has, naming it, and still reads every chat after it", async () => {
    const root = join(tempDir(), "live");
    const table = tableFetch({
      answers: new Map<string, Result<string, ChatgptError>>([
        [`/backend-api/conversation/${Y}`, ok(bodyOf({ name: "conv-y", text: "why" }))],
        [
          `/backend-api/conversation/${Z}`,
          err(ChatgptErrors.httpRefused({ path: `/backend-api/conversation/${Z}`, status: 404 })),
        ],
      ]),
    });
    const outcome = await readPlannedConversations({
      ...UNPROTECTED,
      fetchText: table.fetchText,
      nowIso: () => "2026-11-18T00:00:00.000Z",
      onProgress: () => undefined,
      pacer: NO_PACE,
      root,
      toRead: [
        listed({ id: Z, updatedIso: "2026-11-02T00:00:00.000Z" }),
        listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" }),
      ],
    });
    expect(outcome).toEqual({ behind: 0, gone: [Z], read: 1, stoppedBy: undefined });
    expect([...unwrap(heldLiveManifests({ root })).keys()]).toEqual([Y]);
  });

  it("stops on a body that does not read, holding nothing for it", async () => {
    const root = join(tempDir(), "live");
    const table = tableFetch({
      answers: new Map<string, Result<string, ChatgptError>>([
        [`/backend-api/conversation/${Y}`, ok(JSON.stringify({ surprise: true }))],
      ]),
    });
    const outcome = await readPlannedConversations({
      ...UNPROTECTED,
      fetchText: table.fetchText,
      nowIso: () => "2026-11-18T00:00:00.000Z",
      onProgress: () => undefined,
      pacer: NO_PACE,
      root,
      toRead: [listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" })],
    });
    expect(outcome.read).toBe(0);
    expect(outcome.stoppedBy!.code).toBe("PAGE_MALFORMED");
    expect(unwrap(heldLiveManifests({ root })).size).toBe(0);
  });

  it("stops on a live copy the owner's list marks read-only, writing nothing of the chat it read", async () => {
    const root = join(tempDir(), "live");
    const table = tableFetch({
      answers: new Map<string, Result<string, ChatgptError>>([
        [`/backend-api/conversation/${Y}`, ok(bodyOf({ name: "conv-y", text: "why" }))],
      ]),
    });
    const protection: OwnerProtectionResolver = () =>
      ok([{ addedIso: "2026-11-01T00:00:00.000Z", mode: "read-only", path: root, why: "kept as it is" }]);
    const outcome = await readPlannedConversations({
      fetchText: table.fetchText,
      home: tempDir(),
      nowIso: () => "2026-11-18T00:00:00.000Z",
      onProgress: () => undefined,
      pacer: NO_PACE,
      protection,
      root,
      toRead: [listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" })],
    });
    const directory = conversationDir({ conversationId: Y, root });
    expect(outcome.read).toBe(0);
    expect(outcome.stoppedBy!.message).toBe(
      `chatgpt: refusing to hold the live snapshot in ${directory}: it would write to ${directory}, which the ` +
        `owner's protect list marks read-only at ${root} (kept as it is) — nothing was written`,
    );
    expect(existsSync(root)).toBe(false);
  });
});

describe("bodyBehindListing", () => {
  it("is true only for a body strictly older than its listing", () => {
    const listedUpdatedIso = "2026-11-17T14:11:57.662Z";
    expect(
      [null, "2026-11-17T14:12:01.825Z", listedUpdatedIso, "2026-11-17T14:11:57.661Z"].map((bodyUpdatedIso) =>
        bodyBehindListing({ bodyUpdatedIso, listedUpdatedIso }),
      ),
    ).toEqual([false, false, false, true]);
  });
});

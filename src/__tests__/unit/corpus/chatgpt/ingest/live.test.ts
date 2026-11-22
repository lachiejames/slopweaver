/**
 * The live copy read beside every held export: a chat held both ways weighs as ONE conversation with two versions and
 * is stored once, a home holding only the live copy refreshes from it, and a snapshot that does not stand refuses.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OwnerProtectionResolver } from "../../../../../corpus/bronzeProtection.js";
import { exportConversationInput, liveConversationInput } from "../../../../../corpus/chatgpt/conversationInput.js";
import { indexVersions } from "../../../../../corpus/chatgpt/conversationMerge.js";
import { heldLiveSnapshots } from "../../../../../corpus/chatgpt/liveSnapshotStore.js";
import { writeLiveSnapshot } from "../../../../../corpus/chatgpt/liveSnapshotWrite.js";
import { readCorpusDir } from "../../../../../corpus/corpusDirRead.js";
import { bronzeSourceDir } from "../../../../../corpus/corpusPaths.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { chatId } from "../../../../chatgptFixture.js";
import { UNPROTECTED } from "../../../../noProtection.js";
import { bronzeTexts, conversation, liveBody, liveRootOf, refreshOf, takeAt, tempDir, useTempDirs } from "./harness.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

useTempDirs();

/** Hold one conversation in the home's live copy as the live sync would, from its export-shaped element. */
function holdLive({ home, chat }: { home: string; chat: Record<string, unknown> }): string {
  const manifest = unwrap(
    writeLiveSnapshot({
      ...UNPROTECTED,
      bodyUpdatedIso: null,
      conversationId: String(chat["id"]),
      elementText: JSON.stringify(liveBody({ chat })),
      fetchedAtIso: "2026-11-17T00:00:00.000Z",
      listedUpdatedIso: null,
      root: liveRootOf({ home }),
    }),
  );
  return join(liveRootOf({ home }), "snapshots", manifest.conversationId, `${manifest.bodyHash}.json`);
}

describe("the live copy beside a held export", () => {
  it("weighs an export copy and a live copy of one chat as one version, and stores its message once", async () => {
    const home = tempDir();
    const root = join(home, "exports");
    const chat = conversation({ id: "conv-y", text: "every word", title: "Y", updateTime: 1790100000 });
    const stored = takeAt({ acquiredIso: "2026-10-01T00:00:00.000Z", chats: [chat], root });
    const liveFile = holdLive({ chat, home });
    const versions = indexVersions({
      inputs: [exportConversationInput({ stored }), liveConversationInput({ files: [liveFile] })],
    }).versions.get(chatId({ name: "conv-y" }))!;
    expect(versions.map((one) => one.inputKey)).toEqual([stored.contentHash, "live"]);
    expect(versions[1]!.digest).toBe(versions[0]!.digest);
    expect([...versions[1]!.messages]).toEqual([...versions[0]!.messages]);
    const run = unwrap(await refreshOf({ home, root }).run());
    expect(run.gaps).toEqual([]);
    expect(run.notes![1]!).toBe(
      "read the live copy: 0 conversation(s) from 1 snapshot(s), 0 message(s) projected, 0 withheld as not part " +
        "of what the owner saw, 1 conversation(s) left to the copy holding their latest version",
    );
    const records = unwrap(
      readCorpusDir({ dir: bronzeSourceDir({ home, source: "chatgpt" }), home, protection: NO_ENTRIES }),
    ).records;
    expect(records.map((record) => [record.sourceId, record.text])).toEqual([
      [`${chatId({ name: "conv-y" })}:m`, "every word"],
    ]);
  });

  it("writes a live copy that moved past the export from the live copy", async () => {
    const home = tempDir();
    const root = join(home, "exports");
    takeAt({
      acquiredIso: "2026-10-01T00:00:00.000Z",
      chats: [conversation({ id: "conv-y", text: "first", updateTime: 1790000000 })],
      root,
    });
    holdLive({ chat: conversation({ id: "conv-y", text: "second", updateTime: 1790100000 }), home });
    const run = unwrap(await refreshOf({ home, root }).run());
    expect(run.gaps).toEqual([]);
    expect(bronzeTexts({ home })).toEqual(["second"]);
  });

  it("refreshes a home that holds the live copy and no export", async () => {
    const home = tempDir();
    holdLive({ chat: conversation({ id: "conv-y", text: "from the phone", updateTime: 1790100000 }), home });
    const run = unwrap(await refreshOf({ home, root: join(home, "exports") }).run());
    expect(run.notes).toEqual([
      "read the live copy: 1 conversation(s) from 1 snapshot(s), 1 message(s) projected, 0 withheld as not part " +
        "of what the owner saw",
    ]);
    expect(bronzeTexts({ home })).toEqual(["from the phone"]);
  });

  it("refuses the whole refresh when a held snapshot no longer holds the bytes its manifest names", async () => {
    const home = tempDir();
    const file = holdLive({ chat: conversation({ id: "conv-y", updateTime: 1790100000 }), home });
    expect(unwrap(heldLiveSnapshots({ root: liveRootOf({ home }) })).length).toBe(1);
    writeFileSync(file, "[]\n");
    const refused = unwrapErr(await refreshOf({ home, root: join(home, "exports") }).run());
    expect(refused[0]).toContain("no longer holds the bytes its manifest names");
    expect(refused[0]).toContain("does not stand as written");
  });
});

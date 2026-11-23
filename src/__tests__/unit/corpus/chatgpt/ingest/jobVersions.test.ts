/**
 * Which version of a chat the `refresh --source chatgpt` job writes when more than one held export carries it: the
 * newer one by its own update, never an older title, a gap rather than a guess when the versions cannot be told
 * apart — and a local history rather than a mirror, so a conversation missing from a newer export stays.
 */
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type { OwnerProtectionResolver } from "../../../../../corpus/bronzeProtection.js";
import { ChatgptConversationErrors } from "../../../../../corpus/chatgpt/errors.js";
import { writeReceipt } from "../../../../../corpus/chatgpt/exportReceipts.js";
import { importChatgptExport } from "../../../../../corpus/chatgpt/exportStore.js";
import { chatgptIngestJob } from "../../../../../corpus/chatgpt/ingest.js";
import { readCorpusDir } from "../../../../../corpus/corpusDirRead.js";
import { bronzeSourceDir } from "../../../../../corpus/corpusPaths.js";
import { createBronzeCommitter } from "../../../../../corpus/corpusWriter.js";
import { latestRecords } from "../../../../../corpus/latestRecords.js";
import { ok, unwrap } from "../../../../../lib/result.js";
import { chatId, FUTURE, syntheticExportAt, syntheticFileAlone } from "../../../../chatgptFixture.js";
import { bronzeTexts, conversation, NO_ZIP, refreshOf, takeAt, tempDir, useTempDirs, WINDOW } from "./harness.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

/** The synthetic export, dated past every clock here so an import dates it at its own `nowIso`. */
const FIXTURE = syntheticExportAt({ modifiedIso: FUTURE });

useTempDirs();

describe("chatgptIngestJob", () => {
  it("never lets an older snapshot taken in later land an old title over the newer one's", async () => {
    const home = tempDir();
    const exportsRoot = join(home, "exports");
    const take = ({ chats, nowIso }: { chats: Record<string, unknown>[]; nowIso: string }): string => {
      const dir = tempDir();
      writeFileSync(join(dir, "conversations.json"), JSON.stringify(chats));
      return unwrap(importChatgptExport({ archive: NO_ZIP, from: dir, nowIso, root: exportsRoot })).stored.contentHash;
    };
    const run = async (): Promise<readonly string[]> =>
      unwrap(
        await chatgptIngestJob({
          deps: {
            committer: createBronzeCommitter({ home, protection: NO_ENTRIES, window: WINDOW }),
            exportsRoot,
            liveRoot: join(home, "live"),
          },
          home,
          window: WINDOW,
        }).run(),
      ).notes!;
    const newer = take({
      chats: [conversation({ id: "conv-lease", text: "settled", title: "Lease, settled", updateTime: 1790300000 })],
      nowIso: "2026-10-01T00:00:00.000Z",
    });
    await run();
    unwrap(writeReceipt({ contentHash: newer, nowIso: "2026-10-01T01:00:00.000Z", root: exportsRoot }));
    take({
      chats: [
        conversation({ id: "conv-lease", text: "draft", title: "Lease, draft", updateTime: 1790000000 }),
        conversation({ id: "conv-garden", title: "Garden", updateTime: 1790000000 }),
      ],
      nowIso: "2026-10-17T00:00:00.000Z",
    });
    const notes = await run();
    expect(notes[1]!).toContain("1 conversation(s) left to the copy holding their latest version");
    const bronze = unwrap(
      readCorpusDir({ dir: bronzeSourceDir({ home, source: "chatgpt" }), home, protection: NO_ENTRIES }),
    ).records;
    expect(bronze.map((record) => record.title!).toSorted()).toEqual(["Garden", "Lease, settled"]);
  });

  it("is a local history, not a mirror: a conversation missing from a newer export stays in bronze", async () => {
    // The owner deletes the garden and CSV chats on chatgpt.com, then downloads again: the newer export carries only the
    // lease chat. Even with the older export moved aside, so the newer one is all a refresh reads, nothing new is
    // written and nothing is forgotten — removing a record is store content removal, by hand
    // (corpus/chatgpt/ingest.ts § A whole snapshot, every run).
    const home = tempDir();
    const exportsRoot = join(home, "exports");
    const earlier = unwrap(
      importChatgptExport({ archive: NO_ZIP, from: FIXTURE, nowIso: "2026-10-01T00:00:00.000Z", root: exportsRoot }),
    );
    const first = chatgptIngestJob({
      deps: {
        committer: createBronzeCommitter({ home, protection: NO_ENTRIES, window: WINDOW }),
        exportsRoot,
        liveRoot: join(home, "live"),
      },
      home,
      window: WINDOW,
    });
    unwrap(await first.run());
    rmSync(earlier.stored.directory, { force: true, recursive: true });
    unwrap(
      importChatgptExport({
        archive: NO_ZIP,
        from: syntheticFileAlone({ member: "conversations-001.json", modifiedIso: FUTURE }),
        nowIso: "2026-10-17T00:00:00.000Z",
        root: exportsRoot,
      }),
    );
    const second = chatgptIngestJob({
      deps: {
        committer: createBronzeCommitter({ home, protection: NO_ENTRIES, window: WINDOW }),
        exportsRoot,
        liveRoot: join(home, "live"),
      },
      home,
      window: WINDOW,
    });
    const run = unwrap(await second.run());
    expect(run.projectedPerContainer).toBe(2);
    expect(run.committedPerContainer).toBe(0);
    const conversations = new Set(
      unwrap(
        readCorpusDir({ dir: bronzeSourceDir({ home, source: "chatgpt" }), home, protection: NO_ENTRIES }),
      ).records.map((record) => record.attrs?.["conversationId"]),
    );
    expect([...conversations].map(String).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "a0000100-0000-4000-8000-000000000107",
      "a0000100-0000-4000-8000-000000000108",
      "a0000100-0000-4000-8000-000000000109",
    ]);
  });

  it("writes the newer version of a chat when the later export deleted the chat that ran latest", async () => {
    // Export A holds X, touched last, and Y. The owner deletes X, adds to Y, and exports B. A still runs latest account-wide,
    // so the chronology calls it the newest export — and Y must still come from B.
    const home = tempDir();
    const root = join(home, "exports");
    const a = takeAt({
      acquiredIso: "2026-10-01T00:00:00.000Z",
      chats: [
        conversation({ id: "conv-x", text: "x", updateTime: 1790900000 }),
        conversation({ id: "conv-y", text: "y, first", updateTime: 1790000000 }),
      ],
      root,
    });
    takeAt({
      acquiredIso: "2026-10-05T00:00:00.000Z",
      chats: [conversation({ id: "conv-y", text: "y, second", updateTime: 1790100000 })],
      root,
    });
    const run = unwrap(await refreshOf({ home, root }).run());
    expect(run.gaps).toEqual([]);
    expect(run.notes![0]!).toContain(`read export ${a.contentHash.slice(0, 12)}`);
    expect(run.notes![0]!).toContain("1 conversation(s) left to the copy holding their latest version");
    expect(bronzeTexts({ home })).toEqual(["x", "y, second"]);
  });

  it("writes the newer version of a chat when a copied older export ties on activity and the owner came by it later", async () => {
    // Both exports run to the same latest chat, and the older one's file was renewed by a copy, so the chronology
    // calls the older one newest. Y's own update still decides which of its versions is written.
    const home = tempDir();
    const root = join(home, "exports");
    const x = conversation({ id: "conv-x", text: "x", updateTime: 1790900000 });
    takeAt({
      acquiredIso: "2026-10-10T00:00:00.000Z",
      chats: [x, conversation({ id: "conv-y", text: "y, first", updateTime: 1790000000 })],
      root,
    });
    takeAt({
      acquiredIso: "2026-10-05T00:00:00.000Z",
      chats: [x, conversation({ id: "conv-y", text: "y, second", updateTime: 1790100000 })],
      root,
    });
    const run = unwrap(await refreshOf({ home, root }).run());
    expect(run.gaps).toEqual([]);
    expect(bronzeTexts({ home })).toEqual(["x", "y, second"]);
  });

  it.each([
    {
      copies: [conversation({ contentType: "hologram", id: "conv-y", updateTime: 1790100000 })],
      gap:
        "chatgpt: 1 message(s) carry the content kind `hologram`, which this reader does not know — " +
        "not stored; teach `corpus/chatgpt/exportMessage.ts` the kind",
      what: "a message of a kind it does not know",
      written: ["x", "y"],
    },
    {
      copies: [conversation({ createTime: null, id: "conv-y", updateTime: 1790100000 })],
      gap: `chatgpt: conversation ${chatId({ name: "conv-y" })} has 1 message(s) with no instant on them or the conversation`,
      what: "a message with no instant",
      written: ["x", "y"],
    },
    {
      // Which of B's two copies is B's version cannot be told, so Y is written from no export at all.
      copies: [
        conversation({ id: "conv-y", text: "one", updateTime: 1790100000 }),
        conversation({ id: "conv-y", text: "two", updateTime: 1790100000 }),
      ],
      gap: `chatgpt: conversation ${chatId({ name: "conv-y" })} appears twice in the export with different content`,
      what: "the chat twice with different content",
      written: ["x"],
    },
  ])("fails coverage on $what in a copy left to another export", async ({ copies, gap, written }) => {
    // Export A runs latest account-wide and holds Y's later version, so B's copy of Y is never written — and what
    // B's copy carries must still be named, never passed over with it.
    const home = tempDir();
    const root = join(home, "exports");
    takeAt({
      acquiredIso: "2026-10-01T00:00:00.000Z",
      chats: [
        conversation({ id: "conv-x", text: "x", updateTime: 1790900000 }),
        conversation({ id: "conv-y", text: "y", updateTime: 1790200000 }),
      ],
      root,
    });
    takeAt({ acquiredIso: "2026-10-05T00:00:00.000Z", chats: copies, root });
    const run = unwrap(await refreshOf({ home, root }).run());
    expect(run.gaps!.map((one) => one.message)).toEqual([gap]);
    expect(bronzeTexts({ home })).toEqual(written);
  });

  it("writes a chat renamed and renamed back again, so bronze's latest view holds the name it has now", async () => {
    const home = tempDir();
    const root = join(home, "exports");
    const named = [
      { acquiredIso: "2026-10-01T00:00:00.000Z", title: "Tomatoes", updateTime: 1790100000 },
      { acquiredIso: "2026-10-02T00:00:00.000Z", title: "Garden", updateTime: 1790200000 },
      { acquiredIso: "2026-10-03T00:00:00.000Z", title: "Tomatoes", updateTime: 1790300000 },
    ];
    const titles: (string | undefined)[] = [];
    for (const { acquiredIso, title, updateTime } of named) {
      takeAt({ acquiredIso, chats: [conversation({ id: "conv-y", title, updateTime })], root });
      unwrap(await refreshOf({ home, root }).run());
      const stored = unwrap(
        readCorpusDir({ dir: bronzeSourceDir({ home, source: "chatgpt" }), home, protection: NO_ENTRIES }),
      ).records;
      titles.push(latestRecords({ records: stored })[0]!.title);
    }
    expect(titles).toEqual(["Tomatoes", "Garden", "Tomatoes"]);
  });

  it("writes no older copy of a chat whose copy in another export will not parse, since that one may be the latest", async () => {
    const home = tempDir();
    const root = join(home, "exports");
    takeAt({
      acquiredIso: "2026-10-01T00:00:00.000Z",
      chats: [
        conversation({ id: "conv-x", text: "x", updateTime: 1790900000 }),
        conversation({ id: "conv-y", text: "stale", updateTime: 1790100000 }),
      ],
      root,
    });
    const unreadable = {
      ...conversation({ id: "conv-y", text: "latest", updateTime: 1790200000 }),
      current_node: null,
    };
    takeAt({ acquiredIso: "2026-10-05T00:00:00.000Z", chats: [unreadable], root });
    const run = unwrap(await refreshOf({ home, root }).run());
    expect(run.gaps!.map((one) => one.message)).toEqual([
      `chatgpt: conversation ${chatId({ name: "conv-y" })} will not parse — ${ChatgptConversationErrors.leafAbsent({ conversationId: chatId({ name: "conv-y" }) }).message}`,
    ]);
    expect(bronzeTexts({ home })).toEqual(["x"]);
  });

  it("fails coverage on two differing versions of a chat with the same update, writing neither", async () => {
    const home = tempDir();
    const root = join(home, "exports");
    const a = takeAt({
      acquiredIso: "2026-10-01T00:00:00.000Z",
      chats: [
        conversation({ id: "conv-x", text: "x", updateTime: 1790900000 }),
        conversation({ id: "conv-y", text: "one", updateTime: 1790000000 }),
      ],
      root,
    });
    const b = takeAt({
      acquiredIso: "2026-10-05T00:00:00.000Z",
      chats: [conversation({ id: "conv-y", text: "two", updateTime: 1790000000 })],
      root,
    });
    const run = unwrap(await refreshOf({ home, root }).run());
    expect(run.gaps!.map((gap) => gap.message)).toEqual([
      `chatgpt: conversation ${chatId({ name: "conv-y" })} differs between export ${a.contentHash.slice(0, 12)} and export ` +
        `${b.contentHash.slice(0, 12)}, and neither carries a later update, so which version is newer cannot be ` +
        "told — move one of those exports aside",
    ]);
    expect(bronzeTexts({ home })).toEqual(["x"]);
  });

  it("writes a message once though a later export extends its chat, never a second row for the first", async () => {
    // A chat's update time moves every time the owner adds to it; a message the owner already had must not read as changed.
    const home = tempDir();
    const root = join(home, "exports");
    const first = conversation({ id: "conv-grows", text: "one", updateTime: 1790000100 });
    takeAt({ acquiredIso: "2026-10-01T00:00:00.000Z", chats: [first], root });
    unwrap(await refreshOf({ home, root }).run());
    const grown = conversation({ id: "conv-grows", text: "one", updateTime: 1790000200 });
    const mapping = grown["mapping"] as Record<string, unknown>;
    mapping["m2"] = {
      id: "m2",
      message: {
        author: { role: "assistant" },
        content: { content_type: "text", parts: ["two"] },
        create_time: 1790000150,
        id: "m2",
        recipient: "all",
      },
      parent: "m",
    };
    takeAt({ acquiredIso: "2026-10-05T00:00:00.000Z", chats: [{ ...grown, current_node: "m2", mapping }], root });
    const run = unwrap(await refreshOf({ home, root }).run());
    expect([run.gaps, bronzeTexts({ home })]).toEqual([[], ["one", "two"]]);
  });
});

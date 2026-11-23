/**
 * Which held export each conversation is written from: its own latest version, never the export the chronology calls
 * newest — and two differing versions with no order between them named rather than decided.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { exportConversationInput } from "../../../../corpus/chatgpt/conversationInput.js";
import { type ConversationVersion, indexVersions, planMerge } from "../../../../corpus/chatgpt/conversationMerge.js";
import type { StoredExport } from "../../../../corpus/chatgpt/exportStore.js";
import { chatId } from "../../../chatgptFixture.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** One export's version, its hash repeated from one letter, with any records it would write. */
function version({
  letter,
  activityIso,
  digest,
  messages = {},
}: {
  letter: string;
  activityIso: string | undefined;
  digest: string;
  messages?: Readonly<Record<string, { fingerprint: string; tsIso: string }>>;
}): ConversationVersion {
  return {
    activityIso,
    digest,
    inputKey: letter.repeat(64),
    kind: "export",
    label: `export ${letter.repeat(12)}`,
    messages: new Map(Object.entries(messages)),
  };
}

/** Every held export's version of every conversation, each export one merge input. */
function indexExports({ exports }: { exports: readonly StoredExport[] }): ReturnType<typeof indexVersions> {
  return indexVersions({ inputs: exports.map((stored) => exportConversationInput({ stored })) });
}

/** A held export of one conversations file holding the given chats, built by hand. */
function storedOf({ letter, chats }: { letter: string; chats: readonly Record<string, unknown>[] }): StoredExport {
  const directory = mkdtempSync(join(tmpdir(), "chatgpt-merge-"));
  dirs.push(directory);
  const file = join(directory, "conversations.json");
  writeFileSync(file, JSON.stringify(chats));
  return {
    acquiredAtIso: "2026-10-17T00:00:00.000Z",
    contentHash: letter.repeat(64),
    directory,
    files: [file],
    importedAtIso: "2026-10-17T00:00:00.000Z",
    latestActivityIso: null,
  };
}

/** A one-message conversation, with any extra top-level fields. */
function chat({ text, extra = {} }: { text: string; extra?: Record<string, unknown> }): Record<string, unknown> {
  return {
    ...extra,
    create_time: 1790000000,
    current_node: "m",
    id: chatId({ name: "conv-y" }),
    mapping: {
      m: {
        id: "m",
        message: {
          author: { role: "user" },
          content: { content_type: "text", parts: [text] },
          create_time: 1790000000,
          id: "m",
        },
        parent: "root",
      },
      root: { id: "root", message: null, parent: null },
    },
    title: "Y",
    update_time: 1790000000,
  };
}

describe("planMerge", () => {
  it("writes each conversation from its latest version, whatever order the exports came in", () => {
    const plan = planMerge({
      versions: new Map([
        [
          "conv-y",
          [
            version({ activityIso: "2026-09-01T00:00:00.000Z", digest: "old", letter: "a" }),
            version({ activityIso: "2026-09-02T00:00:00.000Z", digest: "new", letter: "b" }),
          ],
        ],
      ]),
    });
    expect([...plan.takeFrom]).toEqual([["conv-y", "b".repeat(64)]]);
    expect(plan.gaps).toEqual([]);
    expect([...plan.unordered]).toEqual([]);
  });

  it("writes no export's version of a conversation an unreadable copy names, and no conversation at all for one naming none", () => {
    const versions = new Map([
      ["conv-y", [version({ activityIso: "2026-09-01T00:00:00.000Z", digest: "old", letter: "a" })]],
      ["conv-z", [version({ activityIso: "2026-09-01T00:00:00.000Z", digest: "z", letter: "a" })]],
    ]);
    const named = planMerge({ unweighed: { anonymous: false, ids: new Set(["conv-y"]) }, versions });
    expect([[...named.takeFrom], [...named.unordered], named.gaps]).toEqual([
      [["conv-z", "a".repeat(64)]],
      ["conv-y"],
      [],
    ]);
    const blind = planMerge({ unweighed: { anonymous: true, ids: new Set(["conv-x"]) }, versions });
    expect([[...blind.takeFrom], [...blind.unordered].toSorted(), blind.gaps]).toEqual([
      [],
      ["conv-x", "conv-y", "conv-z"],
      [
        "chatgpt: an export or the live copy holds an element that would not read and names no conversation, or a file that would not " +
          "read whole, so which chat's latest copy it holds cannot be told and no conversation is written this run",
      ],
    ]);
  });

  it("writes identical versions from the first export given, even with no instant on them", () => {
    const plan = planMerge({
      versions: new Map([
        [
          "conv-y",
          [
            version({ activityIso: undefined, digest: "same", letter: "a" }),
            version({ activityIso: "2026-09-02T00:00:00.000Z", digest: "same", letter: "b" }),
          ],
        ],
      ]),
    });
    expect([...plan.takeFrom]).toEqual([["conv-y", "a".repeat(64)]]);
    expect(plan.gaps).toEqual([]);
  });

  it("names differing versions that share their latest instant, or where one has none, and writes neither", () => {
    const plan = planMerge({
      versions: new Map([
        [
          "conv-tie",
          [
            version({ activityIso: "2026-09-01T00:00:00.000Z", digest: "one", letter: "a" }),
            version({ activityIso: "2026-09-01T00:00:00.000Z", digest: "two", letter: "b" }),
          ],
        ],
        [
          "conv-undated",
          [
            version({ activityIso: "2026-09-01T00:00:00.000Z", digest: "one", letter: "a" }),
            version({ activityIso: undefined, digest: "two", letter: "b" }),
          ],
        ],
      ]),
    });
    expect([...plan.takeFrom]).toEqual([]);
    expect([...plan.unordered]).toEqual(["conv-tie", "conv-undated"]);
    expect(plan.gaps).toEqual([
      `chatgpt: conversation conv-tie differs between export ${"a".repeat(12)} and export ${"b".repeat(12)}, and ` +
        "neither carries a later update, so which version is newer cannot be told — move one of those exports aside",
      `chatgpt: conversation conv-undated differs between export ${"b".repeat(12)} and export ${"a".repeat(12)}, ` +
        "and neither carries a later update, so which version is newer cannot be told — move one of those exports aside",
    ]);
  });

  it("names a latest version that changed a message and dates it before an older copy does, and writes neither", () => {
    const plan = planMerge({
      versions: new Map([
        [
          "conv-y",
          [
            version({
              activityIso: "2026-09-01T00:00:00.000Z",
              digest: "old",
              letter: "a",
              messages: { "conv-y:m": { fingerprint: "old", tsIso: "2026-09-01T00:00:05.000Z" } },
            }),
            version({
              activityIso: "2026-09-02T00:00:00.000Z",
              digest: "new",
              letter: "b",
              messages: { "conv-y:m": { fingerprint: "new", tsIso: "2026-09-01T00:00:01.000Z" } },
            }),
          ],
        ],
      ]),
    });
    expect([[...plan.takeFrom], [...plan.unordered], plan.gaps]).toEqual([
      [],
      ["conv-y"],
      [
        `chatgpt: message conv-y:m changed in export ${"b".repeat(12)} and is dated 2026-09-01T00:00:01.000Z there, ` +
          `before the 2026-09-01T00:00:05.000Z export ${"a".repeat(12)} gives it, so the corpus would keep the older ` +
          "text of conversation conv-y — the reader does not yet know this shape; report it",
      ],
    ]);
  });

  it("writes a latest version that changes a message at a later instant", () => {
    const plan = planMerge({
      versions: new Map([
        [
          "conv-y",
          [
            version({
              activityIso: "2026-09-01T00:00:00.000Z",
              digest: "old",
              letter: "a",
              messages: {
                "conv-y:m": { fingerprint: "same", tsIso: "2026-09-01T00:00:05.000Z" },
                "conv-y:n": { fingerprint: "before", tsIso: "2026-09-01T00:00:05.000Z" },
              },
            }),
            version({
              activityIso: "2026-09-02T00:00:00.000Z",
              digest: "new",
              letter: "b",
              messages: {
                "conv-y:m": { fingerprint: "same", tsIso: "2026-09-01T00:00:05.000Z" },
                "conv-y:n": { fingerprint: "after", tsIso: "2026-09-01T00:00:09.000Z" },
              },
            }),
          ],
        ],
      ]),
    });
    expect([[...plan.takeFrom], plan.gaps]).toEqual([[["conv-y", "b".repeat(64)]], []]);
  });

  it("names a latest version holding an unchanged message at another instant, either way, and writes neither", () => {
    // Bronze's dedup fingerprint leaves the instant out, so the moved message would be dropped as already held.
    const gaps = ["2026-09-01T00:00:01.000Z", "2026-09-01T00:00:09.000Z"].map(
      (tsIso) =>
        planMerge({
          versions: new Map([
            [
              "conv-y",
              [
                version({
                  activityIso: "2026-09-01T00:00:00.000Z",
                  digest: "old",
                  letter: "a",
                  messages: { "conv-y:m": { fingerprint: "same", tsIso: "2026-09-01T00:00:05.000Z" } },
                }),
                version({
                  activityIso: "2026-09-02T00:00:00.000Z",
                  digest: "new",
                  letter: "b",
                  messages: { "conv-y:m": { fingerprint: "same", tsIso } },
                }),
              ],
            ],
          ]),
        }).gaps,
    );
    expect(gaps).toEqual(
      ["2026-09-01T00:00:01.000Z", "2026-09-01T00:00:09.000Z"].map((tsIso) => [
        `chatgpt: message conv-y:m is unchanged in export ${"b".repeat(12)} but dated ${tsIso} there, not the ` +
          `2026-09-01T00:00:05.000Z export ${"a".repeat(12)} gives it, so the corpus would keep the older time in ` +
          "conversation conv-y — the reader does not yet know this shape; report it",
      ]),
    );
  });

  it("names a latest version lacking a message an older copy holds, and writes neither", () => {
    // Only the chosen version is written, so the older copy's message would be read from no export.
    const kept = { fingerprint: "same", tsIso: "2026-09-01T00:00:05.000Z" };
    const plan = planMerge({
      versions: new Map([
        [
          "conv-z",
          [
            version({
              activityIso: "2026-09-01T00:00:00.000Z",
              digest: "old",
              letter: "a",
              messages: { "conv-z:m1": kept, "conv-z:m2": { fingerprint: "gone", tsIso: "2026-09-01T00:00:06.000Z" } },
            }),
            version({
              activityIso: "2026-09-02T00:00:00.000Z",
              digest: "new",
              letter: "b",
              messages: { "conv-z:m1": kept },
            }),
          ],
        ],
      ]),
    });
    expect(plan.gaps).toEqual([
      `chatgpt: message conv-z:m2 is in export ${"a".repeat(12)} but not in the latest version of conversation ` +
        `conv-z, export ${"b".repeat(12)}, so writing that version alone would leave it unread — the reader does ` +
        "not yet know this shape; report it",
    ]);
    expect([...plan.takeFrom]).toEqual([]);
    expect([...plan.unordered]).toEqual(["conv-z"]);
  });
});

describe("indexVersions", () => {
  it("reads two copies differing only in a field nothing writes as one version, and a changed message as another", () => {
    const { versions } = indexExports({
      exports: [
        storedOf({ chats: [chat({ text: "hello" })], letter: "a" }),
        storedOf({ chats: [chat({ extra: { is_archived: true }, text: "hello" })], letter: "b" }),
        storedOf({ chats: [chat({ text: "hello, edited" })], letter: "c" }),
      ],
    });
    const found = versions.get(chatId({ name: "conv-y" }))!;
    expect(found.map((one) => one.inputKey)).toEqual(["a".repeat(64), "b".repeat(64), "c".repeat(64)]);
    expect(found[0]!.digest).toBe(found[1]!.digest);
    expect(found[2]!.digest).not.toBe(found[0]!.digest);
    expect(found[0]!.activityIso).toBe("2026-09-21T14:13:20.000Z");
    expect([...found[0]!.messages.entries()].map(([sourceId, one]) => [sourceId, one.tsIso])).toEqual([
      [`${chatId({ name: "conv-y" })}:m`, "2026-09-21T14:13:20.000Z"],
    ]);
  });

  it("orders a version by its update_time whenever it has one, never by a create_time past it, else by create_time", () => {
    const backwards = { ...chat({ text: "hello" }), create_time: 1790000300 };
    const undated = { ...chat({ text: "hello" }), create_time: 1790000100, update_time: null };
    const found = [backwards, undated].map(
      (one, index) =>
        indexExports({ exports: [storedOf({ chats: [one], letter: "ab"[index]! })] }).versions.get(
          chatId({ name: "conv-y" }),
        )![0]!.activityIso,
    );
    expect(found).toEqual(["2026-09-21T14:13:20.000Z", "2026-09-21T14:15:00.000Z"]);
  });

  it("weighs a copy carrying a message it cannot write as different, though both would write the same records", () => {
    const plain = chat({ text: "hello" });
    const withUnknown = {
      ...plain,
      current_node: "n",
      mapping: {
        ...(plain["mapping"] as Record<string, unknown>),
        n: {
          id: "n",
          message: {
            author: { role: "user" },
            content: { content_type: "hologram", parts: ["?"] },
            create_time: 1790000000,
            id: "n",
          },
          parent: "m",
        },
      },
    };
    const found = indexExports({
      exports: [storedOf({ chats: [plain], letter: "a" }), storedOf({ chats: [withUnknown], letter: "b" })],
    }).versions.get(chatId({ name: "conv-y" }))!;
    expect(found[1]!.digest).not.toBe(found[0]!.digest);
  });

  it("leaves unweighed the ids an element that will not parse names, so an older copy cannot stand in for it", () => {
    const index = indexExports({
      exports: [
        storedOf({ chats: [chat({ text: "hello" })], letter: "a" }),
        storedOf({ chats: [{ conversation_id: "conv-other", id: chatId({ name: "conv-y" }) }], letter: "b" }),
      ],
    });
    expect([...index.versions.keys()]).toEqual([chatId({ name: "conv-y" })]);
    expect([[...index.unweighed.ids], index.unweighed.anonymous]).toEqual([
      [chatId({ name: "conv-y" }), "conv-other"],
      false,
    ]);
    const plan = planMerge(index);
    expect([[...plan.takeFrom], [...plan.unordered]]).toEqual([[], [chatId({ name: "conv-y" }), "conv-other"]]);
  });

  it("leaves unweighed a conversation one export holds twice in two versions, and reads a repeated key as unreadable", () => {
    const index = indexExports({
      exports: [storedOf({ chats: [chat({ text: "first" }), chat({ text: "second" })], letter: "a" })],
    });
    expect([[...index.unweighed.ids], index.unweighed.anonymous]).toEqual([[chatId({ name: "conv-y" })], false]);
    const directory = mkdtempSync(join(tmpdir(), "chatgpt-merge-"));
    dirs.push(directory);
    const file = join(directory, "conversations.json");
    const element = JSON.stringify(chat({ text: "hello" }));
    writeFileSync(file, `[${element.replace('"title":"Y"', '"title":"Y","mapping":{}')}]`);
    const stored = { ...storedOf({ chats: [], letter: "c" }), files: [file] };
    const repeated = indexExports({ exports: [stored] });
    expect([[...repeated.versions.keys()], [...repeated.unweighed.ids]]).toEqual([[], [chatId({ name: "conv-y" })]]);
  });

  it("counts an element naming no conversation, or a file not read whole, as able to hide any conversation", () => {
    const nameless = indexExports({
      exports: [storedOf({ chats: [chat({ text: "hello" }), { title: "?" }], letter: "a" })],
    });
    expect([[...nameless.versions.keys()], nameless.unweighed.anonymous]).toEqual([[chatId({ name: "conv-y" })], true]);
    const directory = mkdtempSync(join(tmpdir(), "chatgpt-merge-"));
    dirs.push(directory);
    const file = join(directory, "conversations.json");
    writeFileSync(file, `[${JSON.stringify(chat({ text: "hello" }))},`);
    const truncated = indexExports({ exports: [{ ...storedOf({ chats: [], letter: "c" }), files: [file] }] });
    expect([[...truncated.versions.keys()], truncated.unweighed.anonymous]).toEqual([
      [chatId({ name: "conv-y" })],
      true,
    ]);
  });
});

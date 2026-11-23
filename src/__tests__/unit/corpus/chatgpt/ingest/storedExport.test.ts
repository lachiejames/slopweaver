/**
 * `ingestStoredExport` over one held export built by hand: every read failure a named coverage gap rather than a
 * silent skip — a duplicate, an unparseable conversation, an unknown content kind, a file that is not whole JSON or
 * not UTF-8, a failed bronze write — and the gap list held to its bound.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ChatgptElementErrors } from "../../../../../corpus/chatgpt/exportElement.js";
import { ingestStoredExport } from "../../../../../corpus/chatgpt/ingest.js";
import { bronzeSourceDir } from "../../../../../corpus/corpusPaths.js";
import { type BronzeCommitter, createBronzeCommitter } from "../../../../../corpus/corpusWriter.js";
import { JsonArrayErrors } from "../../../../../lib/jsonArrayErrors.js";
import { err } from "../../../../../lib/result.js";
import { chatId } from "../../../../chatgptFixture.js";
import { conversation, keepingCommitter, storedOf, tempDir, useTempDirs, WINDOW } from "./harness.js";

useTempDirs();

describe("ingestStoredExport", () => {
  it("reads an exact duplicate conversation once, and counts it", () => {
    const one = JSON.stringify(conversation({ id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a10" }));
    const { committer, kept } = keepingCommitter();
    const tally = ingestStoredExport({ committer, stored: storedOf({ text: `[${one},${one}]` }) });
    expect(tally.gaps).toEqual([]);
    expect(tally.duplicates).toBe(1);
    expect(tally.conversations).toBe(1);
    expect(kept.length).toBe(1);
  });

  it("fails coverage on the same id twice with different content, keeping the first", () => {
    const first = JSON.stringify(conversation({ id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a11", text: "one" }));
    const second = JSON.stringify(conversation({ id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a11", text: "two" }));
    const { committer, kept } = keepingCommitter();
    const tally = ingestStoredExport({ committer, stored: storedOf({ text: `[${first},${second}]` }) });
    expect(tally.gaps).toEqual([
      `chatgpt: conversation ${chatId({ name: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a11" })} appears twice in the export with different content`,
    ]);
    expect(kept.map((record) => record.text)).toEqual(["one"]);
  });

  it("fails coverage on a conversation that will not parse, naming it, and still reads the rest", () => {
    const broken = JSON.stringify({ current_node: "gone", id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a12", mapping: {} });
    const good = JSON.stringify(conversation({ id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a13" }));
    const { committer, kept } = keepingCommitter();
    const tally = ingestStoredExport({ committer, stored: storedOf({ text: `[${broken},${good}]` }) });
    expect(tally.gaps).toEqual([
      "chatgpt: conversation 6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a12 will not parse — " +
        "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a12: `current_node` gone is not in its own `mapping`",
    ]);
    expect(kept.length).toBe(1);
  });

  it("fails coverage on a content kind it does not know, naming the kind and the file to teach", () => {
    const { committer, kept } = keepingCommitter();
    const odd = JSON.stringify(conversation({ contentType: "hologram", id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a14" }));
    const tally = ingestStoredExport({ committer, stored: storedOf({ text: `[${odd}]` }) });
    expect(tally.gaps).toEqual([
      "chatgpt: 1 message(s) carry the content kind `hologram`, which this reader does not know — " +
        "not stored; teach `corpus/chatgpt/exportMessage.ts` the kind",
    ]);
    expect(kept).toEqual([]);
  });

  it.each(["__proto__", "constructor", "toString"])(
    "fails coverage on a content kind named %s, a name every JavaScript object already carries",
    (kind) => {
      const { committer, kept } = keepingCommitter();
      const odd = JSON.stringify(conversation({ contentType: kind, id: "conv-proto" }));
      const tally = ingestStoredExport({ committer, stored: storedOf({ text: `[${odd}]` }) });
      expect(tally.gaps).toEqual([
        `chatgpt: 1 message(s) carry the content kind \`${kind}\`, which this reader does not know — ` +
          "not stored; teach `corpus/chatgpt/exportMessage.ts` the kind",
      ]);
      expect(kept).toEqual([]);
    },
  );

  it("names a content kind that is not identifier-shaped by its length, never its words", () => {
    const { committer, kept } = keepingCommitter();
    const odd = JSON.stringify(conversation({ contentType: "SECRET: launch at dawn", id: "conv-words" }));
    const tally = ingestStoredExport({ committer, stored: storedOf({ text: `[${odd}]` }) });
    expect(tally.gaps).toEqual([
      "chatgpt: 1 message(s) carry the content kind `(unnamed, 22 chars)`, which this reader does not know — " +
        "not stored; teach `corpus/chatgpt/exportMessage.ts` the kind",
    ]);
    expect(tally.gaps.join("\n")).not.toContain("launch at dawn");
    expect(kept).toEqual([]);
  });

  it("names a recipient that is not identifier-shaped by its length, never its words", () => {
    const { committer } = keepingCommitter();
    const odd = JSON.stringify(
      conversation({ id: "conv-recipient", recipient: "meet me at noon", role: "assistant", text: "Reply." }),
    );
    const tally = ingestStoredExport({ committer, stored: storedOf({ text: `[${odd}]` }) });
    expect(tally.gaps).toEqual([
      "chatgpt: 1 message(s) carry the content kind `recipient (unnamed, 15 chars)`, which this reader does not " +
        "know — not stored; teach `corpus/chatgpt/exportMessage.ts` the kind",
    ]);
  });

  it.each([
    {
      chat: { recipient: "web.new_route", role: "assistant", text: "The reply the owner saw." },
      kind: "recipient web.new_route",
      what: "an assistant reply addressed to a recipient it does not know",
    },
    {
      chat: { contentType: "multimodal_text", parts: [{ content_type: "audio_asset_pointer" }] },
      kind: "multimodal_text part recording (no transcription)",
      what: "a recording with no transcription beside it",
    },
    {
      chat: {
        contentType: "multimodal_text",
        parts: [
          { content_type: "real_time_user_audio_video_asset_pointer" },
          { content_type: "audio_transcription", text: " " },
        ],
      },
      kind: "multimodal_text part recording (no transcription)",
      what: "a video recording whose transcription carries no words",
    },
  ])("fails coverage on $what, never counting it withheld", ({ chat, kind }) => {
    const { committer, kept } = keepingCommitter();
    const odd = JSON.stringify(conversation({ ...chat, id: "conv-silent" }));
    const tally = ingestStoredExport({ committer, stored: storedOf({ text: `[${odd}]` }) });
    expect(tally.gaps).toEqual([
      `chatgpt: 1 message(s) carry the content kind \`${kind}\`, which this reader does not know — ` +
        "not stored; teach `corpus/chatgpt/exportMessage.ts` the kind",
    ]);
    expect([tally.withheld, kept]).toEqual([0, []]);
  });

  it.each(["api_tool.call_tool", "web.run"])(
    "withholds an assistant call to %s, a tool it knows, and fails no coverage",
    (recipient) => {
      const { committer, kept } = keepingCommitter();
      const call = JSON.stringify(conversation({ id: "conv-tool", recipient, role: "assistant", text: "{}" }));
      const tally = ingestStoredExport({ committer, stored: storedOf({ text: `[${call}]` }) });
      expect([tally.gaps, tally.withheld, kept]).toEqual([[], 1, []]);
    },
  );

  it("still reports a user message addressed to web.run, which only an assistant call may be", () => {
    const { committer } = keepingCommitter();
    const odd = JSON.stringify(conversation({ id: "conv-user-web", recipient: "web.run", role: "user", text: "Hi." }));
    const tally = ingestStoredExport({ committer, stored: storedOf({ text: `[${odd}]` }) });
    expect(tally.gaps).toEqual([
      "chatgpt: 1 message(s) carry the content kind `recipient web.run`, which this reader does not know — " +
        "not stored; teach `corpus/chatgpt/exportMessage.ts` the kind",
    ]);
  });

  it("fails coverage on a message with no instant on it or its conversation", () => {
    const { committer } = keepingCommitter();
    const undated = JSON.stringify(conversation({ createTime: null, id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a15" }));
    const tally = ingestStoredExport({ committer, stored: storedOf({ text: `[${undated}]` }) });
    expect(tally.gaps).toEqual([
      `chatgpt: conversation ${chatId({ name: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a15" })} has 1 message(s) with no instant on them or the conversation`,
    ]);
  });

  it("fails coverage on a file that is not a whole JSON array", () => {
    const { committer } = keepingCommitter();
    const stored = storedOf({ text: '{"not":"an array"}' });
    const tally = ingestStoredExport({ committer, stored });
    expect(tally.gaps).toEqual([
      `chatgpt: conversations.json could not be read whole — ${stored.files[0]!}: not a JSON array: the document opens with "{"`,
    ]);
  });

  it("fails coverage on a file that is not UTF-8, writing nothing from it", () => {
    const { committer, kept } = keepingCommitter();
    const stored = storedOf({ text: "[]" });
    const good = JSON.stringify(conversation({ id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a16" }));
    // One bad byte inside the message's words: the rest of the element is valid JSON either side of it.
    const at = good.indexOf("hello") + "hel".length;
    writeFileSync(
      stored.files[0]!,
      Buffer.concat([Buffer.from(`[${good.slice(0, at)}`), Buffer.from([0xff]), Buffer.from(`${good.slice(at)}]`)]),
    );
    const tally = ingestStoredExport({ committer, stored });
    expect([tally.gaps, kept]).toEqual([
      [
        `chatgpt: conversations.json could not be read whole — ${JsonArrayErrors.notUtf8({ path: stored.files[0]! }).message}`,
      ],
      [],
    ]);
  });

  it("fails coverage on a conversation spelling one key twice, by its id and path, writing nothing from it", () => {
    const { committer, kept } = keepingCommitter();
    const good = JSON.stringify(conversation({ id: "conv-dup" }));
    // The first `m` is the message JSON.parse would drop; the second, a hidden node, is all it would keep.
    const twice = good.replace('"mapping":{', '"mapping":{"m":{"id":"m","message":null,"parent":null},');
    const tally = ingestStoredExport({ committer, stored: storedOf({ text: `[${twice}]` }) });
    expect([tally.gaps, kept]).toEqual([
      [
        `chatgpt: conversation ${chatId({ name: "conv-dup" })} ${ChatgptElementErrors.duplicateKey({ ids: [], path: ["mapping", "m"] }).message}`,
      ],
      [],
    ]);
  });

  it("fails coverage on a bronze write that failed, counting nothing written", () => {
    const failing: BronzeCommitter = { commit: () => err(["disk full"]) };
    const good = JSON.stringify(conversation({ id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a16" }));
    const tally = ingestStoredExport({ committer: failing, stored: storedOf({ text: `[${good}]` }) });
    expect(tally.gaps).toEqual(["chatgpt: a bronze write of 1 record(s) failed (disk full)"]);
    expect(tally.written).toBe(0);
    expect(tally.offered).toBe(0);
  });

  it("names a write the real disk refuses as the same gap, rather than throwing past the tally", () => {
    const home = tempDir();
    const blocked = bronzeSourceDir({ home, source: "chatgpt" });
    mkdirSync(join(home, "corpus", "bronze"), { recursive: true });
    writeFileSync(blocked, "a file where the chatgpt directory belongs");
    const good = JSON.stringify(conversation({ id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a17" }));
    const tally = ingestStoredExport({
      committer: createBronzeCommitter({ home, window: WINDOW }),
      stored: storedOf({ text: `[${good}]` }),
    });
    expect(tally.gaps).toHaveLength(1);
    expect(tally.gaps[0]).toContain(`chatgpt: a bronze write of 1 record(s) failed (bronze append to ${blocked}/`);
    expect(tally.written).toBe(0);
  });

  it("names 20 unknown kinds and counts the rest, however many distinct kinds the archive invents", () => {
    const { committer } = keepingCommitter();
    const odd = Array.from({ length: 25 }, (_, index) =>
      JSON.stringify(conversation({ contentType: `kind-${String(index)}`, id: `c-${String(index).padStart(3, "0")}` })),
    );
    const tally = ingestStoredExport({ committer, stored: storedOf({ text: `[${odd.join(",")}]` }) });
    expect(tally.unknownKinds.size).toBe(20);
    expect(tally.unknownKindsUnnamed).toBe(5);
    expect(tally.gaps.length).toBe(21);
    expect(tally.gaps[20]!).toBe("chatgpt: 5 more message(s) carry content kinds past the 20 named — not stored");
  });

  it("refuses an over-long content kind at the schema, never carrying it as a name", () => {
    const { committer } = keepingCommitter();
    const longKind = "k".repeat(101);
    const odd = JSON.stringify(conversation({ contentType: longKind, id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a17" }));
    const tally = ingestStoredExport({ committer, stored: storedOf({ text: `[${odd}]` }) });
    expect(tally.unknownKinds.size).toBe(0);
    expect(tally.gaps.length).toBe(1);
    expect(tally.gaps[0]!).not.toContain(longKind);
    expect(tally.gaps[0]!).toContain("will not parse");
  });

  it("keeps 50 gap lines and counts the rest in one closing line", () => {
    const { committer } = keepingCommitter();
    const broken = Array.from({ length: 60 }, (_, index) =>
      JSON.stringify({ current_node: "gone", id: `b-${String(index).padStart(3, "0")}`, mapping: {} }),
    );
    const tally = ingestStoredExport({ committer, stored: storedOf({ text: `[${broken.join(",")}]` }) });
    expect(tally.gapsUnnamed).toBe(10);
    expect(tally.gaps.length).toBe(51);
    expect(tally.gaps[50]!).toBe("chatgpt: and 10 more gap(s) in this export, counted rather than named");
  });

  it("reads an empty export as nothing, with no gap", () => {
    const { committer } = keepingCommitter();
    const tally = ingestStoredExport({ committer, stored: storedOf({ text: "[]" }) });
    expect(tally.gaps).toEqual([]);
    expect(tally.conversations).toBe(0);
  });
});

/**
 * `fetchOnePage` over a meeting note: the markdown read omits the transcript, and the page item must carry it.
 *
 * The Notion client is a plain object answering from fixtures, passed through the seam `fetchOnePage` already
 * takes — a fake, not a mock. Every fixture is synthetic.
 */
import type { Client } from "@notionhq/client";
import { describe, expect, it } from "vitest";

import { DEFAULT_NOTION_CAPTURE_CAPS } from "../../../../corpus/notion/caps.js";
import { fetchOnePage } from "../../../../corpus/notion/liveApiPages.js";
import type { NotionMarkdownReader } from "../../../../corpus/notion/liveMarkdown.js";
import { ok } from "../../../../lib/result.js";

const PAGE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const NOTE_ID = "a0000075-0000-4000-8000-000000000081";
const SENTENCE = `Transcript omitted. Use the view tool with the meeting note url (https://app.notion.com/p/aaaaaaaabbbbccccddddeeeeeeeeeeee#a0000075000040008000000000000081) to view this transcript.`;

/** A reader answering the one markdown body a meeting note page renders as. */
const reader: NotionMarkdownReader = {
  retrieveMarkdown: async () =>
    ok({
      markdown: `Weekly sync\n\n### Action Items\n\n- ship it\n\n${SENTENCE}`,
      truncated: false,
      unknownBlockIds: [],
    }),
};

/** A client answering the meeting note, its transcript's two paragraphs, and an empty comment thread. */
const client = {
  blocks: {
    children: {
      list: async () => ({
        next_cursor: null,
        results: ["Morning all.", "Let's start with access requests."].map((content, index) => ({
          has_children: false,
          id: `p-${index}`,
          paragraph: { rich_text: [{ plain_text: content, text: { content }, type: "text" }] },
          type: "paragraph",
        })),
      }),
    },
    retrieve: async () => ({
      id: NOTE_ID,
      transcription: { children: { notes_block_id: "n", summary_block_id: "s", transcript_block_id: "t" } },
      type: "transcription",
    }),
  },
  comments: { list: async () => ({ next_cursor: null, results: [] }) },
} as unknown as Client;

describe("fetchOnePage over a meeting note", () => {
  it("stores the transcript Notion's markdown omitted, in place of its sentence", async () => {
    const fetched = await fetchOnePage({
      attachments: undefined,
      call: (task) => task(),
      caps: DEFAULT_NOTION_CAPTURE_CAPS,
      client,
      id: PAGE_ID,
      lastEdited: "2026-10-13T00:21:00.000Z",
      raw: { id: PAGE_ID, last_edited_time: "2026-10-13T00:21:00.000Z", object: "page", properties: {} },
      reader,
      scopeId: "test",
      storeBody: undefined,
    });
    const body = fetched.item.chunks.join("\n");
    expect(body).toContain("Transcript:\n\nMorning all.\n\nLet's start with access requests.");
    expect(body).not.toContain("Transcript omitted.");
    expect(fetched.skips).toEqual([]);
  });
});

/**
 * One conversation, paged and put back in order: the only two paths the module builds, the page bound that
 * refuses rather than truncates, a cursor that does not move, and a voice turn's words.
 */
import { describe, expect, it } from "vitest";

import {
  type ChatgptMessage,
  mergeMessages,
  messageText,
  newestPagePath,
  olderPagePath,
  parseConversationId,
  parsePage,
  pullConversation,
  renderTranscript,
} from "../../../../../cli/commands/chatgpt/conversation.js";
import { type ChatgptError, ChatgptErrors } from "../../../../../cli/commands/chatgpt/errors.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";

const ID = "6aba18a1-5280-83ec-9115-b16ac7e6a181";

/**
 * One backend message.
 *
 * @param id the message id
 * @param role who spoke
 * @param at the create_time, epoch seconds
 * @param text a voice transcription part
 * @returns the message
 */
function voice({ id, role, at, text }: { id: string; role: string; at: number | null; text: string }): ChatgptMessage {
  return {
    author: { role },
    content: { content_type: "multimodal_text", parts: [{ content_type: "audio_transcription", text }] },
    create_time: at,
    id,
  };
}

/**
 * One page body as the backend sends it.
 *
 * @param messages the page's messages
 * @param before the start_cursor, or null on the oldest page
 * @returns the body
 */
function page({ messages, before }: { messages: readonly ChatgptMessage[]; before: string | null }): unknown {
  return {
    messages,
    page_info: { has_previous_page: before !== null, start_cursor: before },
    title: "Greeting exchange",
  };
}

describe("parseConversationId", () => {
  it("accepts a bare id and a chatgpt.com link, lowercased", () => {
    expect(unwrap(parseConversationId({ given: ID.toUpperCase() }))).toBe(ID);
    expect(unwrap(parseConversationId({ given: `https://chatgpt.com/c/${ID}?model=x` }))).toBe(ID);
  });

  it("refuses anything else before a request is made", () => {
    expect(unwrapErr(parseConversationId({ given: "../conversations" })).code).toBe("NOT_A_CONVERSATION_ID");
  });
});

describe("the two paths", () => {
  it("builds the newest page and an older page over the one id", () => {
    expect(newestPagePath({ id: ID })).toBe(`/backend-api/conversations/${ID}?num_turns=10&include_has_versions=true`);
    expect(olderPagePath({ before: "c-1", id: ID })).toBe(
      `/backend-api/conversations/${ID}/messages?before=c-1&num_turns=10&include_has_versions=true`,
    );
  });
});

describe("parsePage", () => {
  /** A page as the newest-page endpoint sent it, every level carrying keys this module declares and never reads. */
  const wire = (): Record<string, unknown> => ({
    is_archived: false,
    messages: [
      {
        author: { metadata: {}, name: null, role: "user" },
        channel: null,
        content: {
          content_type: "multimodal_text",
          parts: [{ content_type: "audio_transcription", decoding_id: null, direction: "in", text: " Ayo" }],
        },
        create_time: 1_790_580_903.7,
        id: "m1",
        metadata: { voice_mode_message: true },
        status: "finished_successfully",
      },
    ],
    page_info: { end_cursor: "e", has_next_page: false, has_previous_page: false, start_cursor: "m1" },
    title: "Greeting exchange",
  });

  it("reads a page carrying every declared key", () => {
    const parsed = unwrap(parsePage({ endpoint: "newest", path: "/p", text: JSON.stringify(wire()) }));
    expect([parsed.title, parsed.olderCursor, parsed.messages.map((message) => messageText({ message }))]).toEqual([
      "Greeting exchange",
      null,
      ["Ayo"],
    ]);
  });

  it("reads a page carrying a sectioned conversation and an attached image, naming the image by its kind", () => {
    const body = wire();
    body["sectioned_conversation"] = null;
    const messages = body["messages"] as Record<string, unknown>[];
    messages.push({
      author: { role: "user" },
      content: {
        content_type: "multimodal_text",
        parts: [
          {
            asset_pointer: "sediment://file_x",
            content_type: "image_asset_pointer",
            fovea: null,
            height: 10,
            metadata: {},
            mime_type: "image/png",
            size_bytes: 100,
            width: 20,
          },
          "see this",
        ],
      },
      create_time: 1_790_580_904,
      id: "m2",
    });
    const parsed = unwrap(parsePage({ endpoint: "older", path: "/p", text: JSON.stringify(body) }));
    expect(parsed.messages.map((message) => messageText({ message }))).toEqual([
      "Ayo",
      "[image_asset_pointer]\n\nsee this",
    ]);
  });

  it.each([
    { at: [], field: "new_page_key" },
    { at: ["page_info"], field: "page_info.new_cursor_key" },
    { at: ["messages", 0], field: "messages[0].new_message_key" },
    { at: ["messages", 0, "author"], field: "messages[0].author.new_author_key" },
    { at: ["messages", 0, "content"], field: "messages[0].content.new_content_key" },
    { at: ["messages", 0, "content", "parts", 0], field: "messages[0].content.parts[0].new_part_key" },
  ])("refuses $field, a key added, by name on both endpoints", ({ at, field }) => {
    const drifted = wire();
    let level = drifted;
    for (const step of at) {
      level = level[step] as Record<string, unknown>;
    }
    level[field.replace(/^.*\./, "")] = 1;
    const refusals = (["newest", "older"] as const).map((endpoint) =>
      unwrapErr(parsePage({ endpoint, path: "/p", text: JSON.stringify(drifted) })),
    );
    expect(refusals.map(({ code }) => code)).toEqual(["PAGE_MALFORMED", "PAGE_MALFORMED"]);
    expect(refusals.map(({ message }) => message.endsWith(`refused, not guessed: new field "${field}"`))).toEqual([
      true,
      true,
    ]);
    expect(refusals[1]!.message).toContain("GET /backend-api/conversations/:id/messages answered");
  });

  it("refuses a page that is not one, naming the path and the missing field", () => {
    const error = unwrapErr(parsePage({ endpoint: "newest", path: "/p", text: '{"detail":"nope"}' }));
    expect(error.code).toBe("PAGE_MALFORMED");
    expect(error.message).toContain("GET /p");
    expect(error.message).toContain('field "messages" is missing');
  });

  it("refuses a body declared JSON that does not parse as NOT_JSON", () => {
    expect(unwrapErr(parsePage({ endpoint: "older", path: "/p", text: "<html>" })).code).toBe("NOT_JSON");
  });

  it("refuses a page that claims older messages and names no cursor", () => {
    const text = JSON.stringify({ messages: [], page_info: { has_previous_page: true, start_cursor: null } });
    expect(unwrapErr(parsePage({ endpoint: "newest", path: "/p", text })).message).toContain(
      "has_previous_page with no start_cursor",
    );
  });
});

describe("pullConversation", () => {
  const newest = page({ before: "c-2", messages: [voice({ at: 30, id: "m3", role: "user", text: "third" })] });
  const middle = page({ before: "c-1", messages: [voice({ at: 20, id: "m2", role: "assistant", text: "second" })] });
  const oldest = page({ before: null, messages: [voice({ at: 10, id: "m1", role: "user", text: "first" })] });
  const pages: Record<string, unknown> = {
    [newestPagePath({ id: ID })]: newest,
    [olderPagePath({ before: "c-2", id: ID })]: middle,
    [olderPagePath({ before: "c-1", id: ID })]: oldest,
  };
  const asked: string[] = [];
  const fetchText = ({ path }: { path: string }): Promise<Result<string, ChatgptError>> => {
    asked.push(path);
    return Promise.resolve(ok(JSON.stringify(pages[path])));
  };

  it("reads every page and returns the messages oldest first", async () => {
    asked.length = 0;
    const pulled = unwrap(await pullConversation({ fetchText, id: ID, maxPages: 10 }));
    expect(pulled.messages.map((message) => message.id)).toEqual(["m1", "m2", "m3"]);
    expect(pulled.pages).toBe(3);
    expect(pulled.title).toBe("Greeting exchange");
    expect(asked).toEqual(Object.keys(pages));
  });

  it("refuses past the page bound rather than returning part of the conversation", async () => {
    const error = unwrapErr(await pullConversation({ fetchText, id: ID, maxPages: 2 }));
    expect(error.code).toBe("PAGE_BOUND_EXCEEDED");
  });

  it("refuses a cursor that does not move", async () => {
    const stuck = ({ path }: { path: string }): Promise<Result<string, ChatgptError>> =>
      Promise.resolve(
        ok(JSON.stringify(path === newestPagePath({ id: ID }) ? newest : page({ before: "c-2", messages: [] }))),
      );
    expect(unwrapErr(await pullConversation({ fetchText: stuck, id: ID, maxPages: 10 })).code).toBe("CURSOR_STALLED");
  });

  it("reads an older page through the older endpoint's boundary, naming it in a refusal", async () => {
    const drifted = ({ path }: { path: string }): Promise<Result<string, ChatgptError>> =>
      Promise.resolve(
        ok(JSON.stringify(path === newestPagePath({ id: ID }) ? newest : { ...(middle as object), cursor_v2: "x" })),
      );
    expect(unwrapErr(await pullConversation({ fetchText: drifted, id: ID, maxPages: 10 })).message).toBe(
      `GET ${olderPagePath({ before: "c-2", id: ID })} answered JSON that is not a page of messages: GET /backend-api/conversations/:id/messages answered a shape this version does not read — refused, not guessed: new field "cursor_v2"`,
    );
  });

  it("hands a transport failure back unchanged", async () => {
    const refused = (): Promise<Result<string, ChatgptError>> =>
      Promise.resolve(err(ChatgptErrors.httpRefused({ path: "/", status: 401 })));
    expect(unwrapErr(await pullConversation({ fetchText: refused, id: ID, maxPages: 10 })).code).toBe("HTTP_REFUSED");
  });
});

describe("mergeMessages", () => {
  it("keeps each id once and puts an untimed message last", () => {
    const merged = mergeMessages({
      pages: [
        { messages: [voice({ at: 20, id: "b", role: "user", text: "b" })], olderCursor: "c", title: null },
        {
          messages: [
            voice({ at: null, id: "root", role: "system", text: "" }),
            voice({ at: 20, id: "b", role: "user", text: "b" }),
          ],
          olderCursor: null,
          title: null,
        },
      ],
    });
    expect(merged.map((message) => message.id)).toEqual(["b", "root"]);
  });
});

describe("messageText", () => {
  it("reads string parts, a transcription's text, and names any other part", () => {
    const message: ChatgptMessage = {
      author: { role: "user" },
      content: {
        content_type: "multimodal_text",
        parts: [
          "typed",
          { content_type: "audio_transcription", text: " spoken " },
          { content_type: "audio_asset_pointer" },
        ],
      },
      create_time: 1,
      id: "x",
    };
    expect(messageText({ message })).toBe("typed\n\nspoken\n\n[audio_asset_pointer]");
  });
});

describe("renderTranscript", () => {
  it("prints each worded turn with its role and instant, and counts the wordless ones", () => {
    const markdown = renderTranscript({
      id: ID,
      messages: [
        voice({ at: 1_790_000_000, id: "a", role: "user", text: "Ayo" }),
        voice({ at: null, id: "b", role: "tool", text: "" }),
      ],
      title: "Greeting exchange",
    });
    expect(markdown).toBe(
      `# Greeting exchange\n\nhttps://chatgpt.com/c/${ID} — 1 turn(s), 1 wordless message(s) not shown\n\n## user · 2026-09-21T14:13:20.000Z\n\nAyo\n`,
    );
  });
});

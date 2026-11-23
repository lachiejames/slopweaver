/**
 * One conversation read whole: the measured top-level key set held strictly, then the export's own reader, so a key
 * the measurement never saw, or a body answering for another chat, refuses by name.
 */
import { describe, expect, it } from "vitest";

import {
  parseWholeConversation,
  wholeConversationPath,
} from "../../../../../cli/commands/chatgpt/wholeConversation.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { chatId } from "../../../../chatgptFixture.js";
import { conversation, liveBody } from "../../../corpus/chatgpt/ingest/harness.js";

const ID = chatId({ name: "conv-y" });
const PATH = `/backend-api/conversation/${ID}`;
const BODY = liveBody({ chat: conversation({ id: "conv-y", text: "every word", title: "Y", updateTime: 1790100000 }) });

describe("wholeConversationPath", () => {
  it("builds the path from a conversation id alone", () => {
    expect(unwrap(wholeConversationPath({ id: ID }))).toBe(PATH);
    expect(unwrapErr(wholeConversationPath({ id: "../me" })).code).toBe("PAGE_MALFORMED");
  });
});

describe("parseWholeConversation", () => {
  it("reads the body through the export's parser and keeps its exact text", () => {
    const text = JSON.stringify(BODY);
    const whole = unwrap(parseWholeConversation({ expectedId: ID, path: PATH, text }));
    expect(whole.elementText).toBe(text);
    expect(whole.conversation.id).toBe(ID);
    expect(whole.conversation.updatedIso).toBe("2026-09-22T18:00:00.000Z");
    expect(whole.conversation.messages.map((message) => message.text)).toEqual(["every word"]);
  });

  it("refuses a top-level key the measurement never saw, by name", () => {
    const refused = unwrapErr(
      parseWholeConversation({ expectedId: ID, path: PATH, text: JSON.stringify({ ...BODY, new_flag: true }) }),
    );
    expect(refused.code).toBe("PAGE_MALFORMED");
    expect(refused.message).toContain("new_flag");
  });

  it("refuses a body answering for another conversation", () => {
    const refused = unwrapErr(
      parseWholeConversation({ expectedId: chatId({ name: "conv-z" }), path: PATH, text: JSON.stringify(BODY) }),
    );
    expect(refused.message).toContain("the body answers for another conversation");
  });
});

/*
 * What one message's content reads as: a content or part kind the reader has never seen is counted by name, never
 * kept or quietly withheld, and an image sent with no caption is still a turn.
 */
import { describe, expect, it } from "vitest";

import { parseExportConversation } from "../../../../../corpus/chatgpt/exportConversation.js";
import { unwrap } from "../../../../../lib/result.js";
import { oneMessage } from "./harness.js";

describe("parseExportConversation", () => {
  it("counts a content kind it has never seen by name, rather than keeping or quietly withholding it", () => {
    const conversation = unwrap(
      parseExportConversation({ value: oneMessage({ content: { content_type: "hologram", parts: ["x"] } }) }),
    );
    expect(conversation.messages).toEqual([]);
    expect([...conversation.unknownKinds]).toEqual([["hologram", 1]]);
    expect(conversation.withheld).toBe(0);
  });

  it("reports a message carrying a part kind it does not know, rather than dropping words that part may hold", () => {
    const sticker = { content_type: "sticker_pointer", text: "words this reader would lose" };
    const conversation = unwrap(
      parseExportConversation({
        value: oneMessage({ content: { content_type: "multimodal_text", parts: ["caption", sticker] } }),
      }),
    );
    expect(conversation.messages).toEqual([]);
    expect([...conversation.unknownKinds]).toEqual([["multimodal_text part sticker_pointer", 1]]);
  });

  it("reports a message carrying words in both text and parts, rather than reading one and losing the other", () => {
    const hidden = { content_type: "hologram", text: "words this reader would lose" };
    const counted = [
      { content_type: "code", language: "ts", parts: [hidden], text: "safe" },
      { content_type: "text", parts: ["shown"], text: "unread" },
    ].map((content) => [...unwrap(parseExportConversation({ value: oneMessage({ content }) })).unknownKinds]);
    expect(counted).toEqual([[["code (text and parts)", 1]], [["text (text and parts)", 1]]]);
  });

  it("reports a words message with no parts at all, rather than reading it as nothing said", () => {
    const conversation = unwrap(parseExportConversation({ value: oneMessage({ content: { content_type: "text" } }) }));
    expect([...conversation.unknownKinds]).toEqual([["text part (no parts)", 1]]);
    expect(conversation.withheld).toBe(0);
  });

  it("reports an untyped object part the same way", () => {
    const conversation = unwrap(
      parseExportConversation({ value: oneMessage({ content: { content_type: "text", parts: [{ words: "x" }] } }) }),
    );
    expect([...conversation.unknownKinds]).toEqual([["text part (untyped part)", 1]]);
  });

  it("reports a part whose content type is an array, never reading it as the attachment kind it names", () => {
    const part = { content_type: ["image_asset_pointer"], text: "words silently lost" };
    const content = { content_type: "multimodal_text", parts: [part] };
    const conversation = unwrap(parseExportConversation({ value: oneMessage({ content }) }));
    expect([...conversation.unknownKinds]).toEqual([["multimodal_text part (untyped part)", 1]]);
  });

  it("keeps an image sent with no caption as a turn, saying what it was", () => {
    const image = { asset_pointer: "file-service://file-abc", content_type: "image_asset_pointer" };
    const conversation = unwrap(
      parseExportConversation({ value: oneMessage({ content: { content_type: "multimodal_text", parts: [image] } }) }),
    );
    expect(conversation.messages.map(({ attachments, text }) => ({ attachments, text }))).toEqual([
      { attachments: 1, text: "(1 image(s), no caption)" },
    ]);
    expect(conversation.withheld).toBe(0);
  });

  it("counts a content kind named __proto__ as a kind, never onto an object's prototype", () => {
    const conversation = unwrap(
      parseExportConversation({ value: oneMessage({ content: { content_type: "__proto__", parts: ["?"] } }) }),
    );
    expect([conversation.messages, [...conversation.unknownKinds]]).toEqual([[], [["__proto__", 1]]]);
  });
});

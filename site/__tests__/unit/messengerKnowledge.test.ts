/*
 * What one settled tool call establishes for the messenger band: only what the tool's own answer proved.
 */
import { describe, expect, it } from "vitest";

import { messengerKnowledgeOf } from "../../lib/messengerKnowledge";

const call = {
  lookedApp: undefined,
  name: "read_page",
  page: { open: undefined, path: "/queue" },
  rawArguments: "{}",
  refused: false,
} as const;

describe("messengerKnowledgeOf", () => {
  it("records a page read against the page shown as it ran, with its open card", () => {
    expect(messengerKnowledgeOf({ ...call, page: { open: "ask:one", path: "/queue" } })).toEqual({
      kind: "page",
      open: "ask:one",
      path: "/queue",
    });
  });

  it("records nothing for a refused read", () => {
    expect(messengerKnowledgeOf({ ...call, refused: true })).toBe(undefined);
  });

  it("records the card a card read named", () => {
    expect(messengerKnowledgeOf({ ...call, name: "read_card", rawArguments: '{"key":"ask:two"}' })).toEqual({
      key: "ask:two",
      kind: "card",
    });
  });

  it.each(["not json", "{}", '{"key":""}', '{"key":3}', "null"])(
    "records nothing for card arguments %s",
    (rawArguments) => {
      expect(messengerKnowledgeOf({ ...call, name: "read_card", rawArguments })).toBe(undefined);
    },
  );

  it("records a Slack thread read", () => {
    expect(messengerKnowledgeOf({ ...call, name: "slack_open" })).toEqual({ kind: "slack-thread" });
  });

  it("records a Slack channel read", () => {
    expect(messengerKnowledgeOf({ ...call, name: "slack_channel" })).toEqual({ kind: "slack-channel" });
  });

  it("records nothing for a refused channel read", () => {
    expect(messengerKnowledgeOf({ ...call, name: "slack_channel", refused: true })).toBe(undefined);
  });

  it("credits a look to the application it landed on", () => {
    expect(messengerKnowledgeOf({ ...call, lookedApp: "chrome", name: "read_screen" })).toEqual({
      appKey: "chrome",
      kind: "screen",
    });
  });

  it("credits a look that straddled a switch of application to nothing", () => {
    expect(messengerKnowledgeOf({ ...call, name: "read_screen" })).toBe(undefined);
  });

  it("records nothing for any other tool", () => {
    expect(messengerKnowledgeOf({ ...call, name: "file_read" })).toBe(undefined);
  });
});

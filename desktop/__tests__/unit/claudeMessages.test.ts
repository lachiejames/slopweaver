/*
 * What crosses between the worker wire and the Agent SDK: a prompt becomes one user message, a top-level assistant
 * message's text becomes agent-text, a result becomes exactly one turn-ended, and an account the plan did not route
 * is refused.
 */
import { describe, expect, it } from "vitest";

import {
  type AccountInfo,
  accountRefusal,
  reportsOf,
  type SDKMessage,
  transcriptRefusal,
  userMessageOf,
} from "../../src/sessionWorker/claudeMessages";

const ID = "0b5e";

/** The SDK's messages carry dozens of fields these reports never read; a fixture spells only the ones they do. */
function sdk({ message }: { message: Record<string, unknown> }): SDKMessage {
  return message as unknown as SDKMessage;
}

function assistant({ parent, content }: { parent: string | null; content: readonly unknown[] }): SDKMessage {
  return sdk({ message: { message: { content }, parent_tool_use_id: parent, type: "assistant" } });
}

describe("userMessageOf", () => {
  it("makes one top-level user message of the typed text", () => {
    expect(userMessageOf({ text: "hello" })).toEqual({
      message: { content: "hello", role: "user" },
      parent_tool_use_id: null,
      type: "user",
    });
  });
});

describe("reportsOf", () => {
  it("reports each text block of a top-level assistant message, in order, and nothing for a tool call", () => {
    const message = assistant({
      content: [
        { text: "one", type: "text" },
        { id: "t", input: {}, name: "Bash", type: "tool_use" },
        { text: "two", type: "text" },
      ],
      parent: null,
    });
    expect(reportsOf({ message, sessionId: ID })).toEqual([
      { kind: "agent-text", sessionId: ID, text: "one" },
      { kind: "agent-text", sessionId: ID, text: "two" },
    ]);
  });

  it("reports nothing a subagent says", () => {
    const message = assistant({ content: [{ text: "inner", type: "text" }], parent: "toolu_1" });
    expect(reportsOf({ message, sessionId: ID })).toEqual([]);
  });

  it("ends a successful turn as end_turn, and any other with the result's own subtype", () => {
    const success = sdk({ message: { is_error: false, subtype: "success", type: "result" } });
    expect(reportsOf({ message: success, sessionId: ID })).toEqual([
      { kind: "turn-ended", sessionId: ID, stopReason: "end_turn" },
    ]);
    const failedSuccess = sdk({ message: { is_error: true, subtype: "success", type: "result" } });
    expect(reportsOf({ message: failedSuccess, sessionId: ID })).toEqual([
      { kind: "turn-ended", sessionId: ID, stopReason: "success" },
    ]);
    const interrupted = sdk({ message: { is_error: true, subtype: "error_during_execution", type: "result" } });
    expect(reportsOf({ message: interrupted, sessionId: ID })).toEqual([
      { kind: "turn-ended", sessionId: ID, stopReason: "error_during_execution" },
    ]);
  });

  it("reports nothing for a system message", () => {
    expect(reportsOf({ message: sdk({ message: { subtype: "init", type: "system" } }), sessionId: ID })).toEqual([]);
  });
});

describe("accountRefusal", () => {
  it("accepts a subscription login with no key source", () => {
    const account: AccountInfo = { subscriptionType: "max" };
    expect(accountRefusal({ account })).toBe(undefined);
  });

  it("refuses every metered key source, whatever the subscription", () => {
    const sources = ["ANTHROPIC_API_KEY", "apiKeyHelper", "/login managed key"] as const;
    expect(
      sources.map((apiKeySource) => accountRefusal({ account: { apiKeySource, subscriptionType: "max" } })),
    ).toEqual(
      sources.map(
        (source) => `the session resolved a metered credential (${source}) instead of the plan's routed login`,
      ),
    );
  });

  it("refuses a login reporting no subscription", () => {
    const why = "the session reported no subscription for its login, so the plan's routed login could not be confirmed";
    expect(accountRefusal({ account: {} })).toBe(why);
    expect(accountRefusal({ account: { subscriptionType: "" } })).toBe(why);
  });
});

describe("transcriptRefusal", () => {
  const MINTED = "a0000107-0000-4000-8000-000000000118";

  it("passes a message carrying the transcript id the app minted", () => {
    const message = sdk({ message: { session_id: MINTED, subtype: "init", type: "system" } });
    expect(transcriptRefusal({ message, vendorSessionId: MINTED })).toBeUndefined();
  });

  it("refuses a message from any other transcript, naming both ids", () => {
    const message = sdk({ message: { session_id: "1f2e3d4c-0000-4000-8000-000000000000", type: "result" } });
    expect(transcriptRefusal({ message, vendorSessionId: MINTED })).toBe(
      `the session streamed transcript 1f2e3d4c-0000-4000-8000-000000000000, not the ${MINTED} the app recorded for it`,
    );
  });
});

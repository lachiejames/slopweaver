/*
 * What crosses between the worker wire and the Agent SDK: a prompt becomes one user message, a top-level assistant
 * message's text becomes agent-text, each tool call and tool result becomes a tool activity carrying no input or
 * output, a result becomes exactly one turn-ended, and an account the plan did not route is refused.
 */
import { createHash } from "node:crypto";

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

/** A call id as the worker reports it: its digest, never the vendor's own string. */
function d({ id }: { id: string }): string {
  return `sha256:${createHash("sha256").update(id).digest("hex")}`;
}

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
  it("reports each text block of a top-level assistant message, in order, and a tool call as its activity", () => {
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
      {
        activity: { name: "Bash", status: "in_progress", toolCallId: d({ id: "t" }), toolKind: "execute" },
        kind: "tool-activity",
        sessionId: ID,
      },
      { kind: "agent-text", sessionId: ID, text: "two" },
    ]);
  });

  it("keeps the bare name of the tool that arms a supervisor's sweep, which a takeover reads off the picture", () => {
    const message = assistant({
      content: [{ id: "w", input: { delaySeconds: 1200 }, name: "ScheduleWakeup", type: "tool_use" }],
      parent: null,
    });
    expect(reportsOf({ message, sessionId: ID })).toEqual([
      {
        activity: { name: "ScheduleWakeup", status: "in_progress", toolCallId: d({ id: "w" }), toolKind: "other" },
        kind: "tool-activity",
        sessionId: ID,
      },
    ]);
  });

  it("reports nothing a subagent says", () => {
    const message = assistant({ content: [{ text: "inner", type: "text" }], parent: "toolu_1" });
    expect(reportsOf({ message, sessionId: ID })).toEqual([]);
  });

  it("reports a subagent's tool call under the call that started it, and never its input", () => {
    const secret = "FIXTURE-SECRET-INPUT";
    const message = assistant({
      content: [
        { text: "inner", type: "text" },
        { id: "toolu_2", input: { command: `echo ${secret}` }, name: "Grep", type: "tool_use" },
      ],
      parent: "toolu_1",
    });
    const reports = reportsOf({ message, sessionId: ID });
    expect(reports).toEqual([
      {
        activity: {
          name: "Grep",
          parentToolCallId: d({ id: "toolu_1" }),
          status: "in_progress",
          toolCallId: d({ id: "toolu_2" }),
          toolKind: "search",
        },
        kind: "tool-activity",
        sessionId: ID,
      },
    ]);
    expect(JSON.stringify(message)).toContain(secret);
    expect(JSON.stringify(reports)).not.toContain(secret);
  });

  it("drops a tool name that is not a bare identifier, and digests the id, keeping the call", () => {
    const message = assistant({
      content: [{ id: "toolu 9", input: {}, name: "run the tests", type: "tool_use" }],
      parent: null,
    });
    expect(reportsOf({ message, sessionId: ID })).toEqual([
      {
        activity: {
          status: "in_progress",
          toolCallId: d({ id: "toolu 9" }),
          toolKind: "other",
        },
        kind: "tool-activity",
        sessionId: ID,
      },
    ]);
  });

  it("calls an MCP tool's kind other, and a delegation's delegate", () => {
    const message = assistant({
      content: [
        { id: "a", input: {}, name: "mcp__acme__search", type: "tool_use" },
        { id: "b", input: {}, name: "Agent", type: "tool_use" },
      ],
      parent: null,
    });
    expect(reportsOf({ message, sessionId: ID })).toEqual([
      {
        activity: { name: "mcp__acme__search", status: "in_progress", toolCallId: d({ id: "a" }), toolKind: "other" },
        kind: "tool-activity",
        sessionId: ID,
      },
      {
        activity: { name: "Agent", status: "in_progress", toolCallId: d({ id: "b" }), toolKind: "delegate" },
        kind: "tool-activity",
        sessionId: ID,
      },
    ]);
  });

  it("ends each tool result's call, failed when it errored, and never reads the result's content", () => {
    const secret = "FIXTURE-SECRET-OUTPUT";
    const message = sdk({
      message: {
        message: {
          content: [
            { content: secret, tool_use_id: "t1", type: "tool_result" },
            { content: [{ text: secret, type: "text" }], is_error: true, tool_use_id: "t2", type: "tool_result" },
            { text: "beside", type: "text" },
          ],
          role: "user",
        },
        parent_tool_use_id: null,
        tool_use_result: { stdout: secret },
        type: "user",
      },
    });
    const reports = reportsOf({ message, sessionId: ID });
    expect(reports).toEqual([
      { activity: { status: "completed", toolCallId: d({ id: "t1" }) }, kind: "tool-activity", sessionId: ID },
      { activity: { status: "failed", toolCallId: d({ id: "t2" }) }, kind: "tool-activity", sessionId: ID },
    ]);
    expect(JSON.stringify(message)).toContain(secret);
    expect(JSON.stringify(reports)).not.toContain(secret);
  });

  it("ends a subagent's tool result under its parent", () => {
    const message = sdk({
      message: {
        message: { content: [{ content: "", tool_use_id: "t3", type: "tool_result" }], role: "user" },
        parent_tool_use_id: "toolu_1",
        type: "user",
      },
    });
    expect(reportsOf({ message, sessionId: ID })).toEqual([
      {
        activity: { parentToolCallId: d({ id: "toolu_1" }), status: "completed", toolCallId: d({ id: "t3" }) },
        kind: "tool-activity",
        sessionId: ID,
      },
    ]);
  });

  it("reports nothing for a replayed message or a typed prompt", () => {
    const replay = sdk({
      message: {
        isReplay: true,
        message: { content: [{ content: "", tool_use_id: "t4", type: "tool_result" }], role: "user" },
        parent_tool_use_id: null,
        type: "user",
      },
    });
    expect(reportsOf({ message: replay, sessionId: ID })).toEqual([]);
    const prompt = sdk({
      message: { message: { content: "hello", role: "user" }, parent_tool_use_id: null, type: "user" },
    });
    expect(reportsOf({ message: prompt, sessionId: ID })).toEqual([]);
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

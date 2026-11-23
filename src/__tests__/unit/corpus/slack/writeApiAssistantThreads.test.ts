/**
 * The two `assistant.threads.*` writes over a client standing in for `WebClient`: each sends its exact
 * argument object, an SDK throw carrying Slack's body on `error.data` becomes the typed refusal that body
 * describes instead of a rejection, a throw carrying no body is rethrown as itself after one attempt, and
 * the status write omits every optional key the caller left `undefined`.
 */
import { describe, expect, it } from "vitest";

import {
  type SetAssistantStatusRequest,
  type SetThreadTitleRequest,
  setAssistantStatusCall,
  setThreadTitleCall,
} from "../../../../corpus/slack/writeApiAssistantThreads.js";
import { err, ok } from "../../../../lib/result.js";
import type { AssistantStatusArgs } from "../../../../outbound/assistant/status.js";
import type { AssistantTitleArgs } from "../../../../outbound/assistant/title.js";

const TITLE_ARGS: AssistantTitleArgs = { channel_id: "D0123", thread_ts: "1700000000.000100", title: "why is it red" };

/** What the SDK throws on `ok:false`: an error whose `data` is Slack's own refusal body. */
function missingScopeThrow(): Error {
  return Object.assign(new Error("An API error occurred: missing_scope"), {
    data: { error: "missing_scope", needed: "assistant:write", ok: false },
  });
}

/** A title method answering every call with one scripted outcome, recording what it was sent. */
function titleMethod({ answer }: { answer: () => unknown }): {
  setTitle: SetThreadTitleRequest;
  sent: AssistantTitleArgs[];
} {
  const sent: AssistantTitleArgs[] = [];
  const setTitle: SetThreadTitleRequest = async (args) => {
    sent.push(args);
    return answer();
  };
  return { sent, setTitle };
}

/** A status method answering every call with one scripted outcome, recording what it was sent. */
function statusMethod({ answer }: { answer: () => unknown }): {
  setStatus: SetAssistantStatusRequest;
  sent: Parameters<SetAssistantStatusRequest>[0][];
} {
  const sent: Parameters<SetAssistantStatusRequest>[0][] = [];
  const setStatus: SetAssistantStatusRequest = async (args) => {
    sent.push(args);
    return answer();
  };
  return { sent, setStatus };
}

describe("setThreadTitleCall", () => {
  it("sends the exact argument object and reads an ok body as a set title", async () => {
    const { sent, setTitle } = titleMethod({ answer: () => ({ ok: true }) });

    const outcome = await setThreadTitleCall({
      args: TITLE_ARGS,
      client: { assistant: { threads: { setTitle } } },
      scopeId: "scope-title-ok",
    });

    expect(sent).toEqual([{ channel_id: "D0123", thread_ts: "1700000000.000100", title: "why is it red" }]);
    expect(outcome).toEqual(ok(undefined));
  });

  it("turns a thrown missing_scope body into a refusal naming the scope, rather than rejecting", async () => {
    const { sent, setTitle } = titleMethod({
      answer: () => {
        throw missingScopeThrow();
      },
    });

    const outcome = await setThreadTitleCall({
      args: TITLE_ARGS,
      client: { assistant: { threads: { setTitle } } },
      scopeId: "scope-title-scope",
    });

    expect(sent.length).toBe(1);
    expect(outcome).toEqual(
      err({
        error: "missing_scope",
        neededScope: "assistant:write",
        reason:
          "assistant.threads.setTitle refused: missing_scope — add the `assistant:write` scope and reinstall the app",
      }),
    );
  });

  it("rethrows a throw that carries no Slack body as the same error, after one attempt", async () => {
    const thrown = new Error("the socket closed before Slack answered");
    const { sent, setTitle } = titleMethod({
      answer: () => {
        throw thrown;
      },
    });

    const outcome = setThreadTitleCall({
      args: TITLE_ARGS,
      client: { assistant: { threads: { setTitle } } },
      scopeId: "scope-title-throw",
    });

    await expect(outcome).rejects.toBe(thrown);
    expect(sent.length).toBe(1);
  });
});

describe("setAssistantStatusCall", () => {
  it("sends only the required wire keys when every optional field is undefined", async () => {
    const { sent, setStatus } = statusMethod({ answer: () => ({ ok: true }) });
    const args: AssistantStatusArgs = {
      channel_id: "C0456",
      icon_emoji: undefined,
      loading_messages: undefined,
      status: "is reading the thread…",
      thread_ts: "1700000000.000200",
      username: undefined,
    };

    const outcome = await setAssistantStatusCall({
      args,
      client: { assistant: { threads: { setStatus } } },
      scopeId: "scope-status-bare",
    });

    expect(sent).toStrictEqual([
      { channel_id: "C0456", status: "is reading the thread…", thread_ts: "1700000000.000200" },
    ]);
    expect(Object.keys(sent[0]!)).toEqual(["channel_id", "status", "thread_ts"]);
    expect(outcome).toEqual(ok(undefined));
  });

  it("sends loading messages, username and icon unchanged when they are present", async () => {
    const { sent, setStatus } = statusMethod({ answer: () => ({ ok: true }) });
    const loadingMessages = ["reading the thread", "checking the graph"];

    await setAssistantStatusCall({
      args: {
        channel_id: "C0456",
        icon_emoji: ":mag:",
        loading_messages: loadingMessages,
        status: "is investigating…",
        thread_ts: "1700000000.000200",
        username: "Slopweaver (Datadog)",
      },
      client: { assistant: { threads: { setStatus } } },
      scopeId: "scope-status-full",
    });

    expect(sent).toStrictEqual([
      {
        channel_id: "C0456",
        icon_emoji: ":mag:",
        loading_messages: ["reading the thread", "checking the graph"],
        status: "is investigating…",
        thread_ts: "1700000000.000200",
        username: "Slopweaver (Datadog)",
      },
    ]);
  });

  it("turns a thrown missing_scope body into a refusal naming the scope, rather than rejecting", async () => {
    const { sent, setStatus } = statusMethod({
      answer: () => {
        throw missingScopeThrow();
      },
    });

    const outcome = await setAssistantStatusCall({
      args: { channel_id: "C0456", status: "", thread_ts: "1700000000.000200" },
      client: { assistant: { threads: { setStatus } } },
      scopeId: "scope-status-scope",
    });

    expect(sent.length).toBe(1);
    expect(outcome).toEqual(
      err({
        error: "missing_scope",
        neededScope: "assistant:write",
        reason:
          "assistant.threads.setStatus refused: missing_scope — add the `assistant:write` scope and reinstall the app",
      }),
    );
  });

  it("rethrows a throw that carries no Slack body as the same error, after one attempt", async () => {
    const thrown = Object.assign(new Error("the socket closed before Slack answered"), { data: "not a body" });
    const { sent, setStatus } = statusMethod({
      answer: () => {
        throw thrown;
      },
    });

    const outcome = setAssistantStatusCall({
      args: { channel_id: "C0456", status: "", thread_ts: "1700000000.000200" },
      client: { assistant: { threads: { setStatus } } },
      scopeId: "scope-status-throw",
    });

    await expect(outcome).rejects.toBe(thrown);
    expect(sent.length).toBe(1);
  });
});

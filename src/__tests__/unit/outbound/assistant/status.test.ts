import { describe, expect, it } from "vitest";
import { err, ok } from "../../../../lib/result.js";

import {
  ASSISTANT_STATUS_MAX_LOADING_MESSAGES,
  ASSISTANT_STATUS_METHOD,
  ASSISTANT_STATUS_SCOPE,
  ASSISTANT_STATUS_TIMEOUT_MS,
  type AssistantStatusArgs,
  type AssistantStatusTransport,
  assistantStatusArgs,
  readAssistantStatusResponse,
  setAssistantStatus,
} from "../../../../outbound/assistant/status.js";

/**
 * The two response bodies below are the ACTUAL bodies Slack returned to this repo's bot token —
 * `ok:true` for setStatus, and the `missing_scope` refusal that `assistant.threads.setTitle` gave. They are
 * fixtures, not inventions, which is what makes the refusal-reading assertions worth anything.
 */
const OK_BODY = { ok: true, response_metadata: { acceptedScopes: ["chat:write"] } };
const MISSING_SCOPE_BODY = { error: "missing_scope", needed: "assistant:write", ok: false };

/** A plain fake transport — a function seam, not a mock. It records what it was handed. */
function fakeTransport({ body }: { body: unknown }): AssistantStatusTransport & {
  readonly seen: { method?: string; args?: AssistantStatusArgs }[];
} {
  const seen: { method?: string; args?: AssistantStatusArgs }[] = [];
  return {
    call: (input) => {
      seen.push(input);
      return Promise.resolve(body);
    },
    seen,
  };
}

describe("the contract constants", () => {
  it("names the method Slack actually exposes", () => {
    expect(ASSISTANT_STATUS_METHOD).toBe("assistant.threads.setStatus");
  });

  it("names chat:write — measured as the accepted scope, and the one Slack is transitioning to", () => {
    expect(ASSISTANT_STATUS_SCOPE).toBe("chat:write");
  });

  it("carries Slack's documented two-minute status timeout, so a long turn knows to re-assert", () => {
    expect(ASSISTANT_STATUS_TIMEOUT_MS).toBe(120_000);
  });

  it("carries Slack's ceiling on rotating loading messages", () => {
    expect(ASSISTANT_STATUS_MAX_LOADING_MESSAGES).toBe(10);
  });
});

describe("assistantStatusArgs", () => {
  it("snake_cases the required trio and emits nothing else", () => {
    expect(
      assistantStatusArgs({ channelId: "D_REDACTED", status: "is measuring…", threadTs: "1785941533.765759" }),
    ).toEqual({ channel_id: "D_REDACTED", status: "is measuring…", thread_ts: "1785941533.765759" });
  });

  it("carries the per-task identity through when given it", () => {
    expect(
      assistantStatusArgs({
        channelId: "D1",
        iconEmoji: ":robot_face:",
        status: "is measuring…",
        threadTs: "1.1",
        username: "slopweaver-bot [measuring the agent surface]",
      }),
    ).toEqual({
      channel_id: "D1",
      icon_emoji: ":robot_face:",
      status: "is measuring…",
      thread_ts: "1.1",
      username: "slopweaver-bot [measuring the agent surface]",
    });
  });

  it("accepts exactly ten loading messages", () => {
    const loadingMessages = Array.from({ length: 10 }, (_, i) => `msg ${String(i)}`);
    expect(
      assistantStatusArgs({ channelId: "D1", loadingMessages, status: "s", threadTs: "1.1" }).loading_messages,
    ).toEqual(loadingMessages);
  });

  it("REFUSES an eleventh loading message rather than letting Slack drop it silently", () => {
    const loadingMessages = Array.from({ length: 11 }, (_, i) => `msg ${String(i)}`);
    expect(() => assistantStatusArgs({ channelId: "D1", loadingMessages, status: "s", threadTs: "1.1" })).toThrow(
      "11 loading messages exceeds Slack's ceiling of 10",
    );
  });

  it("omits an absent loading list rather than sending an empty array", () => {
    expect("loading_messages" in assistantStatusArgs({ channelId: "D1", status: "s", threadTs: "1.1" })).toBe(false);
  });
});

describe("readAssistantStatusResponse", () => {
  it("reads the real ok body as set", () => {
    expect(readAssistantStatusResponse({ body: OK_BODY })).toEqual(ok(undefined));
  });

  it("reads the real missing_scope refusal and carries the scope that would fix it", () => {
    expect(readAssistantStatusResponse({ body: MISSING_SCOPE_BODY })).toEqual(
      err({
        error: "missing_scope",
        neededScope: "assistant:write",
        reason:
          "assistant.threads.setStatus refused: missing_scope — add the `assistant:write` scope and reinstall the app",
      }),
    );
  });

  it("reads a refusal with no needed scope without inventing one", () => {
    expect(readAssistantStatusResponse({ body: { error: "channel_not_found", ok: false } })).toEqual(
      err({
        error: "channel_not_found",
        reason: "assistant.threads.setStatus refused: channel_not_found",
      }),
    );
  });

  it("treats ok:false with no error string as a refusal that says it could not tell", () => {
    expect(readAssistantStatusResponse({ body: { ok: false } })).toEqual(
      err({
        error: "unreadable_response",
        reason: "assistant.threads.setStatus refused: unreadable_response",
      }),
    );
  });

  it("treats a NON-true ok as a refusal — a truthy string must not read as success", () => {
    expect(readAssistantStatusResponse({ body: { ok: "true" } })).toEqual(
      err({
        error: "unreadable_response",
        reason: "assistant.threads.setStatus refused: unreadable_response",
      }),
    );
  });

  it("treats a body that is not an object as a refusal", () => {
    const refusal = err({
      error: "unreadable_response",
      reason: "assistant.threads.setStatus refused: unreadable_response",
    });
    expect(readAssistantStatusResponse({ body: undefined })).toEqual(refusal);
    expect(readAssistantStatusResponse({ body: null })).toEqual(refusal);
    expect(readAssistantStatusResponse({ body: "ok" })).toEqual(refusal);
  });
});

describe("setAssistantStatus", () => {
  it("calls the transport with the owned method name and the args verbatim", async () => {
    const transport = fakeTransport({ body: OK_BODY });
    const args = assistantStatusArgs({ channelId: "D1", status: "is measuring…", threadTs: "1.1" });
    const outcome = await setAssistantStatus({ args, transport });
    expect(outcome).toEqual(ok(undefined));
    expect(transport.seen).toEqual([{ args, method: "assistant.threads.setStatus" }]);
  });

  it("returns the refusal rather than throwing or falling back", async () => {
    const outcome = await setAssistantStatus({
      args: assistantStatusArgs({ channelId: "D1", status: "s", threadTs: "1.1" }),
      transport: fakeTransport({ body: MISSING_SCOPE_BODY }),
    });
    expect(outcome).toEqual(
      err({
        error: "missing_scope",
        neededScope: "assistant:write",
        reason:
          "assistant.threads.setStatus refused: missing_scope — add the `assistant:write` scope and reinstall the app",
      }),
    );
  });

  it("calls the transport exactly once — no retry hidden in the edge", async () => {
    const transport = fakeTransport({ body: MISSING_SCOPE_BODY });
    await setAssistantStatus({
      args: assistantStatusArgs({ channelId: "D1", status: "s", threadTs: "1.1" }),
      transport,
    });
    expect(transport.seen.length).toBe(1);
  });
});

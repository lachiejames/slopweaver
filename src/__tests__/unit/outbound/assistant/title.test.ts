/**
 * The `assistant.threads.setTitle` contract: the title a question becomes, the exact wire arguments, and the
 * reading of a refusal. Pure — no socket, no clock.
 */
import { describe, expect, it } from "vitest";
import { err, ok } from "../../../../lib/result.js";

import {
  ASSISTANT_TITLE_FALLBACK,
  ASSISTANT_TITLE_MAX_CHARS,
  ASSISTANT_TITLE_METHOD,
  ASSISTANT_TITLE_SCOPE,
  assistantTitleArgs,
  readAssistantTitleResponse,
  threadTitleFor,
} from "../../../../outbound/assistant/title.js";

describe("threadTitleFor", () => {
  it("uses the question itself, so the container row says what the thread is about", () => {
    expect(threadTitleFor({ question: "what shipped this week?" })).toBe("what shipped this week?");
  });

  it("trims the surrounding whitespace the tag stripper leaves behind", () => {
    expect(threadTitleFor({ question: "  yo  " })).toBe("yo");
  });

  it("falls back rather than setting an empty title when the message carried no words", () => {
    expect(threadTitleFor({ question: "   " })).toBe(ASSISTANT_TITLE_FALLBACK);
  });

  it("uses only the first line, so a pasted question does not put newlines in a side-panel row", () => {
    expect(threadTitleFor({ question: "first line\nsecond line" })).toBe("first line");
  });

  it("keeps a title of exactly the maximum length whole", () => {
    const exact = "x".repeat(ASSISTANT_TITLE_MAX_CHARS);

    expect(threadTitleFor({ question: exact })).toBe(exact);
  });

  it("clamps a longer one with an ellipsis, so it reads as truncated and not as having stopped", () => {
    expect(threadTitleFor({ question: "x".repeat(200) })).toBe(`${"x".repeat(ASSISTANT_TITLE_MAX_CHARS - 1)}…`);
  });
});

describe("assistantTitleArgs", () => {
  it("snake_cases the wire arguments exactly as the method wants them", () => {
    expect(assistantTitleArgs({ channelId: "D0OWNER", threadTs: "1785998605.523229", title: "yo" })).toEqual({
      channel_id: "D0OWNER",
      thread_ts: "1785998605.523229",
      title: "yo",
    });
  });
});

describe("readAssistantTitleResponse", () => {
  it("reads a set title", () => {
    expect(readAssistantTitleResponse({ body: { ok: true } })).toEqual(ok(undefined));
  });

  it("surfaces the scope a missing_scope refusal names, because that string IS the fix", () => {
    const outcome = readAssistantTitleResponse({
      body: { error: "missing_scope", needed: ASSISTANT_TITLE_SCOPE, ok: false },
    });

    expect(outcome).toEqual(
      err({
        error: "missing_scope",
        neededScope: ASSISTANT_TITLE_SCOPE,
        reason: `${ASSISTANT_TITLE_METHOD} refused: missing_scope — add the \`assistant:write\` scope and reinstall the app`,
      }),
    );
  });

  it("reads a refusal that names no scope without inventing one", () => {
    const outcome = readAssistantTitleResponse({ body: { error: "channel_not_found", ok: false } });

    expect(outcome).toEqual(
      err({
        error: "channel_not_found",
        reason: `${ASSISTANT_TITLE_METHOD} refused: channel_not_found`,
      }),
    );
  });

  it("treats a string `ok` as a refusal, because a truthy body is not a set title", () => {
    const outcome = readAssistantTitleResponse({ body: { error: "nope", ok: "true" } });

    expect(outcome).toEqual(err({ error: "nope", reason: `${ASSISTANT_TITLE_METHOD} refused: nope` }));
  });

  it("refuses an unrecognisable body rather than collapsing 'I could not tell' into 'it worked'", () => {
    const outcome = readAssistantTitleResponse({ body: "not an object" });

    expect(outcome).toEqual(
      err({
        error: "unreadable_response",
        reason: `${ASSISTANT_TITLE_METHOD} refused: unreadable_response`,
      }),
    );
  });

  it("refuses an undefined body the same way", () => {
    const outcome = readAssistantTitleResponse({ body: undefined });

    expect(outcome).toEqual(
      err({
        error: "unreadable_response",
        reason: `${ASSISTANT_TITLE_METHOD} refused: unreadable_response`,
      }),
    );
  });
});

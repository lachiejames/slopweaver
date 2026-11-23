/**
 * A replies read answering `thread_not_found` after history already missed is the message being gone, never a failed
 * read — the shape `slack delete` met on `C0SYN000001`/`1791764888.080129`.
 */
import { describe, expect, it } from "vitest";

import { isThreadNotFound } from "../../../../corpus/slack/writeApiRead.js";
import { type IngestError, toIngestError } from "../../../../lib/ingestError.js";

const OPERATION = "slack.conversations.replies";

/** A typed replies failure, mapped exactly as `safeProviderCall` maps a thrown SDK error. */
function repliesFailure({ thrown }: { thrown: unknown }): IngestError {
  return toIngestError({ error: thrown, operation: OPERATION, provider: "slack" });
}

/** The shape `@slack/web-api` throws for a platform error: its own code, Slack's code under `data.error`. */
function platformError({ slackCode }: { slackCode: string }): Error {
  return Object.assign(new Error(`An API error occurred: ${slackCode}`), {
    code: "slack_webapi_platform_error",
    data: { error: slackCode, ok: false },
  });
}

describe("isThreadNotFound", () => {
  it("reads Slack's platform answer off the SDK's own error, and off a typed code that is the Slack code itself", () => {
    const answered = repliesFailure({ thrown: platformError({ slackCode: "thread_not_found" }) });

    expect(answered.code).toBe("slack_webapi_platform_error");
    expect(isThreadNotFound({ error: answered })).toBe(true);
    expect(
      isThreadNotFound({ error: { code: "thread_not_found", kind: "http", message: "x", operation: OPERATION } }),
    ).toBe(true);
  });

  it("is false for every other failure, so a real read failure still refuses", () => {
    const notInChannel = repliesFailure({ thrown: platformError({ slackCode: "not_in_channel" }) });
    // A body naming thread_not_found on a request that itself failed.
    const body = { data: { error: "thread_not_found", ok: false } };
    const failedWithBody = Object.assign(new Error("server failure"), body);
    // A wrapper carrying the body whose 500 sits on its cause, out of the normaliser's reach.
    const wrapped500 = Object.assign(new Error("wrapped"), body, {
      cause: Object.assign(new Error("server failure"), { status: 500 }),
    });
    expect(
      [
        notInChannel,
        { kind: "network", message: "ECONNRESET", operation: OPERATION },
        { kind: "http", message: "thread_not_found in prose only", operation: OPERATION, status: 500 },
        { cause: "thread_not_found", kind: "http", message: "x", operation: OPERATION },
        { cause: failedWithBody, kind: "http", message: "x", operation: OPERATION, status: 500 },
        { cause: failedWithBody, kind: "rate-limit", message: "x", operation: OPERATION, status: 429 },
        { cause: failedWithBody, code: "thread_not_found", kind: "network", message: "x", operation: OPERATION },
        // Slack's rate-limit error carries no status at all.
        {
          cause: failedWithBody,
          code: "slack_webapi_rate_limited_error",
          kind: "rate-limit",
          message: "x",
          operation: OPERATION,
        },
        { cause: failedWithBody, kind: "http", message: "x", operation: OPERATION, status: 403 },
        repliesFailure({ thrown: wrapped500 }),
      ].map((error) => isThreadNotFound({ error: error as IngestError })),
    ).toEqual([false, false, false, false, false, false, false, false, false, false]);
  });
});

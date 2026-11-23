/**
 * `isAlreadyGone` and `isAlreadyStopped`, the idempotent delete and stopStream: Slack's platform code read off the
 * typed error, and a real failure never reported as done.
 */
import { describe, expect, it } from "vitest";

import { isAlreadyGone, isAlreadyStopped } from "../../../../../corpus/slack/writeApi.js";

describe("isAlreadyGone — the idempotent delete", () => {
  it("reads Slack's platform code out of the SDK error's `data.error`", () => {
    const cause = Object.assign(new Error("An API error occurred: message_not_found"), {
      code: "slack_webapi_platform_error",
      data: { error: "message_not_found", ok: false },
    });
    expect(
      isAlreadyGone({
        error: {
          cause,
          code: "slack_webapi_platform_error",
          kind: "http",
          message: "x",
          operation: "slack.chat.delete",
        },
      }),
    ).toBe(true);
  });

  it("also accepts the code when it sits directly on the typed error", () => {
    expect(
      isAlreadyGone({
        error: { code: "message_not_found", kind: "http", message: "x", operation: "slack.chat.delete" },
      }),
    ).toBe(true);
  });

  it("is FALSE for a real failure, so a delete that could not be performed is not reported as done", () => {
    const cause = Object.assign(new Error("cant_delete_message"), { data: { error: "cant_delete_message" } });
    expect(isAlreadyGone({ error: { cause, kind: "http", message: "x", operation: "slack.chat.delete" } })).toBe(false);
    expect(isAlreadyGone({ error: { kind: "network", message: "ECONNRESET", operation: "slack.chat.delete" } })).toBe(
      false,
    );
    expect(isAlreadyGone({ error: { kind: "http", message: "x", operation: "slack.chat.delete", status: 500 } })).toBe(
      false,
    );
  });

  it("is FALSE for a failed request whose body names message_not_found, since slack delete journals on it", () => {
    // A 5xx, a 4xx or Slack's status-less rate limit carrying the code in its body.
    const cause = Object.assign(new Error("server failure"), { data: { error: "message_not_found", ok: false } });
    const operation = "slack.chat.delete";
    expect(
      [
        { cause, kind: "http", message: "x", operation, status: 500 },
        { cause, kind: "http", message: "x", operation, status: 404 },
        { cause, code: "slack_webapi_rate_limited_error", kind: "rate-limit", message: "x", operation },
        { cause, code: "message_not_found", kind: "network", message: "x", operation },
      ].map((error) => isAlreadyGone({ error: error as Parameters<typeof isAlreadyGone>[0]["error"] })),
    ).toEqual([false, false, false, false]);
  });

  it("is FALSE when the error carries nothing to read", () => {
    expect(isAlreadyGone({ error: { kind: "http", message: "x", operation: "slack.chat.delete" } })).toBe(false);
    expect(
      isAlreadyGone({ error: { cause: "a bare string", kind: "http", message: "x", operation: "slack.chat.delete" } }),
    ).toBe(false);
  });
});

describe("isAlreadyStopped — the idempotent stopStream", () => {
  it("reads Slack's platform code out of the SDK error's `data.error`", () => {
    const cause = Object.assign(new Error("An API error occurred: message_not_in_streaming_state"), {
      data: { error: "message_not_in_streaming_state", ok: false },
    });
    expect(isAlreadyStopped({ error: { cause, kind: "http", message: "x", operation: "slack.chat.stopStream" } })).toBe(
      true,
    );
  });

  it("also accepts the code when it sits directly on the typed error", () => {
    expect(
      isAlreadyStopped({
        error: {
          code: "message_not_in_streaming_state",
          kind: "http",
          message: "x",
          operation: "slack.chat.stopStream",
        },
      }),
    ).toBe(true);
  });

  it("is FALSE for a real failure, so a stop that could not be performed is not reported as done", () => {
    const cause = Object.assign(new Error("missing_scope"), { data: { error: "missing_scope" } });
    expect(isAlreadyStopped({ error: { cause, kind: "http", message: "x", operation: "slack.chat.stopStream" } })).toBe(
      false,
    );
    expect(
      isAlreadyStopped({ error: { kind: "network", message: "ECONNRESET", operation: "slack.chat.stopStream" } }),
    ).toBe(false);
    expect(
      isAlreadyStopped({ error: { kind: "http", message: "x", operation: "slack.chat.stopStream", status: 500 } }),
    ).toBe(false);
  });

  it("is FALSE when the error carries nothing to read", () => {
    expect(isAlreadyStopped({ error: { kind: "http", message: "x", operation: "slack.chat.stopStream" } })).toBe(false);
    expect(
      isAlreadyStopped({
        error: { cause: "a bare string", kind: "http", message: "x", operation: "slack.chat.stopStream" },
      }),
    ).toBe(false);
  });
});

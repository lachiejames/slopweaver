/**
 * `isAlreadyStopped` — the pure half of the Slack stream writers: a failed stop or append reads as "already
 * stopped" when Slack's platform code is `message_not_in_streaming_state`, whether that code arrives as the
 * typed error's own `code` or inside the SDK's `data.error` on the original thrown value. Every error here is
 * built through `toIngestError`, the same mapper the provider door uses.
 */
import { describe, expect, it } from "vitest";

import { isAlreadyStopped } from "../../../../corpus/slack/writeApiStream.js";
import { type IngestError, toIngestError } from "../../../../lib/ingestError.js";

/** A typed stop failure, mapped exactly as `safeProviderCall` maps a thrown SDK error. */
function stopFailure({ thrown }: { thrown: unknown }): IngestError {
  return toIngestError({ error: thrown, operation: "slack.chat.stopStream", provider: "slack" });
}

/** The shape `@slack/web-api` throws for a platform error: its own code, Slack's code under `data.error`. */
function platformError({ slackCode }: { slackCode: string }): Error {
  return Object.assign(new Error(`An API error occurred: ${slackCode}`), {
    code: "slack_webapi_platform_error",
    data: { error: slackCode, ok: false },
  });
}

describe("isAlreadyStopped", () => {
  it("reads message_not_in_streaming_state carried as the error's own code as stopped, and message_not_found as not", () => {
    const stopped = stopFailure({
      thrown: Object.assign(new Error("stream gone"), { code: "message_not_in_streaming_state" }),
    });
    const neighbour = stopFailure({ thrown: Object.assign(new Error("gone"), { code: "message_not_found" }) });

    expect(stopped.code).toBe("message_not_in_streaming_state");
    expect(isAlreadyStopped({ error: stopped })).toBe(true);
    expect(neighbour.code).toBe("message_not_found");
    expect(isAlreadyStopped({ error: neighbour })).toBe(false);
  });

  it("reads message_not_in_streaming_state carried in the SDK's data.error as stopped, and message_not_found there as not", () => {
    const stopped = stopFailure({ thrown: platformError({ slackCode: "message_not_in_streaming_state" }) });
    const neighbour = stopFailure({ thrown: platformError({ slackCode: "message_not_found" }) });

    expect(stopped.code).toBe("slack_webapi_platform_error");
    expect(isAlreadyStopped({ error: stopped })).toBe(true);
    expect(isAlreadyStopped({ error: neighbour })).toBe(false);
  });

  it("does not count a message that merely mentions message_not_in_streaming_state with no code carrying it", () => {
    const error = stopFailure({ thrown: new Error("An API error occurred: message_not_in_streaming_state") });

    expect(error.code).toBe(undefined);
    expect(isAlreadyStopped({ error })).toBe(false);
  });
});

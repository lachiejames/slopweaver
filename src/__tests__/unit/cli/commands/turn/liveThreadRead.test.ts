/**
 * The two reasons a live thread read did not happen, as the send preflight and the round-1 preflight both
 * print them. The read itself is network-bound and is proven by the subprocess lane; this pins the factory
 * every caller branches and prints on.
 */
import { describe, expect, it } from "vitest";

import { LiveThreadReadErrors } from "../../../../../cli/commands/turn/liveThreadRead.js";

describe("LiveThreadReadErrors", () => {
  it("names the missing token and the verb that lists which ones are configured", () => {
    const error = LiveThreadReadErrors.tokenMissing();
    expect(error.code).toBe("SLACK_READ_TOKEN_MISSING");
    expect(error.message).toBe(
      "could not read the thread live — no Slack read token is configured (`slopweaver secrets status`)",
    );
  });

  it("carries the provider's own cause on a failed read", () => {
    const error = LiveThreadReadErrors.readFailed({ cause: "channel_not_found" });
    expect(error.code).toBe("THREAD_READ_FAILED");
    expect(error.message).toBe("could not read the thread live: channel_not_found");
  });
});

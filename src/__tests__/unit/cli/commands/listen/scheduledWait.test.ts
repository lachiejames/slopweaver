/**
 * `waitUntilDueOrDeadline` — which of the next due sweep and a recipe deadline elapsed first. Every case sits
 * at or past both instants on an injected clock, so the real timer is armed for zero milliseconds and the
 * suite never waits on the wall clock.
 */
import { describe, expect, it } from "vitest";

import { waitUntilDueOrDeadline } from "../../../../../cli/commands/listen/scheduledWait.js";

const NOW_MS = 1_700_000_000_000;

describe("waitUntilDueOrDeadline", () => {
  it("answers due when no deadline is armed", async () => {
    const waited = await waitUntilDueOrDeadline({ deadlineMs: undefined, dueAtMs: NOW_MS - 1, nowMs: () => NOW_MS });
    expect(waited).toBe("due");
  });

  it("answers clock-wake when the deadline is no later than the due sweep", async () => {
    const waited = await waitUntilDueOrDeadline({ deadlineMs: NOW_MS, dueAtMs: NOW_MS, nowMs: () => NOW_MS });
    expect(waited).toBe("clock-wake");
  });
});

import { describe, expect, it } from "vitest";

import { ASSISTANT_STATUS_REASSERT_MS } from "../../../../../live/turn/poster.js";
import { ASSISTANT_STATUS_TIMEOUT_MS } from "../../../../../outbound/assistant/status.js";
import { usePosterHome } from "./harness.js";

usePosterHome();

describe("ASSISTANT_STATUS_REASSERT_MS", () => {
  it("re-asserts strictly under Slack's documented 2-minute status timeout", () => {
    expect(ASSISTANT_STATUS_REASSERT_MS).toBeLessThan(ASSISTANT_STATUS_TIMEOUT_MS);
  });

  it("keeps a real margin rather than shaving the timeout to the millisecond", () => {
    // A 20-second margin, named as a design choice in the module comment. Pinned as an exact value so the
    // choice is visible in a diff rather than merely satisfying the inequality above by one millisecond.
    expect(ASSISTANT_STATUS_TIMEOUT_MS - ASSISTANT_STATUS_REASSERT_MS).toBe(20_000);
  });
});

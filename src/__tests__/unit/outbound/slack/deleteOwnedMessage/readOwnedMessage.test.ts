/*
 * `readOwnedMessage`: the ownership read `deleteOwnedMessage` starts with, handing the whole message back or refusing
 * with the same domain error.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { readOwnedMessage } from "../../../../../outbound/slack/deleteOwnedMessage.js";
import type { ReadSlackMessage } from "../../../../../outbound/slack/lifecycleGuards.js";
import { ACCEPTED, fakeTransport, freshLog, OURS, TARGET } from "./harness.js";

describe("readOwnedMessage — the same read, without the delete", () => {
  it("hands the whole normalised message back so a caller can judge it before deciding", async () => {
    const log = freshLog();
    const withThread: ReadSlackMessage = { ...OURS, editedTs: "1790054600.000000", threadTs: "1790048427.171609" };
    const read = await readOwnedMessage({
      acceptUnmarked: false,
      expectedEventTypes: ACCEPTED,
      posted: TARGET,
      transport: fakeTransport({ log, message: withThread }),
    });

    expect(read.isOk()).toBe(true);
    expect(unwrap(read).threadTs).toBe("1790048427.171609");
    expect(unwrap(read).editedTs).toBe("1790054600.000000");
    expect(log.calls).toEqual(["readMessage", "whoAmI"]);
  });

  it("refuses with the same domain error the delete would have used", async () => {
    const log = freshLog();
    const read = await readOwnedMessage({
      acceptUnmarked: false,
      expectedEventTypes: ACCEPTED,
      posted: TARGET,
      transport: fakeTransport({ log, message: { ...OURS, botId: "B_OTHER" } }),
    });

    expect(unwrapErr(read).code).toBe("NOT_OURS");
  });
});

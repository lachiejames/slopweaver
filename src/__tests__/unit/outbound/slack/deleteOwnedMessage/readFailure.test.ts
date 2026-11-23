/*
 * A failed ownership read is never a pass: the read-back or the identity read throwing is named as such, and the
 * target is left standing.
 */
import { describe, expect, it } from "vitest";

import { unwrapErr } from "../../../../../lib/result.js";
import { deleteOwnedMessage } from "../../../../../outbound/slack/deleteOwnedMessage.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { ACCEPTED, fakeTransport, freshHome, freshLog, OURS, TARGET, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("deleteOwnedMessage — a read that fails is never a pass", () => {
  it("names the message read-back when that is what threw", async () => {
    const log = freshLog();
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      transport: fakeTransport({ log, message: OURS, readThrows: "conversations.history: ratelimited" }),
    });

    const error = unwrapErr(outcome);
    expect(error.code).toBe("OWNERSHIP_READ_FAILED");
    expect(error.message).toContain("read-message");
    expect(error.message).toContain("ratelimited");
    expect(log.deletes).toEqual([]);
  });

  it("names `auth.test` when the identity read is what threw", async () => {
    const log = freshLog();
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      transport: fakeTransport({ log, message: OURS, whoAmIThrows: "invalid_auth" }),
    });

    const error = unwrapErr(outcome);
    expect(error.code).toBe("OWNERSHIP_READ_FAILED");
    expect(error.message).toContain("who-am-i");
    expect(log.deletes).toEqual([]);
  });
});

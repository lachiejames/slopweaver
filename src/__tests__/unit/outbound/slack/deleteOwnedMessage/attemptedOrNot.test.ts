/*
 * A delete that was attempted, told apart from one that was not: a refused or thrown delete is unconfirmed, and a
 * decision the store could not record means the message is certainly untouched.
 */
import { describe, expect, it } from "vitest";

import { unwrapErr } from "../../../../../lib/result.js";
import { deleteOwnedMessage } from "../../../../../outbound/slack/deleteOwnedMessage.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { ACCEPTED, fakeTransport, freshHome, freshLog, OURS, TARGET, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("deleteOwnedMessage — what was attempted, told apart from what was not", () => {
  it("reports a refused delete as UNCONFIRMED, because the message may or may not be gone", async () => {
    const log = freshLog();
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      transport: fakeTransport({
        deleteOutcome: { kind: "failed", reason: "cant_delete_message" },
        log,
        message: OURS,
      }),
    });

    const error = unwrapErr(outcome);
    expect(error.code).toBe("DELETE_UNCONFIRMED");
    expect(error.message).toContain("cant_delete_message");
  });

  it("reports a THROWN delete as UNCONFIRMED too — the call was entered", async () => {
    const log = freshLog();
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      transport: fakeTransport({ deleteThrows: "socket hang up", log, message: OURS }),
    });

    const error = unwrapErr(outcome);
    expect(error.code).toBe("DELETE_UNCONFIRMED");
    expect(error.message).toContain("socket hang up");
    expect(log.calls).toEqual(["readMessage", "whoAmI", "deleteMessageOnce"]);
  });

  it("reports a decision the store could not record as DOOR_RECORDING_REFUSED, so the message is certainly untouched", async () => {
    const log = freshLog();

    // `throughDoor` records before it performs, so a store fault is exactly the window this arm names: it is an
    // infrastructure fault, never the door's policy refusal, and nothing was sent.
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: unreachableDoorLedger(),
      posted: TARGET,
      transport: fakeTransport({ log, message: OURS }),
    });

    const error = unwrapErr(outcome);
    expect(error.code).toBe("DOOR_RECORDING_REFUSED");
    expect(error.message).toContain(`the delete of ${TARGET.ts} was not performed: `);
    expect(log.calls).toEqual(["readMessage", "whoAmI"]);
    expect(log.deletes).toEqual([]);
  });
});

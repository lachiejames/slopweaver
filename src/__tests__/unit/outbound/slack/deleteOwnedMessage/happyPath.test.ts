/*
 * The delete that goes through: read back, identity confirmed and only then deleted, recorded in the door ledger,
 * an already-gone target reported as such, and a dry run that performs the read and nothing else.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../../lib/result.js";
import { deleteOwnedMessage } from "../../../../../outbound/slack/deleteOwnedMessage.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { ACCEPTED, fakeTransport, freshHome, freshLog, OURS, TARGET, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("deleteOwnedMessage — the happy path, and what it records", () => {
  it("reads the message back, confirms identity, and only then deletes", async () => {
    const log = freshLog();
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      transport: fakeTransport({ log, message: OURS }),
    });

    expect(outcome.isOk()).toBe(true);
    expect(unwrap(outcome)).toEqual({ kind: "deleted", posted: TARGET });
    expect(log.calls).toEqual(["readMessage", "whoAmI", "deleteMessageOnce"]);
    expect(log.deletes).toEqual([TARGET]);
  });

  it("records the delete in the door ledger as `slack delete`, naming the actor and the target", async () => {
    const door = memoryDoorLedger();
    await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: door.port,
      posted: TARGET,
      transport: fakeTransport({ log: freshLog(), message: OURS }),
    });

    const rows = door.records();
    expect(rows.length).toBe(1);
    expect(rows[0]!["action"]).toBe("verb:slack.delete");
    expect(rows[0]!["status"]).toBe("pass");
  });

  it("reports an already-gone target as such rather than as a delete it performed", async () => {
    const log = freshLog();
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      transport: fakeTransport({ deleteOutcome: { kind: "already-gone" }, log, message: OURS }),
    });

    expect(unwrap(outcome)).toEqual({ kind: "already-gone", posted: TARGET });
  });

  it("a dry run performs the ownership read, writes no door row and deletes nothing", async () => {
    const door = memoryDoorLedger();
    const log = freshLog();
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: true,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: door.port,
      posted: TARGET,
      transport: fakeTransport({ log, message: OURS }),
    });

    expect(unwrap(outcome)).toEqual({ kind: "dry-run", posted: TARGET });
    expect(log.calls).toEqual(["readMessage", "whoAmI"]);
    expect(log.deletes).toEqual([]);
    expect(door.records()).toEqual([]);
  });
});

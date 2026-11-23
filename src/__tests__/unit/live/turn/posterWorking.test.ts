import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SlackWriteTransport } from "../../../../corpus/slack/writeTransport.js";
import type { StartedChecklist } from "../../../../live/ask/checklist.js";
import type { AskIdentity } from "../../../../live/ask/identity.js";
import { deleteCapturedChecklist } from "../../../../live/turn/posterChecklistDelete.js";
import { reapEarlierCardImpl } from "../../../../live/turn/posterWorking.js";
import { DoorRecordingRefusedError } from "../../../../live/turn/run.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../doorLedgerFixture.js";
import { reactingTransport } from "../../../reactingTransportFake.js";

const ASK: AskIdentity = { channel: "D1", messageTs: "1700000000.000050", threadTs: "1700000000.000000" };
const STARTED: StartedChecklist = { turnId: "turn-capture-1", workingTs: "1700000000.000200" };

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "poster-working-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A transport logging every message write it is asked for, whose delete answers `deleteAnswers`. */
function loggingTransport({ calls, deleteAnswers }: { calls: unknown[]; deleteAnswers: boolean }): SlackWriteTransport {
  const base = reactingTransport({ standing: new Map() });
  const deleteMessage: SlackWriteTransport["deleteMessage"] = async ({ posted }) => {
    calls.push({ method: "deleteMessage", posted });
    return deleteAnswers;
  };
  const postTurn: SlackWriteTransport["postTurn"] = async (request) => {
    calls.push({ method: "postTurn", request });
    return base.postTurn(request);
  };
  const updateTurn: SlackWriteTransport["updateTurn"] = async (request) => {
    calls.push({ method: "updateTurn", request });
  };
  const addReaction: SlackWriteTransport["addReaction"] = async (request) => {
    calls.push({ method: "addReaction", request });
    return true;
  };
  const removeReaction: SlackWriteTransport["removeReaction"] = async (request) => {
    calls.push({ method: "removeReaction", request });
    return true;
  };
  return { ...base, addReaction, deleteMessage, postTurn, removeReaction, updateTurn };
}

describe("deleteCapturedChecklist", () => {
  it("deletes the capture checklist at its own ts in the ask's channel, and makes that one write", async () => {
    const calls: unknown[] = [];

    const deleted = await deleteCapturedChecklist({
      askIdentity: ASK,
      doorLedger: memoryDoorLedger().port,
      home,
      started: STARTED,
      transport: loggingTransport({ calls, deleteAnswers: true }),
    });

    expect(deleted).toBe(true);
    expect(calls).toEqual([{ method: "deleteMessage", posted: { channel: "D1", ts: "1700000000.000200" } }]);
  });

  it("throws a DoorRecordingRefusedError, not a false, and deletes nothing when the door's decision cannot be recorded", async () => {
    const calls: unknown[] = [];

    const thrown = await deleteCapturedChecklist({
      askIdentity: ASK,
      doorLedger: unreachableDoorLedger(),
      home,
      started: STARTED,
      transport: loggingTransport({ calls, deleteAnswers: true }),
    }).then(
      () => new Error("expected a refusal"),
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(DoorRecordingRefusedError);
    expect((thrown as DoorRecordingRefusedError).message).toContain(
      "the door's decision to delete the capture checklist could not be recorded, so nothing was deleted — ",
    );
    expect(calls).toEqual([]);
  });

  it("makes only the one delete at the working message's ts in the ask's channel, and answers false when the transport could not confirm it", async () => {
    const calls: unknown[] = [];

    const deleted = await deleteCapturedChecklist({
      askIdentity: ASK,
      doorLedger: memoryDoorLedger().port,
      home,
      started: STARTED,
      transport: loggingTransport({ calls, deleteAnswers: false }),
    });

    expect(deleted).toBe(false);
    expect(calls).toEqual([{ method: "deleteMessage", posted: { channel: "D1", ts: "1700000000.000200" } }]);
  });
});

describe("reapEarlierCardImpl", () => {
  const EARLIER = { channel: "D1", ts: "1700000000.000100" };

  it("deletes an earlier turn's card through the door, at that card's own ts, and answers true", async () => {
    const calls: unknown[] = [];

    const reaped = await reapEarlierCardImpl({
      askIdentity: ASK,
      doorLedger: memoryDoorLedger().port,
      home,
      posted: EARLIER,
      transport: loggingTransport({ calls, deleteAnswers: true }),
      turnId: "turn-2",
    });

    expect(reaped).toBe(true);
    expect(calls).toEqual([{ method: "deleteMessage", posted: EARLIER }]);
  });

  it("answers false rather than throwing, and deletes nothing, when the door's decision cannot be recorded", async () => {
    const calls: unknown[] = [];

    const reaped = await reapEarlierCardImpl({
      askIdentity: ASK,
      doorLedger: unreachableDoorLedger(),
      home,
      posted: EARLIER,
      transport: loggingTransport({ calls, deleteAnswers: true }),
      turnId: "turn-2",
    });

    expect(reaped).toBe(false);
    expect(calls).toEqual([]);
  });
});

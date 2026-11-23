import { describe, expect, it } from "vitest";

import type { StartedChecklist } from "../../../../../live/ask/checklist.js";
import { deleteCapturedChecklist } from "../../../../../live/turn/poster.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { DM_MENTION } from "./fixtures.js";
import { fakeTransport, home, type Recorded, usePosterHome } from "./harness.js";

usePosterHome();

describe("deleteCapturedChecklist — the scenario-4 structural cleanup", () => {
  const A_CHECKLIST: StartedChecklist = { turnId: "turn-capture-1", workingTs: "1700000000.000200" };

  it("deletes directly, targeting the checklist's OWN posted ts, not the answer's", async () => {
    const log: Recorded[] = [];

    const deleted = await deleteCapturedChecklist({
      askIdentity: DM_MENTION,
      doorLedger: memoryDoorLedger().port,
      home,
      started: A_CHECKLIST,
      transport: fakeTransport({ log }),
    });

    expect(deleted).toBe(true);
    expect(log).toEqual([
      { detail: { channel: DM_MENTION.channel, ts: A_CHECKLIST.workingTs }, method: "deleteMessage" },
    ]);
  });

  it("reports false, never throws, when the delete cannot be confirmed", async () => {
    const log: Recorded[] = [];

    const deleted = await deleteCapturedChecklist({
      askIdentity: DM_MENTION,
      doorLedger: memoryDoorLedger().port,
      home,
      started: A_CHECKLIST,
      transport: fakeTransport({ deleteSucceeds: false, log }),
    });

    expect(deleted).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { turnChecklist } from "../../../../../live/turn/answer.js";
import { liveTurnPoster, NO_MENTIONS } from "../../../../../live/turn/poster.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import {
  CARD_CHROME,
  CHROME,
  CLEAN_VERDICT,
  DM_MENTION,
  judge,
  NO_ROW,
  POSTED,
  PROVENANCE,
  READY,
} from "./fixtures.js";
import { fakeTransport, home, type Recorded, usePosterHome } from "./harness.js";

usePosterHome();

describe("liveTurnPoster — finalizeWorking corrects a static frame that could not be deleted", () => {
  it("writes the truthful frame through chat.update", async () => {
    const log: Recorded[] = [];
    const poster = liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: DM_MENTION,
      freshnessNote: undefined,
      verdict: CLEAN_VERDICT,
      chrome: CARD_CHROME,
      home,
      judge,
      mentions: NO_MENTIONS,
      provenance: PROVENANCE,
      readiness: READY,
      transport: fakeTransport({ log }),
      turnChrome: CHROME,
      turnId: "turn-1",
    });

    await poster.finalizeWorking({ posted: POSTED, steps: turnChecklist({ progress: { completed: 4 } }), task: "t" });

    expect(log.map((entry) => entry.method)).toEqual(["updateTurn"]);
  });

  it("NEVER throws, and reports false, when the underlying updateTurn call itself fails", async () => {
    const log: Recorded[] = [];
    const poster = liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: DM_MENTION,
      freshnessNote: undefined,
      verdict: CLEAN_VERDICT,
      chrome: CARD_CHROME,
      home,
      judge,
      mentions: NO_MENTIONS,
      provenance: PROVENANCE,
      readiness: READY,
      transport: fakeTransport({ log, updateTurnThrows: "internal_error" }),
      turnChrome: CHROME,
      turnId: "turn-1",
    });

    await expect(
      poster.finalizeWorking({ posted: POSTED, steps: turnChecklist({ progress: { completed: 4 } }), task: "t" }),
    ).resolves.toBe(false);
  });

  it("NEVER throws and still reports false even when the caught error's OWN `.message` getter throws — an adversarial review's counterexample", async () => {
    const log: Recorded[] = [];
    class HostileError extends Error {
      override get message(): string {
        throw new Error("message getter failed");
      }
    }
    const poster = liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: DM_MENTION,
      freshnessNote: undefined,
      verdict: CLEAN_VERDICT,
      chrome: CARD_CHROME,
      home,
      judge,
      mentions: NO_MENTIONS,
      provenance: PROVENANCE,
      readiness: READY,
      transport: fakeTransport({ log, updateTurnThrowsValue: new HostileError() }),
      turnChrome: CHROME,
      turnId: "turn-1",
    });

    await expect(
      poster.finalizeWorking({ posted: POSTED, steps: turnChecklist({ progress: { completed: 4 } }), task: "t" }),
    ).resolves.toBe(false);
  });
});

import { describe, expect, it } from "vitest";

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

describe("liveTurnPoster — deleteWorking deletes the static frame directly", () => {
  it("deletes without touching any stream method", async () => {
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

    const deleted = await poster.deleteWorking({ posted: POSTED });

    expect(deleted).toBe(true);
    expect(log).toEqual([{ detail: POSTED, method: "deleteMessage" }]);
  });

  it("reports false when the delete itself fails, so the caller can fall back", async () => {
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
      transport: fakeTransport({ deleteSucceeds: false, log }),
      turnChrome: CHROME,
      turnId: "turn-1",
    });

    expect(await poster.deleteWorking({ posted: POSTED })).toBe(false);
  });
});

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
import { detailAs, fakeTransport, home, type Recorded, usePosterHome } from "./harness.js";

usePosterHome();

describe("liveTurnPoster — advanceWorking edits the metadata-bearing frame", () => {
  it("updates the whole current projection and preserves ownership metadata", async () => {
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

    await poster.advanceWorking({ posted: POSTED, steps: turnChecklist({ progress: { completed: 2 } }), task: "t" });

    expect(log.map((entry) => entry.method)).toEqual(["updateTurn"]);
    const payload = detailAs<{ metadata: { event_payload: { renderer: string }; event_type: string } }>({
      detail: log[0]!.detail,
    });
    expect(payload.metadata).toEqual({
      event_payload: { renderer: "slack-turn-v1", schemaVersion: 1, turnId: "turn-1" },
      event_type: "test_turn_v1",
    });
  });
});

import { describe, expect, it } from "vitest";

import { turnChecklist } from "../../../../../live/turn/answer.js";
import { liveTurnPoster, NO_MENTIONS } from "../../../../../live/turn/poster.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { CARD_CHROME, CHROME, CLEAN_VERDICT, DM_MENTION, judge, NO_ROW, PROVENANCE, READY } from "./fixtures.js";
import { detailAs, fakeTransport, home, type Recorded, usePosterHome } from "./harness.js";

usePosterHome();

const STEPS = turnChecklist({ progress: { completed: 1 } });

describe("liveTurnPoster — postWorking creates a metadata-bearing static frame", () => {
  it("posts through postTurn with ownership metadata present from the first visible frame", async () => {
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

    const ref = await poster.postWorking({ steps: STEPS, task: "Answering your question" });

    expect(ref).toEqual({ channel: "C1", ts: "1700000000.000100" });
    expect(log.map((entry) => entry.method)).toEqual(["postTurn"]);
    const payload = detailAs<{
      metadata: { event_payload: { renderer: string; schemaVersion: number; turnId: string }; event_type: string };
      attachments: readonly unknown[];
    }>({ detail: log[0]!.detail });
    expect(payload.metadata).toEqual({
      event_payload: { renderer: "slack-turn-v1", schemaVersion: 1, turnId: "turn-1" },
      event_type: "test_turn_v1",
    });
    expect(payload.attachments).toHaveLength(1);
  });
});

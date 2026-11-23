import { describe, expect, it } from "vitest";

import { turnChecklist } from "../../../../../live/turn/answer.js";
import { liveChecklistAdvancer } from "../../../../../live/turn/poster.js";
import type { SlackTurnPayload } from "../../../../../outbound/slack/types.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { CHROME, DM_MENTION, POSTED, PROVENANCE } from "./fixtures.js";
import { detailAs, fakeTransport, home, type Recorded, usePosterHome } from "./harness.js";

usePosterHome();

/**
 * The narrow advancer a fresh-session sweep uses to push a live detail. It carries only the chrome and
 * provenance required to render the same metadata-bearing frame as the original poster.
 */
describe("liveChecklistAdvancer", () => {
  it("updates the whole current projection, the same call liveTurnPoster's advanceWorking makes", async () => {
    const log: Recorded[] = [];
    const advancer = liveChecklistAdvancer({
      askIdentity: DM_MENTION,
      doorLedger: memoryDoorLedger().port,
      home,
      provenance: PROVENANCE,
      transport: fakeTransport({ log }),
      turnChrome: CHROME,
      turnId: "turn-1",
    });

    await advancer.advanceWorking({
      posted: POSTED,
      steps: turnChecklist({ progress: { completed: 1, runningDetail: "checking open PRs now" } }),
      task: "t",
    });

    expect(log.map((entry) => entry.method)).toEqual(["updateTurn"]);
  });

  it("carries the runningDetail through onto the in-flight step, the exact case a fresh-visible-session sweep needs", async () => {
    const log: Recorded[] = [];
    const advancer = liveChecklistAdvancer({
      askIdentity: DM_MENTION,
      doorLedger: memoryDoorLedger().port,
      home,
      provenance: PROVENANCE,
      transport: fakeTransport({ log }),
      turnChrome: CHROME,
      turnId: "turn-1",
    });

    await advancer.advanceWorking({
      posted: POSTED,
      steps: turnChecklist({ progress: { completed: 1, runningDetail: "checking open PRs now" } }),
      task: "t",
    });

    const payload = detailAs<SlackTurnPayload>({ detail: log[0]!.detail });
    expect(payload.attachments[0].blocks[2]).toEqual({
      elements: [
        {
          elements: [{ style: { bold: true }, text: "t", type: "text" }],
          type: "rich_text_section",
        },
        {
          elements: [
            {
              text: "✓ Read the question\n" + "✱ Answer inline, from context and judgement — checking open PRs now",
              type: "text",
            },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    });
  });
});

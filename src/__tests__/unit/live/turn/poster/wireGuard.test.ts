import { describe, expect, it } from "vitest";

import { answerPayload, unsendableAnswerRefusal } from "../../../../../live/turn/answerSendable.js";
import { answerDigestOf, liveTurnPoster, NO_MENTIONS } from "../../../../../live/turn/poster.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";
import { wrapperWithMissingMediaNote } from "../../../../../outbound/slack/missingMedia.js";
import { typedRunsOnlyViolations } from "../../../../../outbound/slack/typedRunsOnly.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import {
  CARD_CHROME,
  CHROME,
  CLEAN_VERDICT,
  DM_MENTION,
  judge,
  minimalAnswer,
  NO_ROW,
  PROVENANCE,
  READY,
  REPLY,
} from "./fixtures.js";
import { fakeTransport, home, type Recorded, usePosterHome } from "./harness.js";

usePosterHome();

describe("an answer the wire guard would refuse is a RETRYABLE refusal, never a thrown break", () => {
  it("finds nothing to refuse in an answer that renders clean", () => {
    expect(
      unsendableAnswerRefusal({
        payload: answerPayload({
          answer: minimalAnswer(),
          askIdentity: DM_MENTION,
          chrome: CARD_CHROME,
          freshnessNote: undefined,
          mentions: NO_MENTIONS,
        }),
      }),
    ).toBeUndefined();
  });

  /**
   * MEASURED on `C0SYN000001/1790210462.917129`: a bare URL
   * in `measurements[0].repro` threw from the wire guard mid-send, the throw was read as a break, and a live
   * worker's thread got a public failure card and lost its dispatch record. Checked before the door now, the
   * same answer comes back as the arm `turn answer` exits on without finalising anything.
   */
  it("returns ANSWER_FORM_UNSENDABLE naming the span, and touches the transport not at all", async () => {
    const log: Recorded[] = [];
    const rawUrl = "https://github.com/example/repo/pull/16524";
    const answer: AnswerFormAnswer = {
      ...minimalAnswer(),
      measurements: [{ figures: ["3"], repro: `slopweaver github read ${rawUrl}`, takenAtIso: "2026-09-24T02:40:00Z" }],
    };
    // A verdict bound to THIS answer so no door gate could refuse it — the empty log below then proves the
    // form check returned before the door was asked anything.
    const poster = liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: DM_MENTION,
      freshnessNote: undefined,
      verdict: { ...CLEAN_VERDICT, answerDigest: answerDigestOf({ answer }) },
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

    const outcome = await poster.postAnswer({
      answer,
      askIdentity: DM_MENTION,
      documents: [],
      reply: REPLY,
      uploads: [],
    });

    expect(outcome).toEqual({
      kind: "retryable-refusal",
      refusal: { code: "ANSWER_FORM_UNSENDABLE", message: expect.stringContaining(rawUrl) },
    });
    expect(log).toEqual([]);
  });

  /**
   * The send may append a missing-media note AFTER the check, so the payload sent is not
   * always the object checked. The note is a `mrkdwn` context block, which the wire guard skips by
   * construction, so the verdict on the payload sent is the verdict on the payload checked.
   */
  it("keeps the verdict when the send appends a missing-media note, even one naming a raw URL", () => {
    const rawUrl = "https://github.com/example/repo/pull/16524";
    const payload = answerPayload({
      answer: minimalAnswer(),
      askIdentity: DM_MENTION,
      chrome: CARD_CHROME,
      freshnessNote: undefined,
      mentions: NO_MENTIONS,
    });
    const noted = {
      ...payload,
      attachments: [
        wrapperWithMissingMediaNote({
          missing: [{ fileId: "F1", filename: `${rawUrl}.png`, reason: "still processing" }],
          wrapper: payload.attachments[0],
        }),
      ],
    };

    expect(noted.attachments[0]!.blocks).toHaveLength(payload.attachments[0].blocks.length + 1);
    expect(typedRunsOnlyViolations({ payload })).toEqual([]);
    expect(typedRunsOnlyViolations({ payload: noted })).toEqual([]);
  });
});

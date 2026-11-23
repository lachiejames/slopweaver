/**
 * `lifecycleEventForCompletion` — the pure projection from a turn's durable `TurnCompletion` onto the ONE
 * ask-lifecycle event it earns. Pure, so every case is a plain call.
 */
import { describe, expect, it } from "vitest";

import type { AskIdentity } from "../../../../live/ask/identity.js";
import { lifecycleEventForCompletion } from "../../../../live/turn/completionLifecycle.js";
import type { TurnCompletion, TurnProvenance } from "../../../../live/turn/envelope.js";

const ASK_IDENTITY: AskIdentity = { channel: "C1", messageTs: "2.2", threadTs: "1.1" };
const PROVENANCE: TurnProvenance = { modelId: "claude-sonnet-5" };
const TS_ISO = "2026-08-13T00:00:00.000Z";

/** A minimal `TurnCompletion`, with per-test overrides on its `primary` outcome. */
function completion(primary: TurnCompletion["primary"]): TurnCompletion {
  return {
    askIdentity: ASK_IDENTITY,
    primary,
    provenance: PROVENANCE,
    secondaryFailures: [],
    turnId: "turn-1",
    workingTs: "1712345678.000300",
  };
}

describe("lifecycleEventForCompletion", () => {
  it("projects an answered completion into an answered event carrying the answer's own ts", () => {
    const event = lifecycleEventForCompletion({
      completion: completion({ answerTs: "1712345678.000500", kind: "answered" }),
      tsIso: TS_ISO,
    });

    expect(event).toEqual({ ...ASK_IDENTITY, answerTs: "1712345678.000500", kind: "answered", tsIso: TS_ISO });
  });

  it("projects a withheld completion into a withheld event carrying the queue id, code and reason", () => {
    const event = lifecycleEventForCompletion({
      completion: completion({
        held: { code: "owner-review", id: "q1", reason: "sensitive topic" },
        kind: "withheld",
        noticeTs: "1712345678.000700",
      }),
      tsIso: TS_ISO,
    });

    expect(event).toEqual({
      ...ASK_IDENTITY,
      code: "owner-review",
      kind: "withheld",
      queueId: "q1",
      reason: "sensitive topic",
      tsIso: TS_ISO,
    });
  });

  it("projects a failed completion into a failed event carrying the break's own reason", () => {
    const event = lifecycleEventForCompletion({
      completion: completion({ kind: "failed", noticeTs: "1712345678.000900", reason: "the model call timed out" }),
      tsIso: TS_ISO,
    });

    expect(event).toEqual({ ...ASK_IDENTITY, kind: "failed", reason: "the model call timed out", tsIso: TS_ISO });
  });

  /**
   * `answer-lost` and `failed` are the same shape and opposite claims — the projection must carry the one the
   * completion already decided, never flatten both onto `failed`. That flattening is what put a
   * destroyed answer on the ledger looking like a question nobody could answer.
   */
  it("projects an answer-lost completion into an answer-lost event, never a failed one", () => {
    const event = lifecycleEventForCompletion({
      completion: completion({
        kind: "answer-lost",
        noticeTs: "1712345678.000900",
        reason: "Command failed: git rev-parse --show-toplevel",
      }),
      tsIso: TS_ISO,
    });

    expect(event).toEqual({
      ...ASK_IDENTITY,
      kind: "answer-lost",
      reason: "Command failed: git rev-parse --show-toplevel",
      tsIso: TS_ISO,
    });
  });

  /**
   * The whole point of reading identity from `completion.askIdentity` rather than a separately supplied
   * `Mention`: a completion built for one ask can never be projected onto a DIFFERENT ask's identity, because
   * there is no second identity input to disagree with the first.
   */
  it("uses the completion's OWN askIdentity, never any identity supplied alongside it", () => {
    const differentIdentity: AskIdentity = { channel: "C2", messageTs: "9.9", threadTs: "9.9" };
    const event = lifecycleEventForCompletion({
      completion: {
        ...completion({ answerTs: "1712345678.000500", kind: "answered" }),
        askIdentity: differentIdentity,
      },
      tsIso: TS_ISO,
    });

    expect(event.channel).toBe("C2");
    expect(event.messageTs).toBe("9.9");
  });
});

/*
 * A relay call's arguments checked before the page's relay is handed anything: the words to relay first, the open
 * card's judgement required, and a well-formed call handed through whole with no triage ruling to record.
 */
import { describe, expect, it } from "vitest";

import { relayCallOf, runRelayTool } from "../../components/voice/talkToolRunRelay";
import type { ToolRan } from "../../components/voice/talkToolRunTypes";
import { seams } from "../talkToolSeams";

const refusal = ({ why, detail }: { readonly why: string; readonly detail: string }): ToolRan => ({
  answer: { refused: why },
  detail,
  image: undefined,
  partialFailures: [],
  readText: false,
  refused: true,
});

describe("relayCallOf", () => {
  const held = seams({ relayed: { answer: {}, detail: "relayed", refused: false } });

  it("refuses a call with no words to relay before reading anything else", () => {
    expect(relayCallOf({ answerId: undefined, args: { say: "  " }, seams: held })).toEqual({
      detail: "no words to relay",
      why: "say must be your reading of the owner's steer",
    });
  });

  it("refuses a call that does not judge the open card", () => {
    expect(relayCallOf({ answerId: undefined, args: { outward: "none", say: "send it" }, seams: held })).toEqual({
      detail: "no judgement of the open card",
      why: "answers_open_card is required: true only when the owner's words answer the card they have open, false otherwise",
    });
  });

  it("hands a well-formed call through with the owner's words and no other card", () => {
    const checked = relayCallOf({
      answerId: undefined,
      args: { answers_open_card: false, outward: "none", say: "send it" },
      seams: held,
    }) as { call: { input: { say: string; answersOpenCard: boolean; alsoAnswers: readonly string[] } } };
    expect([checked.call.input.say, checked.call.input.answersOpenCard, checked.call.input.alsoAnswers]).toEqual([
      "send it",
      false,
      [],
    ]);
  });
});

describe("runRelayTool", () => {
  it("answers a refused call through the caller's refusal, and a relayed one as a read", () => {
    const held = seams({ relayed: { answer: { ok: "posted" }, detail: "relayed", refused: false } });
    const refused = runRelayTool({ answerId: undefined, args: {}, refusal, seams: held });
    const ran = runRelayTool({
      answerId: undefined,
      args: { answers_open_card: false, outward: "none", say: "send it" },
      refusal,
      seams: held,
    });
    expect([refused.refused, refused.detail, ran.refused, ran.answer, ran.readText]).toEqual([
      true,
      "no words to relay",
      false,
      { ok: "posted" },
      true,
    ]);
  });
});

/*
 * The voice's half of the failure toast: the notice a tool call's final outcome raises, and the record line when the
 * console window cannot be handed one. The report seam is a plain fake that records what it was handed.
 */
import { describe, expect, it } from "vitest";

import {
  deliverFailureNotice,
  toolFailureNotice,
  type VoiceFailureDelivery,
  type VoiceFailureReport,
} from "../../components/voice/failureNotice";
import type { VoiceFailureNotice } from "../../lib/voiceFailureToast";

const NOTICE: VoiceFailureNotice = {
  detail: "card refused",
  summary: "The voice couldn't open the card",
};

/**
 * A report seam answering `answer`, keeping every notice it was handed.
 *
 * @returns the seam and what it was handed
 */
function fakeReport({ answer }: { answer: VoiceFailureDelivery }): {
  report: VoiceFailureReport;
  handed: VoiceFailureNotice[];
} {
  const handed: VoiceFailureNotice[] = [];
  return {
    handed,
    report: ({ notice }) => {
      handed.push(notice);
      return answer;
    },
  };
}

describe("toolFailureNotice", () => {
  it("raises the tool's own refusal, with no card to open, when the plan call took its answer", () => {
    expect(
      toolFailureNotice({
        detail: "card refused",
        partialFailures: [],
        refused: true,
        tool: "open_card",
        why: undefined,
      }),
    ).toStrictEqual(NOTICE);
  });

  it("raises nothing for a call that did all it tried", () => {
    expect(
      toolFailureNotice({ detail: "opened", partialFailures: [], refused: false, tool: "open_card", why: undefined }),
    ).toBe(undefined);
  });

  it("raises the plan call's reason when its answer was never taken, even though the tool ran", () => {
    expect(
      toolFailureNotice({
        detail: "opened",
        partialFailures: [],
        refused: false,
        tool: "read_card",
        why: "the plan call ended first",
      }),
    ).toStrictEqual({
      detail: "the plan call ended first",
      summary: "The voice couldn't read the card",
    });
  });

  it("names a part that did not open on a call that otherwise ran, and carries the card's key", () => {
    expect(
      toolFailureNotice({
        detail: "panel opened",
        partialFailures: [{ cardKey: "ask:a-card", part: "page", why: "browser refused" }],
        refused: false,
        tool: "open_card",
        why: undefined,
      }),
    ).toStrictEqual({
      cardKey: "ask:a-card",
      detail: "browser refused",
      summary: "The voice couldn't open the card's page",
    });
  });

  it("carries no card when the plan call never took the answer, though an opening was refused", () => {
    expect(
      toolFailureNotice({
        detail: "panel opened",
        partialFailures: [{ cardKey: "ask:a-card", part: "page", why: "browser refused" }],
        refused: false,
        tool: "open_card",
        why: "the call ended first",
      }),
    ).toStrictEqual({ detail: "the call ended first", summary: "The voice couldn't open the card" });
  });
});

describe("deliverFailureNotice", () => {
  it("hands the notice over and notes nothing when the console window took it", () => {
    const { report, handed } = fakeReport({ answer: { kind: "reported" } });
    expect(deliverFailureNotice({ notice: NOTICE, report })).toBe(undefined);
    expect(handed).toEqual([NOTICE]);
  });

  it("notes a refused failure-notice line, naming why, under a shell built before the toast", () => {
    const { report, handed } = fakeReport({ answer: { kind: "unavailable", why: "restart it after a pull" } });
    expect(deliverFailureNotice({ notice: NOTICE, report })).toEqual({
      detail: "restart it after a pull",
      ms: undefined,
      name: "failure notice",
      refused: true,
      usage: undefined,
    });
    expect(handed).toEqual([NOTICE]);
  });

  it("hands nothing over when there is no failure", () => {
    const { report, handed } = fakeReport({ answer: { kind: "reported" } });
    expect(deliverFailureNotice({ notice: undefined, report })).toBe(undefined);
    expect(handed).toEqual([]);
  });

  it("notes nothing where no call runs and there is no seam", () => {
    expect(deliverFailureNotice({ notice: NOTICE, report: undefined })).toBe(undefined);
  });
});

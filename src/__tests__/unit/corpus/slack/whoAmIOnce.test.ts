import { describe, expect, it } from "vitest";
import { whoAmIOnce } from "../../../../corpus/slack/whoAmIOnce.js";
import type { SlackSelfIdentity } from "../../../../outbound/slack/lifecycleGuards.js";

const SELF: SlackSelfIdentity = { botId: "B_SELF", userId: "U_SELF" };

/** An `auth.test` seam that answers from a script and counts how often it was asked. */
function scriptedAsk({ answers }: { answers: readonly (SlackSelfIdentity | Error)[] }): {
  ask: () => Promise<SlackSelfIdentity>;
  asked: () => number;
} {
  let calls = 0;
  return {
    ask: async () => {
      const answer = answers[calls]!;
      calls += 1;
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
    asked: () => calls,
  };
}

describe("whoAmIOnce", () => {
  it("asks on the first call and reuses that answer afterwards", async () => {
    const seam = scriptedAsk({ answers: [SELF] });
    const identity = whoAmIOnce({ ask: seam.ask });
    expect(seam.asked()).toBe(0);
    expect(await identity()).toBe(SELF);
    expect(await identity()).toBe(SELF);
    expect(seam.asked()).toBe(1);
  });

  it("remembers nothing from a failed ask, so the next call asks again", async () => {
    const seam = scriptedAsk({ answers: [new Error("auth.test failed"), SELF] });
    const identity = whoAmIOnce({ ask: seam.ask });
    await expect(identity()).rejects.toThrow("auth.test failed");
    expect(await identity()).toBe(SELF);
    expect(seam.asked()).toBe(2);
  });

  it("keeps one answer per transport", async () => {
    const first = scriptedAsk({ answers: [SELF] });
    const second = scriptedAsk({ answers: [{ botId: "B_OTHER", userId: "U_OTHER" }] });
    expect(await whoAmIOnce({ ask: first.ask })()).toBe(SELF);
    expect(await whoAmIOnce({ ask: second.ask })()).toEqual({ botId: "B_OTHER", userId: "U_OTHER" });
  });
});

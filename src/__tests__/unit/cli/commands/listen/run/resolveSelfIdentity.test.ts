/**
 * The listener's own bot identity, resolved from one injected `auth.test` call, and how it degrades rather than
 * throwing when that call or its narration fails.
 */
import { describe, expect, it } from "vitest";

import { resolveSelfIdentity } from "../../../../../../cli/commands/listen/liveListenDeps.js";

describe("resolveSelfIdentity", () => {
  it("resolves this install's own bot_id AND user id from one injected whoAmI call", async () => {
    const lines: string[] = [];
    const self = await resolveSelfIdentity({
      progressLog: ({ line }) => lines.push(line),
      whoAmI: async () => ({ botId: "B0SELF", teamId: "T0SYNWORKSPACE", userId: "U0BOT" }),
    });

    expect(self.botId).toBe("B0SELF");
    expect(self.userId).toBe("U0BOT");
    expect(lines).toEqual([]);
  });

  it("degrades to undefined and narrates the failure, rather than throwing, when auth.test fails", async () => {
    const lines: string[] = [];
    const self = await resolveSelfIdentity({
      progressLog: ({ line }) => lines.push(line),
      whoAmI: async () => {
        throw new Error("socket hang up");
      },
    });

    expect(self.botId).toBeUndefined();
    expect(self.userId).toBeUndefined();
    expect(lines).toEqual([
      "could not resolve this install's own bot identity (auth.test failed: Error: socket hang up) — every " +
        "bot-authored event AND every direct message will be refused until a later connection resolves it",
    ]);
  });

  it("still degrades to undefined, never throwing, when the narration itself also throws", async () => {
    const self = await resolveSelfIdentity({
      progressLog: () => {
        throw new Error("log down");
      },
      whoAmI: async () => {
        throw new Error("auth down");
      },
    });

    expect(self.botId).toBeUndefined();
    expect(self.userId).toBeUndefined();
  });
});

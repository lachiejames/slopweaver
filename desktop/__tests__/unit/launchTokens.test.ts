import { describe, expect, it } from "vitest";

import { type LaunchTokens, launchTokensFor } from "../../src/launchTokens";

/** A run of tokens over a fixed mint sequence and a schedule whose timers the test fires by hand. */
function tokensOver({ minted }: { minted: readonly string[] }): {
  tokens: LaunchTokens;
  fire: () => void;
  expired: string[];
  waits: number[];
} {
  const queue = [...minted];
  const timers: (() => void)[] = [];
  const expired: string[] = [];
  const waits: number[] = [];
  const tokens = launchTokensFor({
    expired: ({ sessionId }) => {
      expired.push(sessionId);
    },
    mint: () => queue.shift()!,
    schedule: ({ afterMs, run }) => {
      waits.push(afterMs);
      timers.push(run);
      return () => undefined;
    },
    unsettledMs: 120_000,
  });
  const fire = (): void => {
    for (const run of timers.splice(0)) {
      run();
    }
  };
  return { expired, fire, tokens, waits };
}

describe("launchTokensFor", () => {
  it("mints a fresh token and refuses one minted before", () => {
    const { tokens } = tokensOver({ minted: ["t-1", "t-1"] });
    expect(tokens.fresh()._unsafeUnwrap()).toBe("t-1");
    expect(tokens.fresh()._unsafeUnwrapErr()).toBe(
      "a launch token repeated; the launch is refused rather than reissue it",
    );
  });

  it("refuses to settle a token minted but not yet issued", () => {
    const { tokens } = tokensOver({ minted: ["t-1"] });
    tokens.fresh();
    expect(tokens.settle({ launchToken: "t-1" })._unsafeUnwrapErr()).toBe("no launch is waiting on that token");
  });

  it("settles an issued token once, to the session it was issued for", () => {
    const { tokens } = tokensOver({ minted: ["t-1"] });
    tokens.fresh();
    tokens.issue({ launchToken: "t-1", sessionId: "s-1" });
    expect(tokens.settle({ launchToken: "t-1" })._unsafeUnwrap()).toBe("s-1");
    expect(tokens.settle({ launchToken: "t-1" })._unsafeUnwrapErr()).toBe("no launch is waiting on that token");
  });

  it("expires an issued token nothing settled, telling its session once", () => {
    const { tokens, fire, expired, waits } = tokensOver({ minted: ["t-1"] });
    tokens.fresh();
    tokens.issue({ launchToken: "t-1", sessionId: "s-1" });
    fire();
    expect(waits).toEqual([120_000]);
    expect(expired).toEqual(["s-1"]);
    expect(tokens.settle({ launchToken: "t-1" })._unsafeUnwrapErr()).toBe("no launch is waiting on that token");
  });

  it("never expires a token settled before its timer", () => {
    const { tokens, fire, expired } = tokensOver({ minted: ["t-1"] });
    tokens.fresh();
    tokens.issue({ launchToken: "t-1", sessionId: "s-1" });
    tokens.settle({ launchToken: "t-1" });
    fire();
    expect(expired).toEqual([]);
  });
});

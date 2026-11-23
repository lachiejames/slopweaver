/*
 * `reactionsToRetire`, the pure rule under every settle: name each OTHER lifecycle reaction, in lifecycle order,
 * never the one being settled to, and once each when a profile points two stages at the same emoji.
 */
import { describe, expect, it } from "vitest";

import { reactionsToRetire } from "../../../../../live/turn/lifecycleReactions.js";
import { CAPTURE, COMPLETION, STOPPED } from "./harness.js";

describe("reactionsToRetire", () => {
  it("names every OTHER lifecycle reaction, in lifecycle order", () => {
    expect(
      reactionsToRetire({ emojis: ["hourglass_flowing_sand", CAPTURE, COMPLETION, STOPPED], standing: COMPLETION }),
    ).toEqual(["hourglass_flowing_sand", CAPTURE, STOPPED]);
  });

  it("never names the reaction being settled to — removing it would leave the message wearing none", () => {
    expect(reactionsToRetire({ emojis: [CAPTURE, COMPLETION], standing: CAPTURE })).toEqual([COMPLETION]);
  });

  it("dedupes a profile that points two stages at the same emoji", () => {
    expect(reactionsToRetire({ emojis: [CAPTURE, CAPTURE, STOPPED, STOPPED], standing: COMPLETION })).toEqual([
      CAPTURE,
      STOPPED,
    ]);
  });

  it("retires nothing when the set holds only the reaction being settled to", () => {
    expect(reactionsToRetire({ emojis: [CAPTURE], standing: CAPTURE })).toEqual([]);
  });
});

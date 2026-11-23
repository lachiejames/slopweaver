import { describe, expect, it } from "vitest";

import { TURN_PATH_PREFIXES } from "../../../cli/commands/github/turnPathCore.js";
import { LOOP_CHAIN_PATHS } from "../../../lib/loopChainPaths.js";
import { STANDING_SENSITIVE_PATHS } from "../../../live/standing/freshness.js";

describe("LOOP_CHAIN_PATHS", () => {
  it("covers every area the drift actually touched", () => {
    expect([...LOOP_CHAIN_PATHS]).toEqual([
      "skills/loop",
      "skills/loop-bot",
      "skills/recipe-scheduler",
      "src/cli/commands/listen",
      "src/cli/commands/automation",
      "src/cli/commands/turn",
      "src/live",
      "src/outbound",
    ]);
  });
});

describe("loop chain path parity", () => {
  it("keeps the standing-freshness and turn-path consumers agreeing on the exact same set of paths", () => {
    const standing = STANDING_SENSITIVE_PATHS.toSorted();
    const turnPath = TURN_PATH_PREFIXES.toSorted();
    expect(standing).toEqual(turnPath);
  });

  it("keeps both consumers agreeing with the shared constant itself", () => {
    const shared = LOOP_CHAIN_PATHS.toSorted();
    expect(STANDING_SENSITIVE_PATHS.toSorted()).toEqual(shared);
    expect(TURN_PATH_PREFIXES.toSorted()).toEqual(shared);
  });
});

/** {@link codexEffortRefusal} — the one decision in `spawnPins.ts` that is pure and has no logging edge. */
import { describe, expect, it } from "vitest";

import { codexEffortRefusal, defaultSpawnEffort } from "../../../cli/commands/cmux/spawnPins.js";

describe("defaultSpawnEffort", () => {
  it("boots an Opus spawn on the claude driver at high when no --effort was passed", () => {
    expect(defaultSpawnEffort({ driver: "claude", effort: undefined, model: "opus" })).toBe("high");
    expect(defaultSpawnEffort({ driver: "claude", effort: undefined, model: "claude-opus-5-5" })).toBe("high");
  });

  it("keeps the level a caller named, even a lower one", () => {
    expect(defaultSpawnEffort({ driver: "claude", effort: "low", model: "opus" })).toBe("low");
  });

  it("adds nothing for a sonnet pin or a codex driver", () => {
    expect(defaultSpawnEffort({ driver: "claude", effort: undefined, model: "sonnet" })).toBeUndefined();
    expect(defaultSpawnEffort({ driver: "codex", effort: undefined, model: "opus" })).toBeUndefined();
  });
});

describe("codexEffortRefusal", () => {
  it("says nothing when no --effort was passed, on either driver", () => {
    expect(codexEffortRefusal({ driver: "codex", effort: undefined })).toBeUndefined();
    expect(codexEffortRefusal({ driver: "claude", effort: undefined })).toBeUndefined();
  });

  it("says nothing for an effort on the claude driver, which is the whole point of the flag", () => {
    expect(codexEffortRefusal({ driver: "claude", effort: "xhigh" })).toBeUndefined();
  });

  it("refuses an effort on codex, naming the level and the boot line that cannot carry it", () => {
    const refusal = codexEffortRefusal({ driver: "codex", effort: "max" })!;

    expect(refusal).toContain("--effort max cannot be set on a codex spawn");
    expect(refusal).toContain("codex --no-alt-screen");
    expect(refusal).toContain("silently dropped");
  });

  it("offers the two ways forward rather than only saying no", () => {
    const refusal = codexEffortRefusal({ driver: "codex", effort: "low" })!;

    expect(refusal).toContain("Drop --effort");
    expect(refusal).toContain("spawn this slug on the claude driver");
  });
});

import { describe, expect, it } from "vitest";

import { topupGateLine } from "../../../../review/vulnTopupGate.js";
import { gateVerdict } from "../../../vulnTopupFixture.js";

describe("topupGateLine", () => {
  it("opens an idle verdict with `idle —` and states the row's own share and how many must merge", () => {
    expect(topupGateLine({ verdict: gateVerdict({ kind: "idle", merged: 1, raised: 3, requiredMerged: 2 }) })).toBe(
      "idle — previous batch g: 1 of 3 raised merged, 0 dismissed; 34% must merge, so the next batch waits until 2 have merged",
    );
  });

  it("names a withdrawal beside the dismissals when there is one", () => {
    expect(
      topupGateLine({ verdict: gateVerdict({ kind: "idle", merged: 0, raised: 2, requiredMerged: 1, withdrawn: 1 }) }),
    ).toBe(
      "idle — previous batch g: 0 of 2 raised merged, 0 dismissed, 1 withdrawn; 34% must merge, so the next batch waits until 1 have merged",
    );
  });

  it("states the share that released an allowed batch", () => {
    expect(topupGateLine({ verdict: gateVerdict({ kind: "allow", merged: 2, raised: 3, requiredMerged: 2 }) })).toBe(
      "previous batch g: 2 of 3 raised merged, 0 dismissed — 34% must merge (2), so the next batch goes up",
    );
  });

  it("says a batch that raised nothing does not hold the next one", () => {
    expect(topupGateLine({ verdict: gateVerdict({ kind: "allow", merged: 0, raised: 0, requiredMerged: 0 }) })).toBe(
      "previous batch g: 0 of 0 raised merged, 0 dismissed — it raised nothing, so it does not hold the next batch",
    );
  });

  it("says a first batch has nothing to hold, and a disabled gate reads nothing", () => {
    expect(topupGateLine({ verdict: { kind: "first-batch" } })).toBe(
      "no previous top-up generation on the board — the merge-release gate has nothing to hold",
    );
    expect(topupGateLine({ verdict: { kind: "disabled", releaseAfterMergedPercent: 0 } })).toBe(
      "no merge hold configured — the merge-release gate reads no previous batch",
    );
  });
});

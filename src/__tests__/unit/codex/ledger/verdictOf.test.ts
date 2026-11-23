/**
 * `verdictOf`: a record's verdict is read from what the pass recorded, and a pass that reached none names why.
 */
import { describe, expect, it } from "vitest";

import { verdictOf } from "../../../../codex/ledger.js";
import type { CodexArtifactRecord } from "../../../../codex/types.js";
import { planRecord } from "./fixtures.js";

describe("verdictOf", () => {
  it("reads the recorded verdict rather than inferring one", () => {
    expect(verdictOf({ record: planRecord({ pass: "p1", tree: undefined, verdict: "BLOCKED" }) })).toBe("BLOCKED");
  });

  it("names the reason a pass produced no verdict", () => {
    const record: CodexArtifactRecord = {
      ...planRecord({ pass: "p1", tree: undefined }),
      outcome: { kind: "no-verdict", rawFinalResponse: null, reason: "off-track", salvage: null },
    };

    expect(verdictOf({ record })).toBe("NO_VERDICT:off-track");
  });
});

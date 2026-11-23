/**
 * The rule that decides what this atlas does with an operation.
 *
 * The cases here are the ones that would be wrong in a plausible way: a GET over a detection feed reading
 * as an entity, a POST reading as a write when it is an egress, and an unjudged POST defaulting to
 * anything at all rather than stopping the run.
 */
import { describe, expect, it } from "vitest";

import { nightfallDispositionFor, nightfallObservationalKinds } from "../../../../atlas/nightfall/dispositions.js";

describe("nightfallDispositionFor", () => {
  it("shape-indexes a read over a detection feed rather than treating it as an entity", () => {
    const verdict = nightfallDispositionFor({ kind: "violation", method: "GET", name: "dlp-get-violations" });
    expect(verdict.disposition).toBe("shape-index");
    expect(verdict.exclusionReason).toBe(null);
    expect(verdict.dispositionBecause).toContain("time-series observations");
  });

  it("treats an inventory read as an entity with nothing to explain", () => {
    const verdict = nightfallDispositionFor({
      kind: "mcp-server",
      method: "GET",
      name: "ai-governance-get-mcp-servers",
    });
    expect(verdict).toStrictEqual({ disposition: "entity", dispositionBecause: null, exclusionReason: null });
  });

  it("excludes a PUT as mutating without needing it listed anywhere", () => {
    const verdict = nightfallDispositionFor({
      kind: "endpoint-collection",
      method: "PUT",
      name: "apps-put-endpoint-collections-by-collection-uuid",
    });
    expect(verdict.disposition).toBe("excluded");
    expect(verdict.exclusionReason).toBe("mutating");
  });

  it("excludes the text scan as EGRESSING rather than as merely mutating", () => {
    const verdict = nightfallDispositionFor({ kind: "scan", method: "POST", name: "scan-post-v3-scan" });
    expect(verdict.disposition).toBe("excluded");
    expect(verdict.exclusionReason).toBe("egressing");
    expect(verdict.dispositionBecause).toContain("request body");
  });

  it("excludes the uploaded-file scan as side-effecting, because it is billed work with a result", () => {
    const verdict = nightfallDispositionFor({
      kind: "upload",
      method: "POST",
      name: "scan-post-v3-upload-by-file-id-scan",
    });
    expect(verdict.exclusionReason).toBe("side-effecting");
  });

  it("refuses an unjudged POST rather than defaulting it", () => {
    expect(() =>
      nightfallDispositionFor({ kind: "violation", method: "POST", name: "dlp-post-something-new" }),
    ).toThrow("no verdict for POST dlp-post-something-new");
  });

  it("names exactly the six observational kinds", () => {
    expect([...nightfallObservationalKinds()].toSorted()).toStrictEqual([
      "exfiltration-activity",
      "exfiltration-event",
      "finding",
      "posture-activity",
      "posture-event",
      "violation",
    ]);
  });
});

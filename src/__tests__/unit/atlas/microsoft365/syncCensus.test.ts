import { describe, expect, it } from "vitest";

import { MICROSOFT365_METHOD_CENSUS, MICROSOFT365_SPEC_PIN } from "../../../../atlas/microsoft365/specLock.js";
import { microsoft365CensusMismatch } from "../../../../atlas/microsoft365/syncCensus.js";

/** The census exactly as the pinned document reads, which a sync must accept in silence. */
function pinnedCensus(): {
  pathCount: number;
  operationCount: number;
  methodCounts: Readonly<Record<string, number>>;
  rootCount: number;
  schemaCount: number;
} {
  return {
    methodCounts: { ...MICROSOFT365_METHOD_CENSUS },
    operationCount: MICROSOFT365_SPEC_PIN.operationCount,
    pathCount: MICROSOFT365_SPEC_PIN.pathCount,
    rootCount: MICROSOFT365_SPEC_PIN.rootCount,
    schemaCount: MICROSOFT365_SPEC_PIN.schemaCount,
  };
}

describe("microsoft365CensusMismatch", () => {
  it("accepts the pinned census", () => {
    expect(microsoft365CensusMismatch({ census: pinnedCensus() })).toBeNull();
  });

  it("names a path count that moved, with both numbers", () => {
    const problems = microsoft365CensusMismatch({ census: { ...pinnedCensus(), pathCount: 11492 } })!;
    expect(problems[1]).toBe(`paths: read 11492, pinned ${String(MICROSOFT365_SPEC_PIN.pathCount)}`);
  });

  it("catches a whole HTTP method the reader stopped walking", () => {
    const census = { ...pinnedCensus(), methodCounts: { ...MICROSOFT365_METHOD_CENSUS, put: 0 } };
    const problems = microsoft365CensusMismatch({ census })!;
    expect(problems).toContain(`put operations: read 0, pinned ${String(MICROSOFT365_METHOD_CENSUS.put)}`);
  });

  it("reports every disagreement at once rather than the first", () => {
    const problems = microsoft365CensusMismatch({
      census: { ...pinnedCensus(), pathCount: 1, rootCount: 2, schemaCount: 3 },
    })!;
    expect(problems.length).toBe(5);
  });

  it("says the mismatch is this reader's rather than Microsoft's, because the bytes are digest-verified", () => {
    const problems = microsoft365CensusMismatch({ census: { ...pinnedCensus(), operationCount: 0 } })!;
    expect(problems.at(-1)).toContain("a change in THIS reader");
  });

  it("counts an absent method as zero rather than skipping it", () => {
    const census = { ...pinnedCensus(), methodCounts: { get: MICROSOFT365_METHOD_CENSUS.get } };
    const problems = microsoft365CensusMismatch({ census })!;
    expect(problems).toContain(`delete operations: read 0, pinned ${String(MICROSOFT365_METHOD_CENSUS.delete)}`);
  });
});

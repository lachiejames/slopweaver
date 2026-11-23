/*
 * `buildDetailTruncationWarning`: the detail warning names the cap, the item count and, when rows went too, the
 * row count. It moved here when `truncate.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { buildDetailTruncationWarning } from "../../../../../outbound/artifact/detailProseCap.js";

describe("buildDetailTruncationWarning", () => {
  it("names the cap and the item count when only blocks/items were dropped", () => {
    const warning = buildDetailTruncationWarning({ blocksDropped: 2, cap: 1800, itemsDropped: 1, rowsDropped: 0 });
    const run = warning.type === "paragraph" ? warning.runs[0]! : undefined;
    const runText = run?.type === "text" ? run.text : "";

    expect(runText).toContain("3 items dropped");
    expect(runText).toContain("over the 1800-character cap");
    expect(runText).not.toContain("table row");
  });

  it("names the row count too when rows were also dropped", () => {
    const warning = buildDetailTruncationWarning({ blocksDropped: 0, cap: 1800, itemsDropped: 0, rowsDropped: 1 });
    const run = warning.type === "paragraph" ? warning.runs[0]! : undefined;
    const runText = run?.type === "text" ? run.text : "";

    expect(runText).toContain("1 table row dropped");
  });
});

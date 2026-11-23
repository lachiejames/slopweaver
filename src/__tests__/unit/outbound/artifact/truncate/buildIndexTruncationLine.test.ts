/*
 * `buildIndexTruncationLine`: the index warning line names how many lines were dropped. It moved here when
 * `truncate.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { buildIndexTruncationLine } from "../../../../../outbound/artifact/truncate.js";

describe("buildIndexTruncationLine", () => {
  it("names how many lines were dropped", () => {
    const line = buildIndexTruncationLine({ linesDropped: 3 });
    const run = line[0]!;

    expect(run.type === "text" ? run.text : "").toBe("⚠️ +3 more, truncated over the above-the-fold cap");
  });
});

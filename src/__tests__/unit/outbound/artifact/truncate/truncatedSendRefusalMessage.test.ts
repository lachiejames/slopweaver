/*
 * `truncatedSendRefusalMessage`: the refusal names every measurement against its own limit and constant, and
 * always names the journalled hatch command, never the removed variable. It moved here when `truncate.test.ts`
 * was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { truncatedSendRefusalMessage } from "../../../../../outbound/artifact/truncate.js";
import { TRUNCATED_SEND_ESCAPE } from "../../../../../outbound/artifact/truncatedSendHatch.js";

describe("truncatedSendRefusalMessage", () => {
  it("names every measurement against its own limit and constant", () => {
    const message = truncatedSendRefusalMessage({
      overages: [
        { cap: "BODY_MAX_BLOCKS", limit: 12, measured: 17, what: "body blocks" },
        { cap: "DETAIL_PROSE_VISIBLE_MAX", limit: 1800, measured: 2340, what: "visible characters of body prose" },
      ],
    });

    expect(message).toBe(
      "over the outbound size caps — 17 body blocks against the BODY_MAX_BLOCKS limit of 12; 2340 visible " +
        "characters of body prose against the DETAIL_PROSE_VISIBLE_MAX limit of 1800, and posting as-is would " +
        "need to drop content — trim to the limits above, move detail into a collapsed section, or run " +
        'slopweaver hatch open truncated-send --reason "<why this one is a legitimate exception>", then re-run ' +
        "to post it truncated with a visible warning instead.",
    );
  });

  it("still names the hatch when it has no overage to report", () => {
    const message = truncatedSendRefusalMessage({ overages: [] });

    expect(message).toBe(
      "this is over a count/aggregate cap, and posting as-is would need to drop content — trim to the limits " +
        "above, move detail into a collapsed section, or run slopweaver hatch open truncated-send --reason " +
        '"<why this one is a legitimate exception>", then re-run to post it truncated with a visible warning instead.',
    );
  });

  it("names the journalled hatch command, never the removed variable", () => {
    expect(TRUNCATED_SEND_ESCAPE).toBe(
      'slopweaver hatch open truncated-send --reason "<why this one is a legitimate exception>", then re-run',
    );
    expect(truncatedSendRefusalMessage({ overages: [] })).not.toContain("SLOPWEAVER_ALLOW_TRUNCATED_SEND");
  });
});

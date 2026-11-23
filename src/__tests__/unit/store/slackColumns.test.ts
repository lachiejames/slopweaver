/*
 * The Slack side row's derived values: the reaction total, and the two timestamps, where what the record's
 * own id carried wins over a payload redaction may have carved up, and the payload is the fallback.
 */
import { describe, expect, it } from "vitest";

import { slackMessageTs, slackReactionCount, slackThreadTs } from "../../../store/slackColumns.js";

const FROM_ID = { messageTs: "1773811363.025049", threadTs: "1773784810.008629" };

describe("slackReactionCount", () => {
  it("totals every emoji's count, and a malformed member adds nothing", () => {
    const reactions: unknown[] = [
      { count: 3, name: "sparkles" },
      { count: 26, name: "heart" },
      { count: "4", name: "eyes" },
      "wave",
    ];
    expect(slackReactionCount({ raw: { reactions } })).toBe(29);
  });

  it("answers zero for a payload with no reaction list", () => {
    expect(slackReactionCount({ raw: {} })).toBe(0);
    expect(slackReactionCount({ raw: { reactions: { count: 3 } } })).toBe(0);
    expect(slackReactionCount({ raw: undefined })).toBe(0);
  });
});

describe("slackMessageTs", () => {
  it("takes the id's timestamp over a carved payload one", () => {
    expect(slackMessageTs({ fromId: FROM_ID, raw: { ts: "[number].025049" }, sourceId: "unused" })).toBe(
      "1773811363.025049",
    );
  });

  it("falls back to the payload's timestamp, then to the id itself", () => {
    expect(slackMessageTs({ fromId: null, raw: { ts: "1773784810.008629" }, sourceId: "unused" })).toBe(
      "1773784810.008629",
    );
    expect(slackMessageTs({ fromId: null, raw: {}, sourceId: "C0SYN4E1234567:pin:1773784810.008629" })).toBe(
      "C0SYN4E1234567:pin:1773784810.008629",
    );
  });
});

describe("slackThreadTs", () => {
  it("takes the id's thread root wherever the payload or the attributes declare a thread", () => {
    expect(slackThreadTs({ attrs: undefined, fromId: FROM_ID, raw: { thread_ts: "[number].008629" } })).toBe(
      "1773784810.008629",
    );
    expect(slackThreadTs({ attrs: { threadTs: "[number].008629" }, fromId: FROM_ID, raw: {} })).toBe(
      "1773784810.008629",
    );
  });

  it("gives a top-level message with no thread declared no thread root", () => {
    expect(slackThreadTs({ attrs: {}, fromId: FROM_ID, raw: {} })).toBeNull();
  });

  it("with no id layout, prefers the payload's thread root to the attributes', then the attributes'", () => {
    expect(
      slackThreadTs({
        attrs: { threadTs: "1773700000.000001" },
        fromId: null,
        raw: { thread_ts: "1773784810.008629" },
      }),
    ).toBe("1773784810.008629");
    expect(slackThreadTs({ attrs: { threadTs: "1773700000.000001" }, fromId: null, raw: {} })).toBe(
      "1773700000.000001",
    );
    expect(slackThreadTs({ attrs: undefined, fromId: null, raw: undefined })).toBeNull();
  });
});

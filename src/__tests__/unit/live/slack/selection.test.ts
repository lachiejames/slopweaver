import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { slackTsToIso } from "../../../../lib/slackTs.js";
import {
  describeSelection,
  isSlackTimestamp,
  selectionLine,
  selectMessagesAround,
  selectMessagesSince,
  selectThreadMessages,
  type ThreadSelection,
} from "../../../../live/slack/selection.js";
import type { VisibleSlackMessage } from "../../../../live/slack/types.js";

/**
 * Narrow to the `since` arm by THROWING on the other one — the same shape as `unwrap` for a `Result`, and
 * for the same reason: a ternary inside an assertion would let the test pass by taking its other branch.
 */
function sinceArm({ selection }: { selection: ThreadSelection }): Extract<ThreadSelection, { mode: "since" }> {
  if (selection.mode !== "since") {
    throw new Error(`expected a since selection, got ${selection.mode}`);
  }
  return selection;
}

/** A projected message carrying only what the selection reads. */
function message({ ts, relation = "reply" }: { ts: string; relation?: "parent" | "reply" }): VisibleSlackMessage {
  return {
    attachments: [],
    author: { userId: "U1" },
    blockFileRefs: [],
    blocks: [],
    files: [],
    permalink: `https://example.slack.com/archives/C1/p${ts.replace(".", "")}`,
    reactions: [],
    relation,
    text: "body",
    threadTs: "1785114398.000001",
    ts,
    tsIso: slackTsToIso({ ts })!,
  };
}

const PARENT = message({ relation: "parent", ts: "1785114398.000001" });
const R1 = message({ ts: "1785114400.000002" });
const R2 = message({ ts: "1785114500.000003" });
const THREAD = [PARENT, R1, R2];

describe("isSlackTimestamp", () => {
  it("accepts a real Slack ts", () => {
    expect(isSlackTimestamp({ value: "1785114398.557099" })).toBe(true);
  });

  it("accepts a fraction of another width, because the anchor is whatever Slack emitted", () => {
    // Not six-digits-only: the width is not what this check is for, and refusing a real timestamp of a
    // different width would refuse the one input that is certainly legitimate.
    expect(isSlackTimestamp({ value: "1785114398.5570" })).toBe(true);
    expect(isSlackTimestamp({ value: "1785114398.5570991" })).toBe(true);
  });

  it("refuses a value with no fraction at all", () => {
    expect(isSlackTimestamp({ value: "1785114398" })).toBe(false);
    expect(isSlackTimestamp({ value: "1785114398." })).toBe(false);
  });

  it("caps the fraction at nine digits — a bound, not an oversight", () => {
    // Nanosecond precision is three orders finer than Slack has ever been observed to emit. The cap is what
    // stops a five-hundred-digit string being accepted as a timestamp; `isAfter` still compares any width.
    expect(isSlackTimestamp({ value: "1785114398.123456789" })).toBe(true);
    expect(isSlackTimestamp({ value: "1785114398.1234567890" })).toBe(false);
  });

  it("refuses a permalink-style timestamp with the dot stripped out", () => {
    expect(isSlackTimestamp({ value: "1785114398557099" })).toBe(false);
  });

  it("refuses prose and an empty string", () => {
    expect(isSlackTimestamp({ value: "yesterday" })).toBe(false);
    expect(isSlackTimestamp({ value: "" })).toBe(false);
  });
});

describe("selectMessagesSince", () => {
  it("returns the whole thread when no anchor is given", () => {
    const selected = selectMessagesSince({ messages: THREAD });

    expect(selected.messages).toEqual(THREAD);
    expect(selected.selection).toEqual({ mode: "full", returned: 3 });
  });

  it("returns only messages posted after the anchor", () => {
    const selected = selectMessagesSince({ messages: THREAD, sinceTs: R1.ts });

    expect(selected.messages.map((m) => m.ts)).toEqual([R2.ts]);
  });

  it("EXCLUDES the anchor message itself — the caller has already read it", () => {
    const selected = selectMessagesSince({ messages: THREAD, sinceTs: R1.ts });

    expect(selected.messages.some((m) => m.ts === R1.ts)).toBe(false);
  });

  it("withholds the parent when it predates the anchor, rather than always returning it", () => {
    const selected = selectMessagesSince({ messages: THREAD, sinceTs: PARENT.ts });

    expect(selected.messages.map((m) => m.ts)).toEqual([R1.ts, R2.ts]);
  });

  it("reconciles: returned plus withheld is the whole thread", () => {
    const selected = selectMessagesSince({ messages: THREAD, sinceTs: R1.ts });
    const selection = sinceArm({ selection: selected.selection });

    expect(selection.returned).toBe(1);
    expect(selection.withheld).toBe(2);
    expect(selection.returned + selection.withheld).toBe(THREAD.length);
    expect(selected.messages.length).toBe(selection.returned);
  });

  it("returns nothing when the anchor is newer than every message", () => {
    const selected = selectMessagesSince({ messages: THREAD, sinceTs: "1999999999.000000" });

    expect(selected.messages).toEqual([]);
    expect(selected.selection.returned).toBe(0);
  });

  it("returns everything when the anchor predates the whole thread", () => {
    const selected = selectMessagesSince({ messages: THREAD, sinceTs: "1000000000.000000" });

    expect(selected.messages.length).toBe(3);
  });

  it("records that the anchor IS a message in this thread", () => {
    const selection = sinceArm({ selection: selectMessagesSince({ messages: THREAD, sinceTs: R1.ts }).selection });

    expect(selection.anchorInThread).toBe(true);
  });

  it("flags an anchor that is not a message in this thread, and still returns what is newer", () => {
    const selected = selectMessagesSince({ messages: THREAD, sinceTs: "1785114450.000009" });

    expect(sinceArm({ selection: selected.selection }).anchorInThread).toBe(false);
    expect(selected.messages.map((m) => m.ts)).toEqual([R2.ts]);
  });

  it("separates timestamps that differ only in the last microsecond digit", () => {
    // 1785114398.557099 and .557100 are 16 significant digits apart — comparing them as doubles is exactly
    // where a float implementation collapses them into one moment and drops a real message.
    const a = message({ ts: "1785114398.557099" });
    const b = message({ ts: "1785114398.557100" });

    const selected = selectMessagesSince({ messages: [a, b], sinceTs: a.ts });

    expect(selected.messages.map((m) => m.ts)).toEqual([b.ts]);
  });

  it("does not drop a message whose fraction is LONGER than six digits", () => {
    // Found by an adversarial review pass, not by me. Every one of 307,747 real Slack timestamps in the
    // corpus carries exactly six fractional digits, so this is unreachable through Slack today — but the
    // earlier implementation clipped to six, which made `.5570991` compare EQUAL to `.557099` and silently
    // withheld a strictly newer message. A dropped message is the one outcome this verb must never have.
    const anchor = message({ ts: "1785114398.557099" });
    const longer = message({ ts: "1785114398.5570991" });

    const selected = selectMessagesSince({ messages: [anchor, longer], sinceTs: anchor.ts });

    expect(selected.messages.map((m) => m.ts)).toEqual([longer.ts]);
  });

  it("does not drop a message whose fraction is SHORTER than six digits", () => {
    const anchor = message({ ts: "1785114398.557099" });
    const shorter = message({ ts: "1785114398.5571" });

    const selected = selectMessagesSince({ messages: [anchor, shorter], sinceTs: anchor.ts });

    expect(selected.messages.map((m) => m.ts)).toEqual([shorter.ts]);
  });

  it("treats a short fraction as padded, not as a small number — .1 is after .099999", () => {
    const anchor = message({ ts: "1785114398.099999" });
    const later = message({ ts: "1785114398.1" });

    const selected = selectMessagesSince({ messages: [anchor, later], sinceTs: anchor.ts });

    expect(selected.messages.map((m) => m.ts)).toEqual([later.ts]);
  });

  it("withholds a message whose longer fraction is still EARLIER than the anchor", () => {
    const earlier = message({ ts: "1785114398.5570989" });
    const anchor = message({ ts: "1785114398.557099" });

    const selected = selectMessagesSince({ messages: [earlier, anchor], sinceTs: anchor.ts });

    expect(selected.messages).toEqual([]);
  });

  it("separates seconds beyond the exact-integer range, where Number would collapse them", () => {
    // 9007199254740992 and ...93 both round to the same double. Unreachable through Slack — that epoch is
    // ~285 million years away — but it was the third counterexample a review pass found against a bounded
    // comparison, and the function is now total rather than merely large enough.
    const anchor = message({ ts: "9007199254740992.999999" });
    const later = message({ ts: "9007199254740993.000000" });

    const selected = selectMessagesSince({ messages: [anchor, later], sinceTs: anchor.ts });

    expect(selected.messages.map((m) => m.ts)).toEqual([later.ts]);
  });

  it("compares seconds of differing digit-widths by value, not by string length", () => {
    const shorter = message({ ts: "999999999.000000" });
    const longer = message({ ts: "1785114398.000000" });

    const selected = selectMessagesSince({ messages: [shorter, longer], sinceTs: shorter.ts });

    expect(selected.messages.map((m) => m.ts)).toEqual([longer.ts]);
  });

  it("orders by seconds before fraction, so a larger fraction in an older second stays withheld", () => {
    const older = message({ ts: "1785114398.999999" });
    const newer = message({ ts: "1785114399.000001" });

    const selected = selectMessagesSince({ messages: [older, newer], sinceTs: older.ts });

    expect(selected.messages.map((m) => m.ts)).toEqual([newer.ts]);
  });

  it("handles an empty thread without inventing a count", () => {
    const selected = selectMessagesSince({ messages: [], sinceTs: R1.ts });

    expect(selected.messages).toEqual([]);
    expect(selected.selection).toEqual({
      anchorInThread: false,
      mode: "since",
      returned: 0,
      sinceTs: R1.ts,
      withheld: 0,
    });
  });
});

describe("selectMessagesAround", () => {
  const R3 = message({ ts: "1785114600.000004" });
  const R4 = message({ ts: "1785114700.000005" });
  const LONG_THREAD = [PARENT, R1, R2, R3, R4];

  it("always returns the parent, addressed reply, and the chosen replies on each side", () => {
    const selected = unwrap(selectMessagesAround({ anchorTs: R2.ts, around: 1, messages: LONG_THREAD }));

    expect(selected.messages.map((item) => item.ts)).toEqual([PARENT.ts, R1.ts, R2.ts, R3.ts]);
    expect(selected.selection).toEqual({
      anchorTs: R2.ts,
      around: 1,
      mode: "around",
      returned: 4,
      withheldAfter: 1,
      withheldBefore: 0,
    });
  });

  it("supports anchor-only judgment with --around 0 without dropping the parent", () => {
    const selected = unwrap(selectMessagesAround({ anchorTs: R3.ts, around: 0, messages: LONG_THREAD }));

    expect(selected.messages.map((item) => item.ts)).toEqual([PARENT.ts, R3.ts]);
    expect(selected.selection).toEqual({
      anchorTs: R3.ts,
      around: 0,
      mode: "around",
      returned: 2,
      withheldAfter: 1,
      withheldBefore: 2,
    });
  });

  it("treats the parent as the addressed anchor without returning it twice", () => {
    const selected = unwrap(selectMessagesAround({ anchorTs: PARENT.ts, around: 2, messages: LONG_THREAD }));

    expect(selected.messages.map((item) => item.ts)).toEqual([PARENT.ts, R1.ts, R2.ts]);
    expect(selected.selection).toEqual({
      anchorTs: PARENT.ts,
      around: 2,
      mode: "around",
      returned: 3,
      withheldAfter: 2,
      withheldBefore: 0,
    });
  });

  it("refuses an addressed message absent from the complete thread", () => {
    const selected = selectMessagesAround({ anchorTs: "1785999999.000001", around: 1, messages: LONG_THREAD });

    expect(unwrapErr(selected).code).toBe("ANCHOR_NOT_FOUND");
  });

  it("refuses contradictory --since and --around controls through the shared entrance", () => {
    const selected = selectThreadMessages({
      anchorTs: R2.ts,
      around: 1,
      messages: LONG_THREAD,
      sinceTs: R1.ts,
    });

    expect(unwrapErr(selected).code).toBe("MUTUALLY_EXCLUSIVE_SELECTION");
  });
});

describe("describeSelection", () => {
  it("says nothing about a full read, which has no caveat", () => {
    expect(describeSelection({ selection: { mode: "full", returned: 3 } })).toEqual([]);
  });

  it("ALWAYS states what a --since read cannot see", () => {
    const selection = selectMessagesSince({ messages: THREAD, sinceTs: R1.ts }).selection;

    const caveats = describeSelection({ selection });

    expect(caveats.length).toBe(1);
    expect(caveats.join(" ")).toContain("edited or deleted");
    expect(caveats.join(" ")).toContain("Re-read without --since");
  });

  it("states the limitation even when NOTHING was withheld — absence of caveat must not mean 'all clear'", () => {
    const selection = selectMessagesSince({ messages: THREAD, sinceTs: "1000000000.000000" }).selection;

    expect(describeSelection({ selection }).join(" ")).toContain("edited or deleted");
  });

  it("states the limitation even when nothing was RETURNED", () => {
    const selection = selectMessagesSince({ messages: THREAD, sinceTs: "1999999999.000000" }).selection;

    expect(describeSelection({ selection }).join(" ")).toContain("edited or deleted");
  });

  it("adds a second caveat when the anchor is from another thread", () => {
    const selection = selectMessagesSince({ messages: THREAD, sinceTs: "1785114450.000009" }).selection;

    const caveats = describeSelection({ selection });

    expect(caveats.length).toBe(2);
    expect(caveats[1]!).toContain("different thread");
  });
});

describe("selectionLine", () => {
  it("names a full read as a full read", () => {
    expect(selectionLine({ selection: { mode: "full", returned: 42 } })).toBe(
      "returning all 42 message(s) — no thread bound was given",
    );
  });

  it("gives returned, total and withheld on a partial read", () => {
    const selection = selectMessagesSince({ messages: THREAD, sinceTs: R1.ts }).selection;

    expect(selectionLine({ selection })).toBe(
      "since 1785114400.000002: returning 1 of 3 message(s), 2 withheld as already read",
    );
  });

  it("says NO new messages rather than leaving an empty result to be interpreted", () => {
    const selection = selectMessagesSince({ messages: THREAD, sinceTs: "1999999999.000000" }).selection;

    expect(selectionLine({ selection })).toBe(
      "since 1999999999.000000: NO new messages — all 3 already read and withheld",
    );
  });
});

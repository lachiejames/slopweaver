import { describe, expect, it } from "vitest";
import { askDecisionFor } from "../../../../review/readingMerge.js";
import { isAsk } from "../../../../review/reviewState.js";
import { mention } from "./fixtures.js";

describe("isAsk", () => {
  it("counts a message that tagged somebody other than its own author", () => {
    expect(isAsk({ mention: mention({ tagged: ["U9"] }) })).toBe(true);
  });

  it("does not count a message that tagged only its own author", () => {
    expect(isAsk({ mention: mention({ tagged: ["U1"] }) })).toBe(false);
  });

  it("does not count a bare link with no tag at all", () => {
    expect(isAsk({ mention: mention() })).toBe(false);
  });

  it("counts an untagged REQUEST in a direct message, where the conversation names the audience", () => {
    expect(
      isAsk({ mention: mention({ conversation: "direct-message", counterpartId: "U9", isDirectMessage: true }) }),
    ).toBe(true);
  });
});

describe("isAsk in a direct message", () => {
  const dm = { conversation: "direct-message" as const, counterpartId: "U9", isDirectMessage: true };

  it("counts a REQUEST we posted into the direct message, where the conversation names the audience", () => {
    expect(isAsk({ mention: mention({ ...dm, authorId: "U1" }) })).toBe(true);
  });

  it("does not count the counterpart's OWN reply as a fresh ask", () => {
    expect(isAsk({ mention: mention({ ...dm, authorId: "U9" }) })).toBe(false);
  });

  it("abstains on a direct message whose counterpart could not be read, rather than inventing one", () => {
    const decision = askDecisionFor({
      mention: mention({ conversation: "direct-message", counterpartId: "", isDirectMessage: true }),
    });
    expect(decision.kind).toBe("undecided");
    expect(decision.ruleId).toBe("direct-message-counterpart-unread");
  });
});

describe("isAsk and the app's own digest — the false positive caught before it shipped", () => {
  it("does not read the app's own direct message as an ask, however many links it carries", () => {
    expect(
      isAsk({
        mention: mention({ authorRole: "app", conversation: "direct-message", counterpartId: "U9", tagged: [] }),
      }),
    ).toBe(false);
  });

  it("still counts a human's untagged REQUEST in the same direct message, where the audience is named", () => {
    expect(
      isAsk({
        mention: mention({ authorRole: "owner", conversation: "direct-message", counterpartId: "U9", tagged: [] }),
      }),
    ).toBe(true);
  });

  it("refuses an untagged remark in that same direct message, which asks nobody for anything", () => {
    expect(
      isAsk({
        mention: mention({
          authoredText: "i'm folding it into the blocking job so it gets a real exit code: github.com/o/r/pull/1",
          conversation: "direct-message",
          counterpartId: "U9",
        }),
      }),
    ).toBe(false);
  });

  it("counts the AS-ME lane, which arrives as the owner's own post rather than as the app's", () => {
    expect(isAsk({ mention: mention({ authorRole: "owner", tagged: ["U9"] }) })).toBe(true);
  });
});

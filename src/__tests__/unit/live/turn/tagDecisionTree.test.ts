import { describe, expect, it } from "vitest";

import type { GeneralRulings } from "../../../../live/turn/generalRulings.js";
import { tagDecisionTreeLines } from "../../../../live/turn/tagDecisionTree.js";

const NO_RULINGS: GeneralRulings = { kind: "absent" };

const TWO_RULINGS: GeneralRulings = {
  kind: "list",
  rulings: [
    { act: "investigate immediately", anchor: "talk-call:abc#turn_1", kind: "a failed deployment" },
    { act: "do it when the detail is there", anchor: "talk-call:abc#turn_2", kind: "an explicit PR ask" },
  ],
};

describe("tagDecisionTreeLines", () => {
  it("tells a trusted asker's session to investigate an unruled ask", () => {
    const lines = tagDecisionTreeLines({ rulings: NO_RULINGS, trust: { trusted: true } });
    expect(lines).toContain("  (c) No ruling covers it? This asker IS on the trusted tier, so investigate.");
    expect(lines.some((line) => line.includes("is NOT on the trusted tier"))).toBe(false);
  });

  it("sends an untrusted asker's unruled ask to (d), naming why they are not on the tier", () => {
    const lines = tagDecisionTreeLines({
      rulings: NO_RULINGS,
      trust: { trusted: false, why: "no trusted-askers.json under $SLOPWEAVER_HOME — nobody is on the tier yet" },
    });
    expect(lines).toContain(
      "  (c) No ruling covers it? This asker is NOT on the trusted tier (no trusted-askers.json under " +
        "$SLOPWEAVER_HOME — nobody is on the tier yet), so go to (d).",
    );
  });

  it("names the exact verb step (d) waits through, with the ruling need", () => {
    const lines = tagDecisionTreeLines({ rulings: NO_RULINGS, trust: { trusted: true } });
    expect(lines).toContain(
      '      `slopweaver turn block --brief <file> --need ruling --what "<what the owner is approving, one line>"`',
    );
  });

  it("forbids routing step (d) as for-a-human, which closes the ask silently", () => {
    const text = tagDecisionTreeLines({ rulings: NO_RULINGS, trust: { trusted: false, why: "x" } }).join("\n");
    expect(text).toContain("(d) as `for-a-human`: that posts nothing in the thread and CLOSES the ask");
  });

  it("says the approval reaches the ask through `turn unblock` run by a session the owner can see", () => {
    const text = tagDecisionTreeLines({ rulings: NO_RULINGS, trust: { trusted: false, why: "x" } }).join("\n");
    expect(text).toContain(
      "The owner approves free-form, and a\n      session they can see records it with `turn unblock`, which prints the line that resumes it.",
    );
  });

  it("prints every ruling the install recorded with its anchor, one line each, in file order", () => {
    const lines = tagDecisionTreeLines({ rulings: TWO_RULINGS, trust: { trusted: true } });
    expect(lines.filter((line) => line.startsWith("      - "))).toEqual([
      "      - a failed deployment: investigate immediately. [talk-call:abc#turn_1]",
      "      - an explicit PR ask: do it when the detail is there. [talk-call:abc#turn_2]",
    ]);
  });

  it("says (b) covers nothing on an install with no rulings file, and lists none", () => {
    const lines = tagDecisionTreeLines({ rulings: NO_RULINGS, trust: { trusted: true } });
    expect(lines).toContain(
      "  (b) No general rulings are recorded on this install (no general-rulings.json under $SLOPWEAVER_HOME),",
    );
    expect(lines.filter((line) => line.startsWith("      - "))).toEqual([]);
  });

  it("says (b) covers nothing when the file is unreadable, naming why", () => {
    const lines = tagDecisionTreeLines({
      rulings: { kind: "unreadable", why: "general-rulings.json is not valid JSON" },
      trust: { trusted: true },
    });
    expect(lines).toContain(
      "  (b) general-rulings.json could not be read (general-rulings.json is not valid JSON), so (b) covers nothing.",
    );
  });

  it("says (b) covers nothing when the file holds an empty list", () => {
    const lines = tagDecisionTreeLines({ rulings: { kind: "list", rulings: [] }, trust: { trusted: true } });
    expect(lines).toContain("  (b) general-rulings.json records no rulings, so (b) covers nothing.");
  });

  it("states that a past approval is never a grant and ambiguity means no", () => {
    const text = tagDecisionTreeLines({ rulings: NO_RULINGS, trust: { trusted: true } }).join("\n");
    expect(text).toContain("Ambiguous whether the owner would be fine with it means no");
    expect(text).toContain("A past approval is never a grant");
  });
});

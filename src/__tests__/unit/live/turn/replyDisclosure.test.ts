/**
 * The standing disclosure block — the owner's rulings on what a reply may share, and the second guidance
 * block that cannot load conditionally.
 *
 * Each case asserts one thing a ruling settles, by the words a session scans for; the last asserts the
 * boundary with the answer-scope rule is printed IN the block, because read alone this block is the tone
 * refusal that rule bans.
 */
import { describe, expect, it } from "vitest";

import { replyDisclosureLines } from "../../../../live/turn/replyDisclosure.js";

const BLOCK = replyDisclosureLines().join("\n");

describe("replyDisclosureLines", () => {
  it("opens with the heading a session scans for", () => {
    expect(replyDisclosureLines()[0]).toBe(
      "WHAT THE REPLY MAY SHARE — standing owner rulings, and it never loads conditionally:",
    );
  });

  it("states the owner's compliance test, and that a fact every reader can already reach is not a question", () => {
    expect(BLOCK).toContain("Share only what the owner, compliance in mind, would share.");
    expect(BLOCK).toContain("Already visible to every reader is not a question.");
  });

  it("checks every reader in the channel and waits on the owner for an escalation, never refusing or acting", () => {
    expect(BLOCK).toContain("Check WHO WILL SEE the reply, not only who asked");
    expect(BLOCK).toContain("one reader's access clears that reader only.");
    expect(BLOCK).toContain("whose access you cannot establish, is a privilege escalation");
    expect(BLOCK).toContain("reach the access-controlled place the fact came from");
    expect(BLOCK).toContain("--need risky-approval");
    expect(BLOCK).toContain("no means that wait, never a refusal or the act.");
  });

  it("holds a past approval to its own ask and the whole answer to the owner's decision when it would change", () => {
    expect(BLOCK).toContain("A past approval is never a grant: five blocks on one narrow step earn a general ruling");
    expect(BLOCK).toContain("PROPOSED to the owner,\n  never assumed.");
    expect(BLOCK).toContain("the WHOLE answer waits");
    expect(BLOCK).toContain("No answer beats a bad one.");
  });

  it("answers around a private fact as if unknown, while the owner's own private decision may be shared", () => {
    expect(BLOCK).toContain("A private fact is answered around AS IF UNKNOWN");
    expect(BLOCK).toContain("someone resigning");
    expect(BLOCK).toContain("The owner's own private DECISION");
  });

  it("never moves a reply into a DM to dodge an audience", () => {
    expect(BLOCK).toContain("Never move a reply into a DM to dodge an audience");
  });

  it("names the boundary with the answer-scope rule inside the block", () => {
    expect(BLOCK).toContain("This governs who may SEE a fact. It never governs what an answer is ABOUT");
    expect(BLOCK).toContain("the answer-scope rule");
  });

  it("takes no input, so no absent file or empty overlay can switch it off", () => {
    expect(replyDisclosureLines.length).toBe(0);
    expect(replyDisclosureLines()).toEqual(replyDisclosureLines());
    expect(replyDisclosureLines().length).toBeGreaterThan(0);
  });
});

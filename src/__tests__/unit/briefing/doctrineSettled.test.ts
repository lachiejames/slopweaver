import { describe, expect, it } from "vitest";

import {
  doctrineSettled,
  doctrineSettledRefusal,
  mechanismFramed,
  mechanismFramedRefusal,
  missingWarrant,
} from "../../../briefing/doctrineSettled.js";

describe("doctrineSettled", () => {
  it("refuses the card that cost the ruling, naming the rule that already settles it", () => {
    const question =
      "A settled ask still reads ready, so does the fix that closes a dead session's run get a pull request?";
    const found = doctrineSettled({ question })!;

    expect(found.act).toBe("opening a pull request for work that is finished");
    expect(found.settledBy).toBe("AGENTS.md rule 1 — a session opens and lands its own work once CI is green");
  });

  it("passes a question about a pull request that asks something other than permission", () => {
    expect(doctrineSettled({ question: "Which of 16415 and 16366 lands first?" })).toBeUndefined();
  });

  it("passes a question naming a billing cap rather than a settled act", () => {
    const question = "The keep-alive fix is proved, so does it wait for Codex behind your spend cap?";

    expect(doctrineSettled({ question })).toBeUndefined();
  });

  it("refuses asking permission to run a Codex pass, which rule 9 makes standing", () => {
    expect(doctrineSettled({ question: "Should the session run a codex review on this one?" })?.settledBy).toBe(
      "AGENTS.md rule 9 — pairing with Codex on non-trivial work is standing, not a judgement call",
    );
  });

  it("says the act and the rule in one refusal line", () => {
    const found = doctrineSettled({ question: "Does this get a pull request?" })!;

    expect(doctrineSettledRefusal({ found })).toBe(
      "the question asks permission for opening a pull request for work that is finished, which is already " +
        "settled by AGENTS.md rule 1 — a session opens and lands its own work once CI is green. A card exists " +
        "only where the supervisor, knowing the owner, cannot decide. Move this to `recent` as one line saying " +
        "what was done, and do it.",
    );
  });
});

describe("mechanismFramed", () => {
  it("refuses the plan-inventory question the owner answered with the criterion instead", () => {
    const question =
      "Who writes the plan inventory, and is the store path the sign-ins session provisioned the convention?";

    expect(mechanismFramed({ question })).toBe("Who writes");
  });

  it("refuses a question offering a stopgap, which is a choice between implementations", () => {
    expect(mechanismFramed({ question: "Does the keep-alive fix land tonight as a stopgap?" })).toBe("as a stopgap");
  });

  it("passes a question about whether a standing mechanism should be replaced at all", () => {
    const question = "Does the polling keep-alive stay, or do you want a different mechanism designed?";

    expect(mechanismFramed({ question })).toBeUndefined();
  });

  it("passes a question about an outcome the owner can observe", () => {
    const question = "Three of the four logins have expired, do you sign them in now or after the reset?";

    expect(mechanismFramed({ question })).toBeUndefined();
  });

  it("quotes the owner's own ruling in the refusal", () => {
    expect(mechanismFramedRefusal({ phrase: "as a stopgap" })).toBe(
      'the question asks the owner to choose between implementations, with "as a stopgap". The owner cares ' +
        "about the outcome, not how it works internally. Ask for the criterion the owner would judge the result " +
        "by, or pick the implementation yourself and report it in `recent`.",
    );
  });
});

describe("missingWarrant", () => {
  it("fires on the one card of the seven whose `why you` named no reason at all", () => {
    const whyYou = "Every route either changes what a pull request ships or takes a branch another session holds.";

    expect(missingWarrant({ whyYou })).toBe(true);
  });

  it("passes a fact only the owner holds, said either way round", () => {
    expect(missingWarrant({ whyYou: "A browser sign-in is your hand alone." })).toBe(false);
    expect(missingWarrant({ whyYou: "You are the only person who reads these while the work runs." })).toBe(false);
  });

  it("passes a conflict between two of the owner's rules", () => {
    expect(missingWarrant({ whyYou: "Landing it conflicts with the proof grade you asked for." })).toBe(false);
  });

  it("passes the NEGATED exclusivity claim, which says what `only you` says", () => {
    expect(missingWarrant({ whyYou: "No one else knows which tone sounds like you." })).toBe(false);
    expect(missingWarrant({ whyYou: "Nobody else can judge whether that reads as us." })).toBe(false);
  });

  it("passes spend and access, which are the owner's by construction", () => {
    expect(missingWarrant({ whyYou: "The Codex cap is billing nobody else can lift." })).toBe(false);
  });
});

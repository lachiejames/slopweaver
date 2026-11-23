/*
 * `prDoneWhen`: the one sentence a row says would finish it — bump, merge, act on a review, land, undraft,
 * land the stack's bottom first, unblock, ask — and the rebase a CONFLICTING pull request needs.
 */
import { describe, expect, it } from "vitest";

import { codeownerTeamRequirement } from "../../../../review/codeownerTeams.js";
import { githubWhoseMove, prDoneWhen } from "../../../../sessionStart/githubLeg.js";
import { prReadings } from "../../../../sessionStart/githubLegReadings.js";
import { BOT_IDS, NAMES, review, sixthOfSix, state } from "./fixtures.js";

describe("prDoneWhen", () => {
  it("says bump the person, never do their half", () => {
    expect(prDoneWhen({ state: state(), whose: { party: "other", who: "A Colleague" } })).toBe(
      "Bump A Colleague in Slack about acme/widgets#7, which they were asked to review and have not answered",
    );
  });

  it("says MERGE once the reviewer approved and every codeowner rule it invokes is satisfied", () => {
    const approved = {
      clearableBy: [],
      owners: ["@a-colleague"],
      paths: ["api/one.ts"],
      pattern: "/api/",
      satisfaction: "satisfied",
      satisfiedBy: "a-colleague",
      why: "@a-colleague approved, which satisfies `/api/`",
    } as const;
    const answered = state({
      bump: { kind: "replied", why: "they have replied, so there is nothing to chase" },
      codeowners: {
        owed: [],
        rules: [approved],
        teams: codeownerTeamRequirement({ rules: [approved] }),
        verdict: "satisfied",
        why: "",
      },
      reviewedSinceAsk: [review({ login: "a-colleague" })],
    });
    expect(prDoneWhen({ state: answered, whose: { party: "owner" } })).toBe(
      "Merge acme/widgets#7 — a-colleague approved it and every codeowner rule it invokes is satisfied",
    );
  });

  // REGRESSION. One approval satisfying ONE rule is not the pull request being ready, and a
  // row that says merge here sends the owner to a button GitHub refuses.
  it("never says merge while a codeowner rule is still owed, however clear the approval was", () => {
    const owed = {
      clearableBy: ["@org/data"],
      owners: ["@org/data"],
      paths: ["apps/data/main.ts"],
      pattern: "/apps/data/",
      satisfaction: "unsatisfied",
      satisfiedBy: "",
      why: "`/apps/data/` is still owed a review by @org/data",
    } as const;
    const answered = state({
      bump: { kind: "replied", why: "they have replied, so there is nothing to chase" },
      codeowners: {
        owed: [owed],
        rules: [owed],
        teams: codeownerTeamRequirement({ rules: [owed] }),
        verdict: "unsatisfied",
        why: "1 of 1 codeowner rules still owe a review: `/apps/data/` is still owed a review by @org/data",
      },
      reviewedSinceAsk: [review({ login: "a-colleague" })],
    });
    expect(prDoneWhen({ state: answered, whose: { party: "owner" } })).toBe(
      "Get the codeowner approvals acme/widgets#7 still owes before merging: 1 of 1 rules, owed by @org/data",
    );
  });

  it("says act on the CHANGES a reviewer requested, which a login alone could never say", () => {
    const answered = state({
      bump: { kind: "replied", why: "they have replied, so there is nothing to chase" },
      reviewedSinceAsk: [review({ login: "a-colleague", opinion: "changes-requested" })],
    });
    expect(prDoneWhen({ state: answered, whose: { party: "owner" } })).toBe(
      "Act on the changes a-colleague requested on acme/widgets#7 — they answered your ask and it is back with you",
    );
  });

  it("says act on the review when the answer was a comment rather than a verdict", () => {
    const answered = state({
      bump: { kind: "replied", why: "they have replied, so there is nothing to chase" },
      reviewedSinceAsk: [review({ login: "a-colleague", opinion: "commented" })],
    });
    expect(prDoneWhen({ state: answered, whose: { party: "owner" } })).toBe(
      "Act on a-colleague's review on acme/widgets#7 — they answered your ask and it is back with you",
    );
  });

  it("names a reviewer rather than inventing one when none was recorded", () => {
    const answered = state({ bump: { kind: "replied", why: "they have replied, so there is nothing to chase" } });
    expect(prDoneWhen({ state: answered, whose: { party: "owner" } })).toBe(
      "Act on a reviewer's review on acme/widgets#7 — they answered your ask and it is back with you",
    );
  });

  it("says land it yourself when nobody is ever asked to review it", () => {
    const own = state({ recommendation: "self-merges" });
    expect(prDoneWhen({ state: own, whose: { party: "owner" } })).toBe(
      "Land acme/widgets#7 yourself — nobody is asked to review this one",
    );
  });

  it("says undraft it when it is still a draft", () => {
    const draft = state({ recommendation: "still-draft", undrafted: false });
    expect(prDoneWhen({ state: draft, whose: { party: "owner" } })).toBe(
      "Undraft acme/widgets#7 and ask a named reviewer in Slack to look at it",
    );
  });

  // The ruling: the sixth pull request of the stack was a draft, and the row said "undraft it and ask a
  // reviewer". It must say land the bottom first, and name where this one sits.
  it("says land the bottom of the stack first on a stacked pull request, never undraft-and-ask", () => {
    expect(prDoneWhen({ state: sixthOfSix(), whose: { ownerAlreadyActed: true, party: "nobody" } })).toBe(
      "Land acme/widgets#16415 first — acme/widgets#16355 is PR 6 of 6 in its stack and gets no review ask until it targets staging",
    );
  });

  it("names the branch rather than a bottom it did not find when the chain is not grounded", () => {
    const orphan = sixthOfSix({
      stack: {
        baseRefName: "release/2026-09",
        chain: [16355],
        defaultBranch: "staging",
        grounded: false,
        position: 1,
        size: 1,
        stacked: true,
      },
    });
    expect(prDoneWhen({ state: orphan, whose: { ownerAlreadyActed: true, party: "nobody" } })).toBe(
      "Land whatever release/2026-09 is stacked on first — acme/widgets#16355 targets it rather than staging and gets no review ask until it does",
    );
  });

  it("carries CI's own detail into the sentence when it is blocked", () => {
    const red = state({ ci: "red", ciDetail: "2 of 6 failing", recommendation: "blocked" });
    expect(prDoneWhen({ state: red, whose: { party: "owner" } })).toBe(
      "Unblock acme/widgets#7 so it can go out for review: 2 of 6 failing",
    );
  });

  it("admits it could not tell rather than claiming nobody was asked", () => {
    const unbounded = state({ recommendation: "unknown" });
    expect(prDoneWhen({ state: unbounded, whose: { party: "owner" } })).toBe(
      "Check in Slack whether anybody was asked to review acme/widgets#7 — this run could not tell",
    );
  });

  it("says send the ask when nobody has been asked", () => {
    const noAsks = state({
      recommendation: "send-ask",
      slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" },
    });
    expect(prDoneWhen({ state: noAsks, whose: { ownerAlreadyActed: false, party: "nobody" } })).toBe(
      "Ask a named reviewer in Slack to review acme/widgets#7 — nobody has been asked yet",
    );
  });
});

describe("prDoneWhen on a CONFLICTING pull request — the conflict gap", () => {
  it("says rebase onto the base, and names the files after a colon so a card folds them", () => {
    const conflicting = state({
      conflict: {
        local: { kind: "measured", paths: ["package.json", "apps/ops/package.json"], why: "" },
        mergeable: "CONFLICTING",
      },
      recommendation: "conflicting",
    });
    expect(prDoneWhen({ state: conflicting, whose: { party: "owner" } })).toBe(
      "Rebase acme/widgets#7 onto staging, which it conflicts with in 2 files: package.json, apps/ops/package.json",
    );
  });

  it("counts one file in the singular", () => {
    const one = state({
      conflict: { local: { kind: "measured", paths: ["package.json"], why: "" }, mergeable: "CONFLICTING" },
      recommendation: "conflicting",
    });
    expect(prDoneWhen({ state: one, whose: { party: "owner" } })).toBe(
      "Rebase acme/widgets#7 onto staging, which it conflicts with in 1 file: package.json",
    );
  });

  it("says why the paths are missing instead of claiming it conflicts nowhere", () => {
    const unmeasured = state({
      conflict: {
        local: {
          kind: "unmeasured",
          why: "no declared checkout holds acme/widgets, so the conflicting paths were not measured",
        },
        mergeable: "CONFLICTING",
      },
      recommendation: "conflicting",
    });
    expect(prDoneWhen({ state: unmeasured, whose: { party: "owner" } })).toBe(
      "Rebase acme/widgets#7 onto staging — GitHub reports it conflicting, and no declared checkout holds acme/widgets, so the conflicting paths were not measured",
    );
  });

  it("is the owner's move, and as far from done as a blocked pull request", () => {
    const conflicting = state({
      conflict: { local: { kind: "measured", paths: ["p"], why: "" }, mergeable: "CONFLICTING" },
      recommendation: "conflicting",
    });
    expect(githubWhoseMove({ botIds: BOT_IDS, namesById: NAMES, state: conflicting })).toEqual({ party: "owner" });
    const readings = prReadings({ nowIso: "2026-08-30T00:00:00.000Z", state: conflicting, whose: { party: "owner" } });
    expect(readings.distanceToDone).toBe(1);
  });
});

import { describe, expect, it } from "vitest";

import { type ActRulingStakesRow, actRulingStakesOf, cardRulingStakesOf } from "../../lib/alignmentRulingStakes";

/** One ledger row of a kind, on a subject, done at an instant. */
function row({
  actionId,
  doneIso,
  subject,
  kind = "open-internal-finding-pull-request",
}: {
  actionId: string;
  doneIso: string;
  subject: string;
  kind?: string;
}): ActRulingStakesRow {
  return { actionId, doneIso, kind, subject };
}

describe("actRulingStakesOf", () => {
  it("states fifty finding pull requests over three repositories as the stakes of making the kind standing", () => {
    const repos = ["widgets", "gadgets", "gizmos"];
    const acts = Array.from({ length: 50 }, (_, index) =>
      row({
        actionId: `act-${String(index)}`,
        doneIso: new Date(Date.UTC(2026, 9, 1 + Math.floor((index * 40) / 49))).toISOString(),
        subject: `https://github.com/acme/${repos[index % 3]}/pull/${String(100 + index)}`,
      }),
    );
    expect(actRulingStakesOf({ acts, kind: "open-internal-finding-pull-request" })).toEqual({
      blastRadius:
        "It would reach everything this kind of act touches. The recorded acts span 3 GitHub repositories and 50 distinct subjects; none reached Slack or another non-GitHub surface.",
      risk: "Making this standing would let the fleet treat “open internal finding pull request” as authorised unasked. The ledger records 50 acts of this kind from 1 Oct 2026 to 10 Nov 2026; it does not measure reversibility.",
    });
  });

  it("counts a repeated act once, and acts, subjects and repositories each apart, over rows in any order", () => {
    const acts = [
      row({ actionId: "c", doneIso: "2026-11-05T23:30:00.000Z", subject: "https://github.com/acme/widgets/pull/2" }),
      row({ actionId: "a", doneIso: "2026-10-20T01:00:00.000Z", subject: "https://github.com/acme/widgets/pull/1" }),
      row({ actionId: "a", doneIso: "2026-10-20T01:00:00.000Z", subject: "https://github.com/acme/widgets/pull/1" }),
      row({ actionId: "b", doneIso: "2026-10-25T01:00:00.000Z", subject: "https://github.com/acme/widgets/pull/1" }),
      row({ actionId: "z", doneIso: "2026-01-01T00:00:00.000Z", kind: "rebase", subject: "elsewhere" }),
    ];
    expect(actRulingStakesOf({ acts, kind: "open-internal-finding-pull-request" })).toEqual({
      blastRadius:
        "It would reach everything this kind of act touches. The recorded acts span 1 GitHub repository and 2 distinct subjects; none reached Slack or another non-GitHub surface.",
      risk: "Making this standing would let the fleet treat “open internal finding pull request” as authorised unasked. The ledger records 3 acts of this kind from 20 Oct 2026 to 5 Nov 2026; it does not measure reversibility.",
    });
  });

  it("says one act on one day in the singular", () => {
    const acts = [
      row({
        actionId: "a",
        doneIso: "2026-11-02T09:00:00.000Z",
        kind: "undraft",
        subject: "https://github.com/acme/widgets/pull/9",
      }),
    ];
    expect(actRulingStakesOf({ acts, kind: "undraft" })).toEqual({
      blastRadius:
        "It would reach everything this kind of act touches. The recorded act spans 1 GitHub repository and 1 distinct subject; none reached Slack or another non-GitHub surface.",
      risk: "Making this standing would let the fleet treat “undraft” as authorised unasked. The ledger records 1 act of this kind on 2 Nov 2026; it does not measure reversibility.",
    });
  });

  it("says a Slack thread or any other surface is among the subjects it would reach", () => {
    const acts = [
      row({
        actionId: "a",
        doneIso: "2026-11-02T09:00:00.000Z",
        kind: "post-reply",
        subject: "https://acme.slack.com/archives/C0FIXTURE1/p1700000000000100",
      }),
      row({
        actionId: "b",
        doneIso: "2026-11-03T09:00:00.000Z",
        kind: "post-reply",
        subject: "https://linear.app/acme/issue/ABC-1",
      }),
    ];
    expect(actRulingStakesOf({ acts, kind: "post-reply" }).blastRadius).toBe(
      "It would reach everything this kind of act touches. The recorded acts span no GitHub repository and 2 distinct subjects; Slack or another non-GitHub surface is also among them.",
    );
  });

  it("counts a subject recorded in GitHub's owner/repo#number shorthand as the same repository as its URL", () => {
    const acts = [
      row({ actionId: "a", doneIso: "2026-11-02T09:00:00.000Z", subject: "acme/widgets#7" }),
      row({ actionId: "b", doneIso: "2026-11-02T10:00:00.000Z", subject: "https://github.com/acme/widgets/pull/8" }),
    ];
    expect(actRulingStakesOf({ acts, kind: "open-internal-finding-pull-request" }).blastRadius).toBe(
      "It would reach everything this kind of act touches. The recorded acts span 1 GitHub repository and 2 distinct subjects; none reached Slack or another non-GitHub surface.",
    );
  });

  it("leaves out an instant that does not parse, and dates nothing when none does", () => {
    const acts = [
      row({ actionId: "a", doneIso: "not a date", kind: "rebase", subject: "https://github.com/acme/widgets/pull/3" }),
    ];
    expect(actRulingStakesOf({ acts, kind: "rebase" }).risk).toBe(
      "Making this standing would let the fleet treat “rebase” as authorised unasked. The ledger records 1 act of this kind; it does not measure reversibility.",
    );
  });
});

describe("cardRulingStakesOf", () => {
  it("states every card in the class as what holding it to the class would reach, over the chains sent back", () => {
    expect(
      cardRulingStakesOf({
        drafts: [
          { atIso: "2026-11-04T02:00:00.000Z", draftId: "sd-0000000b" },
          { atIso: "2026-10-30T02:00:00.000Z", draftId: "sd-0000000a" },
        ],
        subject: "a card you could not take in at a glance",
      }),
    ).toEqual({
      blastRadius:
        "It would reach every card in that class, not only these. This question is based on 2 distinct draft chains you sent back from 30 Oct 2026 to 4 Nov 2026.",
      risk: "Making this standing would let the fleet hold back, before it reaches you, every card it judges to be a card you could not take in at a glance, without asking on each one. The draft readings do not measure how often that judgement is wrong.",
    });
  });
});

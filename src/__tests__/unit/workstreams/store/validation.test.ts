/**
 * Every rule a workstream aggregate is judged by before a write and again on a read — each case breaks exactly one
 * rule of the valid `acmeOutcome` fixture and asserts the exact problem it reads as.
 */
import { describe, expect, it } from "vitest";

import { milestoneStructureProblems, transitivePredecessorIds } from "../../../../workstreams/milestoneStructure.js";
import { linkTargetProblem } from "../../../../workstreams/store/linkTarget.js";
import { STORE_INTEGER_MAX, statementRuns } from "../../../../workstreams/store/storable.js";
import type { WorkstreamLink } from "../../../../workstreams/store/types.js";
import { aggregateProblems, definitionOfDone } from "../../../../workstreams/store/validation.js";
import { acmeLocal, acmeOutcome, OWN_DETAIL } from "../../../workstreamStoreFixtures.js";

const KNOWN = new Set(["acme-onboarding", "acme-billing"]);

/**
 * One link, valid unless overridden.
 *
 * @returns the link
 */
function link(over: Partial<WorkstreamLink> = {}): WorkstreamLink {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    kind: "pull_request",
    label: null,
    milestoneId: null,
    target: "acme/app#12",
    ...over,
  };
}

describe("aggregateProblems", () => {
  it("passes the valid outcome and the valid local workstream", () => {
    expect(aggregateProblems({ aggregate: acmeOutcome(), knownWorkstreamIds: KNOWN })).toEqual([]);
    expect(aggregateProblems({ aggregate: acmeLocal({ id: "acme-scratch" }), knownWorkstreamIds: KNOWN })).toEqual([]);
  });

  it("refuses an outcome workstream with no status, and a local one with milestones", () => {
    expect(aggregateProblems({ aggregate: acmeOutcome({ status: null }), knownWorkstreamIds: KNOWN })).toEqual([
      "acme-onboarding is outcome, so it states its outcome and its status",
    ]);
    const local = { ...acmeLocal({ id: "acme-scratch" }), milestones: acmeOutcome().milestones };
    expect(aggregateProblems({ aggregate: local, knownWorkstreamIds: KNOWN })).toEqual([
      "acme-scratch is local, so it carries no milestones",
    ]);
  });

  it("refuses an outcome workstream with no milestones, since its last milestone is its definition of done", () => {
    expect(
      aggregateProblems({ aggregate: acmeOutcome({ entries: [], milestones: [] }), knownWorkstreamIds: KNOWN }),
    ).toEqual(["acme-onboarding is outcome, so it carries its own milestones, the last its definition of done"]);
  });

  it("refuses a milestone that never leads to the definition of done", () => {
    const [scope, pilot, rollout] = acmeOutcome().milestones;
    const milestones = [scope!, pilot!, { ...rollout!, after: ["scope"] }];
    expect(aggregateProblems({ aggregate: acmeOutcome({ milestones }), knownWorkstreamIds: KNOWN })).toEqual([
      "acme-onboarding milestone(s) pilot never lead to rollout, its definition of done",
    ]);
  });

  it("refuses a milestone that names the same predecessor twice, before the store's edge key could", () => {
    const milestones = acmeOutcome().milestones.map((one) =>
      one.id === "rollout" ? { ...one, after: ["pilot", "scope", "pilot"] } : one,
    );

    expect(aggregateProblems({ aggregate: acmeOutcome({ milestones }), knownWorkstreamIds: new Set() })).toEqual([
      "acme-onboarding milestone rollout comes after pilot twice",
    ]);
  });

  it("refuses what the store cannot hold as written: a position past integer, a NUL, a lone surrogate, year 0000", () => {
    const [scope, pilot] = acmeOutcome().entries;
    const aggregate = acmeOutcome({
      detail: { ...OWN_DETAIL, statusNote: "half \uD83D" },
      entries: [
        { ...scope!, date: "0000-01-01" },
        { ...pilot!, position: STORE_INTEGER_MAX + 1, text: "pilot\u0000started" },
      ],
    });

    expect(aggregateProblems({ aggregate, knownWorkstreamIds: new Set() })).toEqual([
      'acme-onboarding entry 00000000-0000-4000-8000-000000000001: "0000-01-01" is not a calendar date YYYY-MM-DD',
      "acme-onboarding entry 00000000-0000-4000-8000-000000000002: position 2147483648 is not a whole number from 0 to 2147483647",
      "acme-onboarding.detail.statusNote carries U+0000 or a lone surrogate, which the store cannot hold as written",
      "acme-onboarding.entries[1].text carries U+0000 or a lone surrogate, which the store cannot hold as written",
    ]);
  });

  // The boundary half: this fails if the rules above over-refuse. Removing them fails the refusal test above instead.
  it("accepts the largest storable position and a paired surrogate", () => {
    const [scope, pilot] = acmeOutcome().entries;
    const aggregate = acmeOutcome({ entries: [scope!, { ...pilot!, position: STORE_INTEGER_MAX, text: "pilot 🚀" }] });

    expect(aggregateProblems({ aggregate, knownWorkstreamIds: new Set() })).toEqual([]);
  });

  it("refuses two milestones at one position", () => {
    const [scope, pilot, rollout] = acmeOutcome().milestones;
    const milestones = [scope!, { ...pilot!, position: 0 }, rollout!];
    expect(aggregateProblems({ aggregate: acmeOutcome({ milestones }), knownWorkstreamIds: KNOWN })).toEqual([
      "acme-onboarding has two milestones at position 0",
    ]);
  });

  it("refuses an entry that finishes a milestone without the link that proves it", () => {
    const [scoped, piloted] = acmeOutcome().entries;
    const entries = [{ ...scoped!, href: null }, piloted!];
    expect(aggregateProblems({ aggregate: acmeOutcome({ entries }), knownWorkstreamIds: KNOWN })).toEqual([
      "acme-onboarding entry 00000000-0000-4000-8000-000000000001: an entry that finishes a milestone names it and carries the link that proves it",
    ]);
  });

  it("refuses finishing a milestone before the milestones it waits on", () => {
    const entries = [
      ...acmeOutcome().entries,
      {
        date: "2026-11-04",
        done: true,
        href: "https://example.com/acme/rollout",
        id: "00000000-0000-4000-8000-000000000003",
        kind: "announce" as const,
        milestoneId: "rollout",
        position: 2,
        text: "rolled out",
      },
    ];
    expect(aggregateProblems({ aggregate: acmeOutcome({ entries }), knownWorkstreamIds: KNOWN })).toEqual([
      "acme-onboarding finishes rollout on 2026-11-04 before pilot is done",
    ]);
  });

  it("refuses an entry tagging a milestone the workstream does not declare", () => {
    const [scoped, piloted] = acmeOutcome().entries;
    const entries = [scoped!, { ...piloted!, milestoneId: "launch" }];
    expect(aggregateProblems({ aggregate: acmeOutcome({ entries }), knownWorkstreamIds: KNOWN })).toEqual([
      "acme-onboarding entry 00000000-0000-4000-8000-000000000002: it tags milestone launch, which acme-onboarding does not declare",
    ]);
  });

  it("refuses a link target that is not its kind's canonical identity, and the same link twice", () => {
    const links = [
      link({ target: "#12" }),
      link({ id: "00000000-0000-4000-8000-0000000000a2", kind: "automation", target: "nightly-digest" }),
      link({ id: "00000000-0000-4000-8000-0000000000a3", kind: "automation", target: "nightly-digest" }),
    ];
    expect(aggregateProblems({ aggregate: acmeOutcome({ links }), knownWorkstreamIds: KNOWN })).toEqual([
      "acme-onboarding links automation nightly-digest twice",
      'acme-onboarding link 00000000-0000-4000-8000-0000000000a1: a pull_request link\'s target is owner/repo#N, not "#12"',
    ]);
  });

  it("refuses a workstream link to itself or to a workstream the register does not hold", () => {
    const links = [
      link({ kind: "workstream", target: "acme-onboarding" }),
      link({ id: "00000000-0000-4000-8000-0000000000a2", kind: "workstream", target: "acme-unknown" }),
      link({
        id: "00000000-0000-4000-8000-0000000000a3",
        kind: "workstream",
        label: "shares a pilot",
        target: "acme-billing",
      }),
    ];
    expect(aggregateProblems({ aggregate: acmeOutcome({ links }), knownWorkstreamIds: KNOWN })).toEqual([
      "acme-onboarding link 00000000-0000-4000-8000-0000000000a1: a workstream does not link to itself",
      "acme-onboarding link 00000000-0000-4000-8000-0000000000a2: it links workstream acme-unknown, which the register does not hold",
    ]);
  });
});

describe("statementRuns", () => {
  it("splits a list into runs of a thousand, in order, and an empty list into none", () => {
    const items = Array.from({ length: 2001 }, (_, i) => i);
    const runs = statementRuns({ items });

    expect(runs.map((run) => run.length)).toEqual([1000, 1000, 1]);
    expect(runs.flat()).toEqual(items);
    expect(statementRuns({ items: [] })).toEqual([]);
  });
});

describe("definitionOfDone", () => {
  it("is the milestone at the greatest position, and absent for none", () => {
    // Reversed, so neither the first nor the last array element is the greatest position by accident.
    const reversed = acmeOutcome().milestones.toReversed();
    expect(reversed.map((one) => one.id)).toEqual(["rollout", "pilot", "scope"]);
    expect(definitionOfDone({ milestones: reversed })!.id).toBe("rollout");
    const shuffled = [reversed[1]!, reversed[0]!, reversed[2]!];
    expect(definitionOfDone({ milestones: shuffled })!.id).toBe("rollout");
    expect(definitionOfDone({ milestones: [] })).toBeUndefined();
  });
});

describe("linkTargetProblem", () => {
  it("accepts each kind's canonical identity and names the shape it wanted otherwise", () => {
    // One canonical and one non-canonical target per kind; each refused one is canonical for some OTHER kind, so a
    // grammar swapped between two kinds fails here.
    const cases: readonly { kind: WorkstreamLink["kind"]; canonical: string; refused: string; problem: string }[] = [
      {
        canonical: "acme-card",
        kind: "queue_card",
        problem: 'a queue_card link\'s target is a board row slug, not "acme/app#12"',
        refused: "acme/app#12",
      },
      {
        canonical: "acme-align",
        kind: "alignment_card",
        problem: 'a alignment_card link\'s target is a board row slug, not "acme/app#12"',
        refused: "acme/app#12",
      },
      {
        canonical: "nightly-digest",
        kind: "automation",
        problem: 'a automation link\'s target is a recipe id, not "acme/app#12"',
        refused: "acme/app#12",
      },
      {
        canonical: "acme/app#12",
        kind: "pull_request",
        problem: 'a pull_request link\'s target is owner/repo#N, not "acme-card"',
        refused: "acme-card",
      },
      {
        canonical: "0f8e2c1a-1b2c-4d3e-8f90-123456789abc",
        kind: "linear_project",
        problem: 'a linear_project link\'s target is a lowercase Linear project UUID, not "acme-project"',
        refused: "acme-project",
      },
      {
        canonical: "acme-billing",
        kind: "workstream",
        problem: 'a workstream link\'s target is a workstream id, not "acme/app#12"',
        refused: "acme/app#12",
      },
    ];

    expect(cases.map((one) => one.kind).toSorted()).toEqual([
      "alignment_card",
      "automation",
      "linear_project",
      "pull_request",
      "queue_card",
      "workstream",
    ]);
    expect(cases.map((one) => linkTargetProblem({ kind: one.kind, target: one.canonical }))).toEqual(
      cases.map(() => undefined),
    );
    expect(cases.map((one) => linkTargetProblem({ kind: one.kind, target: one.refused }))).toEqual(
      cases.map((one) => one.problem),
    );
  });
});

describe("aggregateProblems, one field rule at a time", () => {
  const judge = (aggregate: Parameters<typeof aggregateProblems>[0]["aggregate"]) =>
    aggregateProblems({ aggregate, knownWorkstreamIds: KNOWN });

  it("holds each kind to its own outcome and status, and the row to a kebab id and a name", () => {
    const local = acmeLocal({ id: "acme-scratch" });
    expect([
      judge(acmeOutcome({ kind: "standing", status: null })),
      judge(acmeOutcome({ kind: "linked" })),
      judge({ ...local, outcome: "an outcome" }),
      judge({ ...local, kind: "closing", status: "validating" }),
      judge({ ...local, id: "Acme_Scratch", name: " " }),
    ]).toEqual([
      ["acme-onboarding is standing, so it states its outcome and its status"],
      ["acme-onboarding is linked, so it states its outcome and no status of the owner's"],
      ["acme-scratch is local, so it states no outcome and no status"],
      ["acme-scratch is closing, so it carries no status"],
      ['workstream id "Acme_Scratch" is not lower kebab-case', "Acme_Scratch has no name"],
    ]);
  });

  it("refuses a milestone with a bad id, no name, or a position the store cannot hold", () => {
    const [scope, pilot, rollout] = acmeOutcome().milestones;
    const milestones = [scope!, { ...pilot!, name: "", position: 1.5 }, { ...rollout!, id: "Roll_Out" }];
    expect(judge(acmeOutcome({ milestones }))).toEqual([
      "acme-onboarding milestone pilot needs a name and the anchor where the owner named it",
      `acme-onboarding milestone pilot has position 1.5, not a whole number from 0 to ${STORE_INTEGER_MAX}`,
      'acme-onboarding milestone id "Roll_Out" is not lower kebab-case',
    ]);
  });

  it("refuses repeated entry ids and positions, and an entry with a bad id, no text or a bad link", () => {
    const [first, second] = acmeOutcome().entries;
    const repeated = [first!, { ...second!, id: first!.id, position: first!.position }];
    const broken = [first!, { ...second!, href: "ftp://acme.example/pilot", id: "not-a-uuid", text: " " }];
    expect([judge(acmeOutcome({ entries: repeated })), judge(acmeOutcome({ entries: broken }))]).toEqual([
      [
        "acme-onboarding has two entries with id 00000000-0000-4000-8000-000000000001",
        "acme-onboarding has two entries at position 0",
      ],
      [
        "acme-onboarding entry not-a-uuid: its id is not a lowercase UUID",
        "acme-onboarding entry not-a-uuid: it says nothing",
        "acme-onboarding entry not-a-uuid: its link is https:// or a console path starting with /",
      ],
    ]);
  });

  it("refuses a repeated link id, and a link with a bad id, an empty label or an undeclared milestone", () => {
    const repeated = [link(), link({ target: "acme/app#13" })];
    const broken = [link({ id: "not-a-uuid", label: " ", milestoneId: "ghost" })];
    expect([judge(acmeOutcome({ links: repeated })), judge(acmeOutcome({ links: broken }))]).toEqual([
      ["acme-onboarding has two links with id 00000000-0000-4000-8000-0000000000a1"],
      [
        "acme-onboarding link not-a-uuid: its id is not a lowercase UUID",
        "acme-onboarding link not-a-uuid: an empty label says nothing; leave it null",
        "acme-onboarding link not-a-uuid: it serves milestone ghost, which acme-onboarding does not declare",
      ],
    ]);
  });
});

describe("milestoneStructure", () => {
  it("names a cycle and walks predecessors transitively", () => {
    const cyclic = [
      { after: ["b"], id: "a" },
      { after: ["a"], id: "b" },
    ];
    expect(milestoneStructureProblems({ milestones: cyclic, owner: "acme-x" })).toEqual([
      "acme-x milestones form a cycle: a → b → a",
    ]);
    // A chain, so scope reaches rollout only through pilot: a walk of direct edges alone would miss it.
    const chain = [
      { after: [], id: "scope" },
      { after: ["scope"], id: "pilot" },
      { after: ["pilot"], id: "rollout" },
    ];
    expect([...transitivePredecessorIds({ milestoneId: "rollout", milestones: chain })].toSorted()).toEqual([
      "pilot",
      "scope",
    ]);
    expect(transitivePredecessorIds({ milestoneId: "absent", milestones: [] }).size).toBe(0);
  });
});

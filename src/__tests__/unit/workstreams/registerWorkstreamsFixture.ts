/**
 * The candidates tests' register as the store holds it: one outcome stalled with a proof link and a pull request, one
 * held on somebody and urgent that bears on the first, one standing in discovery and parked, one linked gauge held on
 * the owner's own decision, one local kept in the `self` workspace and one closing. Every outcome, standing and linked one
 * carries a `done` milestone last, the definition of done a promotion or a redefinition works on.
 *
 * The store that holds them, and the ids a write mints, are `./storeRegisterFixture.ts`.
 */
import { DONE_MILESTONE_ID } from "../../../workstreams/store/doneMilestoneId.js";
import type { WorkstreamAggregate } from "../../../workstreams/store/types.js";

/**
 * A fixture entry's or link's own id, clear of every id `countingMintId` mints.
 *
 * @param n which one, 1 to 99
 * @returns a canonical UUID
 */
function fixtureId({ n }: { n: number }): string {
  return `00000000-0000-4000-8000-f000000000${String(n).padStart(2, "0")}`;
}

/**
 * The only milestone a workstream with nothing before its definition of done carries.
 *
 * @returns the milestone
 */
function onlyDone({ name }: { name: string }): WorkstreamAggregate["milestones"][number] {
  return { after: [], anchor: "transcript:a#done", id: DONE_MILESTONE_ID, name, position: 0 };
}

/**
 * The merge gate's three entries: raised, agreed, and the pull request that finished its first milestone.
 *
 * @returns the entries
 */
function mergeGateEntries(): WorkstreamAggregate["entries"] {
  return [
    {
      date: "2026-08-01",
      done: false,
      href: null,
      id: fixtureId({ n: 1 }),
      kind: "raised",
      milestoneId: null,
      position: 0,
      text: "raised in standup",
    },
    {
      date: "2026-08-05",
      done: false,
      href: "https://example.slack.com/archives/C0SYNPLATFORM/p1789000000000100",
      id: fixtureId({ n: 2 }),
      kind: "discussion",
      milestoneId: null,
      position: 1,
      text: "agreed",
    },
    {
      date: "2026-09-10",
      done: true,
      href: "https://example.test/pr/2",
      id: fixtureId({ n: 3 }),
      kind: "pr",
      milestoneId: "most-batches",
      position: 2,
      text: "most batches",
    },
  ];
}

/**
 * An outcome stalled with nobody named: one milestone finished with its proof, then `done`.
 *
 * @returns the aggregate
 */
function mergeGate(): WorkstreamAggregate {
  return {
    detail: {
      agreedBy: "the platform team",
      boardMembership: null,
      ending: null,
      feedback: [],
      initiative: "reliability",
      numbers: "12 PRs",
      people: [],
      priority: null,
      skeptic: null,
      statusNote: "stalled in the last stretch",
      tags: ["ci"],
      team: "Platform",
      waitingOn: null,
    },
    entries: mergeGateEntries(),
    id: "merge-gate",
    kind: "outcome",
    links: [{ id: fixtureId({ n: 4 }), kind: "pull_request", label: "PR 1", milestoneId: null, target: "acme/ci#1" }],
    milestones: [
      { after: [], anchor: "transcript:a#batches", id: "most-batches", name: "Most batches gated", position: 0 },
      {
        after: ["most-batches"],
        anchor: "transcript:a#done",
        id: DONE_MILESTONE_ID,
        name: "Nothing merges red",
        position: 1,
      },
    ],
    name: "Merge gate",
    outcome: "Nothing merges red",
    status: "stalled",
    workspace: "team",
  };
}

/**
 * An outcome stalled before the approach is agreed, held on a named person, urgent, and bearing on the merge gate.
 *
 * @returns the aggregate
 */
function logsScrub(): WorkstreamAggregate {
  return {
    detail: {
      agreedBy: "nobody yet",
      boardMembership: null,
      ending: null,
      feedback: [],
      initiative: "security",
      numbers: "none",
      people: [
        { part: "picks the approach", slack: "U0SYNSECLEAD1" },
        { part: "reviews the ratchet", slack: "U0SYNREVIEW01" },
      ],
      priority: { anchor: "transcript:a#c", because: "the owner called it the top one", level: "urgent" },
      skeptic: "is it worth it",
      statusNote: "stalled",
      tags: [],
      team: "Security",
      waitingOn: { on: "someone", what: "to pick an approach", who: "the security lead" },
    },
    entries: [
      {
        date: "2026-07-01",
        done: false,
        href: null,
        id: fixtureId({ n: 5 }),
        kind: "raised",
        milestoneId: null,
        position: 0,
        text: "raised",
      },
    ],
    id: "logs-scrub",
    kind: "outcome",
    links: [
      {
        id: fixtureId({ n: 6 }),
        kind: "workstream",
        label: "the ratchet rides the same required check",
        milestoneId: null,
        target: "merge-gate",
      },
    ],
    milestones: [onlyDone({ name: "No sensitive data in logs" })],
    name: "Logs scrub",
    outcome: "No sensitive data in logs",
    status: "stalled",
    workspace: "team",
  };
}

/**
 * Standing upkeep outside the initiatives, in discovery and parked.
 *
 * @returns the aggregate
 */
function dependencies(): WorkstreamAggregate {
  return {
    detail: {
      agreedBy: "everyone",
      boardMembership: null,
      ending: null,
      feedback: [{ date: "2026-09-01", href: null, response: null, sign: "positive", text: "nice", who: "a teammate" }],
      initiative: null,
      numbers: "40 bumps",
      people: [],
      priority: { anchor: "transcript:a#d", because: "the owner parked it for the audit", level: "parked" },
      skeptic: null,
      statusNote: "discovery",
      tags: [],
      team: "Everyone",
      waitingOn: null,
    },
    entries: [
      {
        date: "2026-06-01",
        done: false,
        href: "/queue?row=x",
        id: fixtureId({ n: 7 }),
        kind: "proposal",
        milestoneId: null,
        position: 0,
        text: "agreed",
      },
    ],
    id: "deps",
    kind: "standing",
    links: [],
    milestones: [onlyDone({ name: "Dependencies stay current" })],
    name: "Dependencies",
    outcome: "Dependencies stay current",
    status: "discovery",
    workspace: "team",
  };
}

/**
 * A linked gauge somebody else leads, held on a decision of the owner's.
 *
 * @returns the aggregate
 */
function isoControls(): WorkstreamAggregate {
  return {
    detail: {
      boardMembership: null,
      ending: null,
      feedback: [],
      gauge: { asOf: "2026-10-01", gate: 112, gateLabel: "the audit gate", of: 124, source: "Vanta", value: 81 },
      initiative: "security",
      leads: "the compliance lead",
      numbers: "81 of 124",
      people: [{ part: "leads the audit", slack: "U0SYNSECLEAD1" }],
      priority: null,
      skeptic: null,
      tags: ["iso"],
      waitingOn: { on: "you", what: "which evidence tool to keep" },
      yourPart: "the evidence",
    },
    entries: [
      {
        date: "2026-05-01",
        done: false,
        href: null,
        id: fixtureId({ n: 8 }),
        kind: "raised",
        milestoneId: null,
        position: 0,
        text: "earlier",
      },
      {
        date: "2026-09-20",
        done: false,
        href: null,
        id: fixtureId({ n: 9 }),
        kind: "note",
        milestoneId: null,
        position: 1,
        text: "later",
      },
    ],
    id: "iso-controls",
    kind: "linked",
    links: [],
    milestones: [onlyDone({ name: "Certified" })],
    name: "ISO controls",
    outcome: "Certified",
    status: null,
    workspace: "team",
  };
}

/**
 * Every workstream the register holds, fresh each call.
 *
 * @returns the aggregates, in the order a test names them
 */
export function registerWorkstreams(): WorkstreamAggregate[] {
  return [
    mergeGate(),
    logsScrub(),
    dependencies(),
    isoControls(),
    {
      detail: { note: "kept here only" },
      entries: [],
      id: "the-tool",
      kind: "local",
      links: [],
      milestones: [],
      name: "The tool",
      outcome: null,
      status: null,
      workspace: "self",
    },
    {
      detail: { closedOn: null, ending: null, holding: "is it holding?", people: [], state: "handed over" },
      entries: [],
      id: "old-thing",
      kind: "closing",
      links: [],
      milestones: [],
      name: "Old thing",
      outcome: null,
      status: null,
      workspace: "team",
    },
  ];
}

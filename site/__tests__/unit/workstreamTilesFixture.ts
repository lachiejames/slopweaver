/**
 * One schema-version-2 document the way `slopweaver workstreams list --json` prints it
 * (`src/workstreams/store/projection.ts`), shared by the reader's and its consumers' tests: every workstream's
 * authored fields at the top level, its kind's fields under `detail`, and what the verb derived under `derived` —
 * written to agree with what `deriveStanding` computes from the authored half. The outcome-kind rows are
 * `./workstreamOutcomeFixture.ts`.
 */
import { drivenDetail, uuid } from "./workstreamOutcomeFixture";

/** The derived block of a kind that carries no milestones and no gauge. */
const UNDRIVEN = { gauge: null, milestoneGraph: null, progress: null, progressLine: null } as const;

const ACCEPTANCE = {
  after: [],
  anchor: "talk-call:a#acceptance",
  id: "acceptance",
  name: "Policy acceptance",
  position: 1,
};
const EVIDENCE = { after: [], anchor: "talk-call:a#evidence", id: "evidence", name: "Evidence in Vanta", position: 2 };
const AUDIT = {
  after: ["acceptance", "evidence"],
  anchor: "talk-call:a#audit",
  id: "done",
  name: "Internal audit",
  position: 3,
};

/**
 * A linked gauge held on the owner's decision, under no initiative, its priority not stated, carrying two milestones
 * side by side and its definition of done after both.
 */
export const linked = {
  derived: {
    atRisk: true,
    gauge: { gateShare: 112 / 124, share: 81 / 124, short: 31 },
    lane: "your-call",
    lastMovedOn: "2026-09-30",
    milestoneGraph: {
      columns: 2,
      milestones: [
        {
          after: [],
          anchor: "talk-call:a#acceptance",
          column: 0,
          doneOn: null,
          href: null,
          id: "acceptance",
          lastMovedOn: "2026-09-20",
          name: "Policy acceptance",
          startedOn: "2026-09-16",
          state: "moving",
          waitingFor: [],
        },
        {
          after: [],
          anchor: "talk-call:a#evidence",
          column: 0,
          doneOn: "2026-09-30",
          href: "https://example.test/evidence",
          id: "evidence",
          lastMovedOn: "2026-09-30",
          name: "Evidence in Vanta",
          startedOn: "2026-09-01",
          state: "done",
          waitingFor: [],
        },
        {
          after: ["acceptance", "evidence"],
          anchor: "talk-call:a#audit",
          column: 1,
          doneOn: null,
          href: null,
          id: "done",
          lastMovedOn: null,
          name: "Internal audit",
          startedOn: null,
          state: "waiting",
          waitingFor: ["Policy acceptance"],
        },
      ],
    },
    progress: { complete: false, doneCount: 1, next: ACCEPTANCE, ready: [ACCEPTANCE], totalCount: 3 },
    progressLine: "1 of 3 done, next: Policy acceptance",
    startedOn: "2026-09-01",
  },
  detail: {
    ...drivenDetail,
    gauge: { asOf: "2026-10-01", gate: 112, gateLabel: "the audit gate", of: 124, source: "Vanta", value: 81 },
    initiative: null,
    leads: "the compliance lead",
    tags: ["audit"],
    waitingOn: { on: "you", what: "which evidence tool to keep" },
    yourPart: "the engineering controls",
  },
  entries: [
    {
      date: "2026-09-01",
      done: false,
      href: null,
      id: uuid({ n: 21 }),
      kind: "note",
      milestoneId: "evidence",
      position: 1,
      text: "evidence collection began",
    },
    {
      date: "2026-09-16",
      done: false,
      href: null,
      id: uuid({ n: 22 }),
      kind: "discussion",
      milestoneId: "acceptance",
      position: 2,
      text: "policies sent for acceptance",
    },
    {
      date: "2026-09-20",
      done: false,
      href: "https://acme.slack.com/archives/C0FIXTURE1/p1758326400000000",
      id: uuid({ n: 23 }),
      kind: "dm",
      milestoneId: "acceptance",
      position: 3,
      text: "a reminder to accept",
    },
    {
      date: "2026-09-30",
      done: true,
      href: "https://example.test/evidence",
      id: uuid({ n: 24 }),
      kind: "announce",
      milestoneId: "evidence",
      position: 4,
      text: "every control has its evidence",
    },
  ],
  id: "iso",
  kind: "linked",
  links: [],
  milestones: [ACCEPTANCE, EVIDENCE, AUDIT],
  name: "ISO controls",
  outcome: "Certified against ISO 27001",
  status: null,
  workspace: "team",
};

/** Kept on the page only, in the other workspace. */
export const local = {
  derived: { ...UNDRIVEN, atRisk: false, lane: "kept-here", lastMovedOn: null, startedOn: null },
  detail: { note: "kept here only" },
  entries: [],
  id: "tool",
  kind: "local",
  links: [{ id: uuid({ n: 31 }), kind: "automation", label: null, milestoneId: null, target: "nightly-sync" }],
  milestones: [],
  name: "The tool",
  outcome: null,
  status: null,
  workspace: "self",
};

/** Handed over, keeping the outcome it reached and the evidence of it. */
export const closing = {
  derived: { ...UNDRIVEN, atRisk: false, lane: "done", lastMovedOn: "2026-09-20", startedOn: "2026-09-20" },
  detail: {
    closedOn: "2026-09-20",
    ending: null,
    holding: "yes",
    people: [{ part: "took it over", slack: "U0FIXTURE2" }],
    state: "handed over",
  },
  entries: [
    {
      date: "2026-09-20",
      done: false,
      href: "https://example.test/announce",
      id: uuid({ n: 41 }),
      kind: "announce",
      milestoneId: null,
      position: 1,
      text: "handed to the platform team",
    },
  ],
  id: "old",
  kind: "closing",
  links: [
    {
      id: uuid({ n: 42 }),
      kind: "workstream",
      label: "the scrub reads those monitors",
      milestoneId: null,
      target: "logs-scrub",
    },
  ],
  milestones: [],
  name: "Old thing",
  outcome: "Every service owns its monitors",
  status: null,
  workspace: "team",
};

/** Handed over with none of its evidence recorded: the verb prints each field unrecorded. */
export const unrecordedClosing = {
  ...closing,
  derived: { ...closing.derived, lastMovedOn: null, startedOn: null },
  detail: { ...closing.detail, closedOn: null, people: [] },
  entries: [],
  id: "older",
  links: [],
  name: "Older thing",
  outcome: null,
};

/**
 * One workstream row with some of its `detail` replaced.
 *
 * @returns the row
 */
export function withDetail<Row extends { readonly detail: object }>({
  row,
  detail,
}: {
  row: Row;
  detail: Record<string, unknown>;
}): Row {
  return { ...row, detail: { ...row.detail, ...detail } };
}

/**
 * One workstream row with some of what was `derived` for it replaced.
 *
 * @returns the row
 */
export function withDerived<Row extends { readonly derived: object }>({
  row,
  derived,
}: {
  row: Row;
  derived: Record<string, unknown>;
}): Row {
  return { ...row, derived: { ...row.derived, ...derived } };
}

/** The register document every fixture document carries unless a test says otherwise. */
export const META = {
  channels: { C0FIXTURE1: "#platform-squad" },
  grouping: {
    anchor: "transcript:a#b",
    builtFrom: "the register",
    label: "By initiative",
    why: "Each outcome under one aim.",
  },
  initiatives: [{ id: "security", name: "Security" }],
};

/**
 * A whole document carrying the given workstreams, and the register document unless one is given — `null` included.
 *
 * @param meta the register document, `null` before one is written
 * @returns the payload the verb would print
 */
export function documentWith({
  workstreams,
  meta = META,
}: {
  workstreams: readonly unknown[];
  meta?: unknown;
}): Record<string, unknown> {
  return {
    baseline: "wsb1.0123456789abcdef",
    lanes: [
      { atRisk: true, id: "your-call", label: "Your call", rule: "held on a decision only you can make" },
      { atRisk: true, id: "chase", label: "Chase", rule: "held on someone named" },
      { atRisk: false, id: "moving", label: "Moving", rule: "nothing holds it" },
      { atRisk: false, id: "done", label: "Done", rule: "finished or handed over" },
      { atRisk: false, id: "kept-here", label: "Kept here only", rule: "no milestones" },
      { atRisk: false, id: "abandoned", label: "Abandoned", rule: "ended without its outcome" },
    ],
    meta,
    people: [],
    priorities: ["urgent", "high", "normal", "parked"],
    schemaVersion: 2,
    workstreams,
  };
}

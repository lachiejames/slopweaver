/**
 * The outcome-kind rows of the schema-version-2 document `./workstreamTilesFixture.ts` assembles: an outcome with
 * three milestones held on someone named, and the same outcome abandoned. Written to agree with what `deriveStanding`
 * computes from the authored half, as the rest of the fixture is.
 */

/**
 * A canonical UUID for a fixture child row, numbered so a test can name one.
 *
 * @returns the UUID
 */
export function uuid({ n }: { n: number }): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** The detail fields every driven kind shares. */
export const drivenDetail = {
  boardMembership: null,
  ending: null,
  feedback: [
    {
      date: "2026-09-12",
      href: null,
      response: "split the batch",
      sign: "negative",
      text: "too big",
      who: "a reviewer",
    },
  ],
  initiative: "security",
  numbers: "12 of 40 call sites",
  people: [{ part: "picks the approach", slack: "U0FIXTURE1" }],
  priority: null,
  skeptic: "the ratchet holds only where it runs",
  tags: ["security"],
  waitingOn: null,
};

const APPROACH = { after: [], anchor: "transcript:a#approach", id: "approach", name: "Approach agreed", position: 1 };
const FIRST_BATCH = {
  after: ["approach"],
  anchor: "transcript:a#batch",
  id: "first-batch",
  name: "First batch merged",
  position: 2,
};
const SCRUBBED = {
  after: ["first-batch"],
  anchor: "transcript:a#done",
  id: "done",
  name: "Every service scrubbed",
  position: 3,
};

/** An outcome with three of its own milestones, one done, held on someone named, at the owner's top priority. */
export const outcome = {
  derived: {
    atRisk: true,
    gauge: null,
    lane: "chase",
    lastMovedOn: "2026-09-10",
    milestoneGraph: {
      columns: 3,
      milestones: [
        {
          after: [],
          anchor: "transcript:a#approach",
          column: 0,
          doneOn: "2026-09-05",
          href: "https://example.test/approach",
          id: "approach",
          lastMovedOn: "2026-09-05",
          name: "Approach agreed",
          startedOn: "2026-09-05",
          state: "done",
          waitingFor: [],
        },
        {
          after: ["approach"],
          anchor: "transcript:a#batch",
          column: 1,
          doneOn: null,
          href: null,
          id: "first-batch",
          lastMovedOn: "2026-09-10",
          name: "First batch merged",
          startedOn: "2026-09-10",
          state: "moving",
          waitingFor: [],
        },
        {
          after: ["first-batch"],
          anchor: "transcript:a#done",
          column: 2,
          doneOn: null,
          href: null,
          id: "done",
          lastMovedOn: null,
          name: "Every service scrubbed",
          startedOn: null,
          state: "waiting",
          waitingFor: ["First batch merged"],
        },
      ],
    },
    progress: { complete: false, doneCount: 1, next: FIRST_BATCH, ready: [FIRST_BATCH], totalCount: 3 },
    progressLine: "1 of 3 done, next: First batch merged",
    startedOn: "2026-09-01",
  },
  detail: {
    ...drivenDetail,
    agreedBy: "the platform lead",
    priority: { anchor: "transcript:a#b", because: "a customer asked", level: "urgent" },
    statusNote: "batch one in",
    team: "platform",
    waitingOn: { on: "someone", what: "to pick an approach", who: "the security lead" },
  },
  // Out of story order on purpose: the reader orders by `position`.
  entries: [
    {
      date: "2026-09-10",
      done: false,
      href: "https://example.test/pr/1",
      id: uuid({ n: 3 }),
      kind: "pr",
      milestoneId: "first-batch",
      position: 3,
      text: "first batch opened",
    },
    {
      date: "2026-09-01",
      done: false,
      href: null,
      id: uuid({ n: 1 }),
      kind: "raised",
      milestoneId: null,
      position: 1,
      text: "a secret reached a log line",
    },
    {
      date: "2026-09-05",
      done: true,
      href: "https://example.test/approach",
      id: uuid({ n: 2 }),
      kind: "proposal",
      milestoneId: "approach",
      position: 2,
      text: "the approach agreed",
    },
  ],
  id: "logs-scrub",
  kind: "outcome",
  links: [
    { id: uuid({ n: 11 }), kind: "workstream", label: "an auditor checks it", milestoneId: null, target: "iso" },
    {
      id: uuid({ n: 12 }),
      kind: "pull_request",
      label: "the first batch",
      milestoneId: "first-batch",
      target: "acme/app#1",
    },
  ],
  milestones: [APPROACH, FIRST_BATCH, SCRUBBED],
  name: "Logs scrub",
  outcome: "No secret reaches a log line",
  status: "validating",
  workspace: "team",
};

/** An outcome the owner abandoned, which the verb put in its own lane, never done. */
export const abandoned = {
  ...outcome,
  derived: { ...outcome.derived, atRisk: false, lane: "abandoned" },
  detail: {
    ...outcome.detail,
    ending: {
      anchor: "talk-call:a#turn_b",
      kind: "abandoned",
      on: "2026-10-02",
      reason: "previews moved to another tool",
    },
    waitingOn: null,
  },
  id: "previews",
  links: [],
  name: "One-click PR previews",
};

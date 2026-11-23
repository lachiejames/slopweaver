/**
 * One valid workstream aggregate of each kind, for the synthetic `acme` organisation, and the store rows that hold
 * it — shared by the unit tests of `src/workstreams/store/` and the real-store proof, so both judge the same shapes.
 *
 * `acmeOutcome` carries three milestones: `scope` and `pilot` side by side, then `rollout` after both, its definition
 * of done. `scope` is finished by a dated entry with its proof link; `pilot` has an entry that moves it but does not
 * finish it.
 */
import type {
  WorkstreamEntryRow,
  WorkstreamLinkRow,
  WorkstreamMilestoneAfterRow,
  WorkstreamMilestoneRow,
  WorkstreamRow,
} from "../store/schema.js";
import type { WorkstreamAggregateRows } from "../workstreams/store/assembly.js";
import type { WorkstreamAggregate, WorkstreamRegisterMeta } from "../workstreams/store/types.js";

/** A fixed instant, so assembled timestamps are exact. */
export const FIXTURE_INSTANT = new Date("2026-11-06T13:31:00.000Z");

/** An `outcome` or `standing` detail with every field at its emptiest valid value. */
export const OWN_DETAIL = {
  agreedBy: "acme leads, 2 Nov call",
  boardMembership: null,
  ending: null,
  feedback: [],
  initiative: null,
  numbers: "three teams onboarded",
  people: [],
  priority: null,
  skeptic: null,
  statusNote: "pilot running",
  tags: [],
  team: "platform",
  waitingOn: null,
} as const;

/** A valid register-level document. */
export const ACME_META: WorkstreamRegisterMeta = {
  channels: { C0FIXTURE1: "acme platform" },
  grouping: { anchor: "talk:fixture", builtFrom: "the fixture", label: "by initiative", why: "a test needs one" },
  initiatives: [{ id: "acme-growth", name: "Acme growth" }],
};

/**
 * The outcome workstream described in this file's header, optionally with links or overrides.
 *
 * @param over fields to replace on the valid aggregate
 * @returns the aggregate
 */
export function acmeOutcome(over: Partial<WorkstreamAggregate> = {}): WorkstreamAggregate {
  return {
    detail: OWN_DETAIL,
    entries: [
      {
        date: "2026-11-02",
        done: true,
        href: "https://example.com/acme/scope",
        id: "00000000-0000-4000-8000-000000000001",
        kind: "proposal",
        milestoneId: "scope",
        position: 0,
        text: "scope agreed",
      },
      {
        date: "2026-11-03",
        done: false,
        href: null,
        id: "00000000-0000-4000-8000-000000000002",
        kind: "note",
        milestoneId: "pilot",
        position: 1,
        text: "pilot started",
      },
    ],
    id: "acme-onboarding",
    kind: "outcome",
    links: [],
    milestones: [
      { after: [], anchor: "talk:fixture#1", id: "scope", name: "Scope agreed", position: 0 },
      { after: [], anchor: "talk:fixture#2", id: "pilot", name: "Pilot live", position: 1 },
      { after: ["pilot", "scope"], anchor: "talk:fixture#3", id: "rollout", name: "Rolled out", position: 2 },
    ],
    name: "Acme onboarding",
    outcome: "every acme team onboarded",
    status: "validating",
    workspace: "self",
    ...over,
  };
}

/**
 * A `linked` workstream somebody else leads, its gauge theirs: the outcome's milestones, no status of the owner's.
 *
 * @param over fields to replace on the valid aggregate
 * @returns the aggregate
 */
export function acmeLinked(over: Partial<WorkstreamAggregate> = {}): WorkstreamAggregate {
  const { agreedBy: _agreedBy, statusNote: _statusNote, team: _team, ...driven } = OWN_DETAIL;
  return acmeOutcome({
    detail: {
      ...driven,
      gauge: { asOf: "2026-11-04", gate: 8, gateLabel: "audit gate", of: 10, source: "acme tracker", value: 6 },
      leads: "the acme platform team",
      yourPart: "the onboarding scripts",
    },
    id: "acme-linked",
    kind: "linked",
    name: "Acme audit",
    outcome: "acme passes its audit",
    status: null,
    ...over,
  });
}

/**
 * A `local` workstream: no outcome, no status, no milestones.
 *
 * @returns the aggregate
 */
export function acmeLocal({ id }: { id: string }): WorkstreamAggregate {
  return {
    detail: { note: "kept on the page" },
    entries: [],
    id,
    kind: "local",
    links: [],
    milestones: [],
    name: "Acme scratch",
    outcome: null,
    status: null,
    workspace: "self",
  };
}

/**
 * The rows the store would hold for an aggregate, as a read returns them.
 *
 * @param aggregate what was written
 * @param revision the row's revision
 * @returns the workstream row and its children
 */
export function rowsOf({
  aggregate,
  revision = 1,
}: {
  aggregate: WorkstreamAggregate;
  revision?: number;
}): WorkstreamAggregateRows {
  const workstreamId = aggregate.id;
  const row: WorkstreamRow = {
    createdAt: FIXTURE_INSTANT,
    detail: aggregate.detail,
    id: workstreamId,
    kind: aggregate.kind,
    name: aggregate.name,
    outcome: aggregate.outcome,
    revision,
    status: aggregate.status,
    updatedAt: FIXTURE_INSTANT,
    workspace: aggregate.workspace,
  };
  const milestones: WorkstreamMilestoneRow[] = aggregate.milestones.map(({ anchor, id, name, position }) => ({
    anchor,
    id,
    name,
    position,
    workstreamId,
  }));
  const edges: WorkstreamMilestoneAfterRow[] = aggregate.milestones.flatMap((one) =>
    one.after.map((afterId) => ({ afterId, milestoneId: one.id, workstreamId })),
  );
  const entries: WorkstreamEntryRow[] = aggregate.entries.map((entry) => ({ ...entry, workstreamId }));
  const links: WorkstreamLinkRow[] = aggregate.links.map((link) => ({ ...link, workstreamId }));
  return { edges, entries, links, milestones, row };
}

/**
 * The drift core — two timestamps, one comparison, and no clock. Every case here is a journal plus a page
 * edit time, so nothing about it needs Notion or a filesystem.
 */
import { describe, expect, it } from "vitest";
import {
  assessProposalDrift,
  materialRegisterEvents,
  type ProposalDriftVerdict,
} from "../../../../../outbound/proposal/register/drift.js";
import type { RegisterEvent } from "../../../../../outbound/proposal/register/events.js";

/**
 * The `drifted` arm, narrowed OUTSIDE the assertion — `testing.md` bans a `?:` inside one, and a test that can
 * silently pass because its ternary took the other branch is the exact thing that ban is for.
 */
function drifted({ verdict }: { verdict: ProposalDriftVerdict }): Extract<ProposalDriftVerdict, { kind: "drifted" }> {
  return [verdict].find(
    (candidate): candidate is Extract<ProposalDriftVerdict, { kind: "drifted" }> => candidate.kind === "drifted",
  )!;
}

/** The `unassessable` arm, narrowed the same way. */
function unassessable({
  verdict,
}: {
  verdict: ProposalDriftVerdict;
}): Extract<ProposalDriftVerdict, { kind: "unassessable" }> {
  return [verdict].find(
    (candidate): candidate is Extract<ProposalDriftVerdict, { kind: "unassessable" }> =>
      candidate.kind === "unassessable",
  )!;
}

const CREATED: RegisterEvent = {
  atIso: "2026-07-01T00:00:00.000Z",
  kind: "created",
  address: { id: "page-1", provider: "notion", url: "https://example.test/page-1" },
  source: "sync",
  title: "A proposal",
};

const DECIDED: RegisterEvent = {
  atIso: "2026-08-22T12:00:00.000Z",
  decidedIso: "2026-07-07T05:41:33.000Z",
  decider: "the owner",
  decision: "ship it",
  kind: "decided",
  outcome: "approved",
  why: "aligned in thread",
};

describe("materialRegisterEvents", () => {
  it("keeps the decision, supersession, follow-up and the three material status moves", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      DECIDED,
      { atIso: "2026-08-02T00:00:00.000Z", by: "another-proposal", kind: "superseded", why: "replaced" },
      { atIso: "2026-08-03T00:00:00.000Z", kind: "follow-up-added", ref: "SECU-8" },
      { atIso: "2026-08-04T00:00:00.000Z", kind: "status-changed", status: "partially-implemented", why: "half" },
      { atIso: "2026-08-05T00:00:00.000Z", kind: "status-changed", status: "implemented", why: "done" },
      { atIso: "2026-08-06T00:00:00.000Z", kind: "status-changed", status: "withdrawn", why: "pulled" },
    ];
    expect(materialRegisterEvents({ events }).map((event) => event.what)).toEqual([
      "decided by the owner",
      "superseded by another-proposal",
      "follow-up SECU-8",
      "status partially-implemented",
      "status implemented",
      "status withdrawn",
    ]);
  });

  it("drops every kind a page reader would not expect the doc to carry", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      {
        atIso: "2026-08-01T00:00:00.000Z",
        kind: "destination-linked",
        address: { id: "p", provider: "notion", url: "u" },
        title: "t",
      },
      { atIso: "2026-08-02T00:00:00.000Z", kind: "slack-linked", permalink: "https://slack.test/1" },
      { atIso: "2026-08-03T00:00:00.000Z", audience: "the eng channel", kind: "audience-set" },
      { atIso: "2026-08-04T00:00:00.000Z", kind: "status-changed", status: "shared", why: "posted" },
      { atIso: "2026-08-05T00:00:00.000Z", kind: "status-changed", status: "discussed", why: "replies" },
      {
        atIso: "2026-08-06T00:00:00.000Z",
        feedbackKind: "pushback",
        id: "f1",
        kind: "feedback-recorded",
        what: "too broad",
        who: "a reviewer",
      },
      { atIso: "2026-08-07T00:00:00.000Z", how: "narrowed it", id: "f1", kind: "feedback-answered" },
    ];
    expect(materialRegisterEvents({ events })).toEqual([]);
  });

  it("a decision is timestamped by decidedIso, not by when the CLI appended it", () => {
    const material = materialRegisterEvents({ events: [CREATED, DECIDED] });
    expect(material[0]!.atIso).toBe("2026-07-07T05:41:33.000Z");
    expect(material[0]!.basis).toBe("occurred");
  });

  it("a follow-up with --date is timestamped by it, and one without falls back to append time", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      { atIso: "2026-08-22T00:00:00.000Z", kind: "follow-up-added", occurredIso: "2026-07-08T07:13:17.000Z", ref: "a" },
      { atIso: "2026-08-22T00:00:00.000Z", kind: "follow-up-added", ref: "b" },
    ];
    const material = materialRegisterEvents({ events });
    expect(material[0]!.atIso).toBe("2026-07-08T07:13:17.000Z");
    expect(material[0]!.basis).toBe("occurred");
    expect(material[1]!.atIso).toBe("2026-08-22T00:00:00.000Z");
    expect(material[1]!.basis).toBe("recorded");
  });
});

describe("assessProposalDrift", () => {
  it("reports no material events when nothing material has been recorded", () => {
    const verdict = assessProposalDrift({ events: [CREATED], destinationLastEditedIso: "2026-07-01T00:00:00.000Z" });
    expect(verdict.kind).toBe("no-material-events");
  });

  it("flags a decision the page has not been edited since — the Datadog case, to the day", () => {
    const verdict = assessProposalDrift({
      events: [CREATED, DECIDED],
      destinationLastEditedIso: "2026-07-07T05:07:00.000Z",
    });
    expect(verdict).toEqual({
      basis: "occurred",
      daysBehind: 0,
      kind: "drifted",
      latestMaterialIso: "2026-07-07T05:41:33.000Z",
      destinationLastEditedIso: "2026-07-07T05:07:00.000Z",
      what: "decided by the owner",
    });
  });

  it("counts whole days behind, flooring a part-day", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      { atIso: "2026-08-10T18:00:00.000Z", kind: "status-changed", status: "implemented", why: "done" },
    ];
    const verdict = assessProposalDrift({ events, destinationLastEditedIso: "2026-08-08T00:00:00.000Z" });
    expect(drifted({ verdict }).daysBehind).toBe(2);
  });

  it("finds NO drift evidence when the page was edited after the newest material event", () => {
    const verdict = assessProposalDrift({
      events: [CREATED, DECIDED],
      destinationLastEditedIso: "2026-08-01T00:00:00.000Z",
    });
    expect(verdict).toEqual({
      basis: "occurred",
      kind: "no-drift-evidence",
      latestMaterialIso: "2026-07-07T05:41:33.000Z",
      destinationLastEditedIso: "2026-08-01T00:00:00.000Z",
    });
  });

  it("treats an edit at exactly the material moment as no drift evidence — strictly after is the test", () => {
    const verdict = assessProposalDrift({
      events: [CREATED, DECIDED],
      destinationLastEditedIso: "2026-07-07T05:41:33.000Z",
    });
    expect(verdict.kind).toBe("no-drift-evidence");
  });

  it("picks the newest material event by TIME, not by position in the journal", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      { atIso: "2026-08-20T00:00:00.000Z", kind: "status-changed", status: "implemented", why: "done" },
      // Appended later, but back-dated to before the one above.
      { atIso: "2026-08-22T00:00:00.000Z", kind: "follow-up-added", occurredIso: "2026-08-02T00:00:00.000Z", ref: "a" },
    ];
    const verdict = assessProposalDrift({ events, destinationLastEditedIso: "2026-08-01T00:00:00.000Z" });
    expect(drifted({ verdict }).what).toBe("status implemented");
  });

  it("refuses to compare against an unreadable page timestamp", () => {
    const verdict = assessProposalDrift({ events: [CREATED, DECIDED], destinationLastEditedIso: "not-a-date" });
    expect(unassessable({ verdict }).why).toContain("not-a-date");
  });

  it("refuses a calendar-impossible page timestamp that Date.parse would roll forward", () => {
    // `Date.parse` of an instant on an impossible February day rolls into March rather than refusing, so it would compare as a real edit.
    const verdict = assessProposalDrift({
      events: [CREATED, DECIDED],
      destinationLastEditedIso: "2026-02-30T00:00:00.000Z",
    });
    expect(unassessable({ verdict }).why).toContain("2026-02-30T00:00:00.000Z");
  });

  it("refuses when a material event carries an unreadable timestamp, rather than comparing the rest", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      { atIso: "2026-08-22T00:00:00.000Z", kind: "follow-up-added", occurredIso: "whenever", ref: "SECU-8" },
    ];
    const verdict = assessProposalDrift({ events, destinationLastEditedIso: "2026-08-01T00:00:00.000Z" });
    expect(unassessable({ verdict }).why).toContain("follow-up SECU-8");
  });

  it("a rejection is material and names the rejecter", () => {
    const rejected: RegisterEvent = { ...DECIDED, decidedIso: "2026-08-20T00:00:00.000Z", outcome: "rejected" };
    const verdict = assessProposalDrift({
      events: [CREATED, rejected],
      destinationLastEditedIso: "2026-08-01T00:00:00.000Z",
    });
    expect(drifted({ verdict }).what).toBe("rejected by the owner");
  });
});

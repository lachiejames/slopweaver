/**
 * The register's pure fold — the part that decides current state from a history of events, with no filesystem
 * involved at all.
 */
import { describe, expect, it } from "vitest";
import {
  ANSWER_OWING_FEEDBACK_KINDS,
  foldRegisterEntry,
  isRegisterStatus,
  isSettableRegisterStatus,
  nextFeedbackId,
  REGISTER_STATUSES,
  type RegisterEvent,
  SETTABLE_REGISTER_STATUSES,
  unansweredFeedback,
} from "../../../../../outbound/proposal/register/events.js";

const CREATED: RegisterEvent = {
  address: { id: "page-1", provider: "notion", url: "https://example.test/page-1" },
  atIso: "2026-08-01T00:00:00.000Z",
  kind: "created",
  source: "publish",
  title: "A proposal",
};

describe("foldRegisterEntry", () => {
  it("returns undefined for an empty history — no created event names no proposal", () => {
    expect(foldRegisterEntry({ events: [], slug: "a-slug" })).toBe(undefined);
  });

  it("returns undefined when created is missing even if other events exist", () => {
    const events: readonly RegisterEvent[] = [
      { atIso: "2026-08-01T00:00:00.000Z", kind: "slack-linked", permalink: "https://x" },
    ];
    expect(foldRegisterEntry({ events, slug: "a-slug" })).toBe(undefined);
  });

  it("defaults a freshly-created entry to status strawman", () => {
    const entry = foldRegisterEntry({ events: [CREATED], slug: "a-slug" })!;
    expect(entry.status).toBe("strawman");
    expect(entry.title).toBe("A proposal");
    expect(entry.address.id).toBe("page-1");
    expect(entry.intakeId).toBe(undefined);
    expect(entry.source).toBe("publish");
  });

  it("carries the intake id from created through to the entry", () => {
    const withIntake: RegisterEvent = { ...CREATED, intakeId: "an-intake" };
    const entry = foldRegisterEntry({ events: [withIntake], slug: "a-slug" })!;
    expect(entry.intakeId).toBe("an-intake");
  });

  it("a status-changed event sets status and records the reason as statusSummary", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      { atIso: "2026-08-02T00:00:00.000Z", kind: "status-changed", status: "shared", why: "posted to #dev" },
    ];
    const entry = foldRegisterEntry({ events, slug: "a-slug" })!;
    expect(entry.status).toBe("shared");
    expect(entry.statusSummary).toBe("posted to #dev");
  });

  it("a decided event sets status to decided and records the decision atomically", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      {
        atIso: "2026-08-03T00:00:00.000Z",
        decidedIso: "2026-08-03T00:00:00.000Z",
        decider: "the owner",
        decision: "ship it",
        kind: "decided",
        outcome: "approved",
        why: "team aligned",
      },
    ];
    const entry = foldRegisterEntry({ events, slug: "a-slug" })!;
    expect(entry.status).toBe("decided");
    expect(entry.decision!.text).toBe("ship it");
    expect(entry.decision!.decider).toBe("the owner");
  });

  it("a superseded event sets status to superseded and records supersededBy atomically", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      { atIso: "2026-08-04T00:00:00.000Z", by: "the-newer-one", kind: "superseded", why: "v2 shipped" },
    ];
    const entry = foldRegisterEntry({ events, slug: "a-slug" })!;
    expect(entry.status).toBe("superseded");
    expect(entry.supersededBy).toBe("the-newer-one");
  });

  it("reopening after superseded is trusted: a later status-changed wins, but supersededBy stays as history", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      { atIso: "2026-08-04T00:00:00.000Z", by: "the-newer-one", kind: "superseded", why: "v2 shipped" },
      {
        atIso: "2026-08-05T00:00:00.000Z",
        kind: "status-changed",
        status: "discussed",
        why: "reopened after feedback",
      },
    ];
    const entry = foldRegisterEntry({ events, slug: "a-slug" })!;
    expect(entry.status).toBe("discussed");
    expect(entry.supersededBy).toBe("the-newer-one");
  });

  it("slack-linked accumulates permalinks rather than replacing the list", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      { atIso: "2026-08-02T00:00:00.000Z", kind: "slack-linked", permalink: "https://a" },
      { atIso: "2026-08-03T00:00:00.000Z", kind: "slack-linked", permalink: "https://b" },
    ];
    const entry = foldRegisterEntry({ events, slug: "a-slug" })!;
    expect(entry.slackPermalinks).toEqual(["https://a", "https://b"]);
  });

  it("follow-up-added accumulates follow-ups, carrying an optional label", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      { atIso: "2026-08-02T00:00:00.000Z", kind: "follow-up-added", label: "the fix", ref: "a-handover-doc" },
    ];
    const entry = foldRegisterEntry({ events, slug: "a-slug" })!;
    expect(entry.followUps).toEqual([{ label: "the fix", ref: "a-handover-doc" }]);
  });

  it("audience-set overwrites the audience field on a later call", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      { atIso: "2026-08-02T00:00:00.000Z", audience: "eng", kind: "audience-set" },
      { atIso: "2026-08-03T00:00:00.000Z", audience: "eng + product", kind: "audience-set" },
    ];
    const entry = foldRegisterEntry({ events, slug: "a-slug" })!;
    expect(entry.audience).toBe("eng + product");
  });

  it("destination-linked replaces the address and title, so a republish or a sync correction sticks", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      {
        address: { id: "page-2", provider: "notion", url: "https://example.test/page-2" },
        atIso: "2026-08-02T00:00:00.000Z",
        kind: "destination-linked",
        title: "A renamed proposal",
      },
    ];
    const entry = foldRegisterEntry({ events, slug: "a-slug" })!;
    expect(entry.address.id).toBe("page-2");
    expect(entry.address.url).toBe("https://example.test/page-2");
    expect(entry.title).toBe("A renamed proposal");
  });

  it("updatedIso tracks the most recent event's timestamp, not created's", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      { atIso: "2026-09-01T00:00:00.000Z", kind: "audience-set", audience: "eng" },
    ];
    const entry = foldRegisterEntry({ events, slug: "a-slug" })!;
    expect(entry.createdIso).toBe("2026-08-01T00:00:00.000Z");
    expect(entry.updatedIso).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("isSettableRegisterStatus", () => {
  it("accepts the four non-terminal statuses", () => {
    expect(isSettableRegisterStatus("strawman")).toBe(true);
    expect(isSettableRegisterStatus("shared")).toBe(true);
    expect(isSettableRegisterStatus("discussed")).toBe(true);
    expect(isSettableRegisterStatus("withdrawn")).toBe(true);
  });

  it("rejects decided and superseded — those are set only by their own atomic events", () => {
    expect(isSettableRegisterStatus("decided")).toBe(false);
    expect(isSettableRegisterStatus("superseded")).toBe(false);
  });

  it("rejects an unrelated string", () => {
    expect(isSettableRegisterStatus("blocked")).toBe(false);
  });
});

describe("the richer status set", () => {
  it("accepts every status a generic change may set, and refuses the three atomic ones", () => {
    expect(SETTABLE_REGISTER_STATUSES).toEqual([
      "strawman",
      "shared",
      "discussed",
      "partially-implemented",
      "implemented",
      "withdrawn",
    ]);
    expect(isSettableRegisterStatus("implemented")).toBe(true);
    expect(isSettableRegisterStatus("partially-implemented")).toBe(true);
    expect(isSettableRegisterStatus("decided")).toBe(false);
    expect(isSettableRegisterStatus("rejected")).toBe(false);
    expect(isSettableRegisterStatus("superseded")).toBe(false);
  });

  it("names all nine folded statuses, and nothing else", () => {
    expect(REGISTER_STATUSES).toEqual([
      "strawman",
      "shared",
      "discussed",
      "decided",
      "partially-implemented",
      "implemented",
      "rejected",
      "superseded",
      "withdrawn",
    ]);
    expect(isRegisterStatus("rejected")).toBe(true);
    expect(isRegisterStatus("stale")).toBe(false);
  });

  it("a rejected decision sets status to rejected while keeping the whole decision record", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      {
        atIso: "2026-08-03T00:00:00.000Z",
        decidedIso: "2026-08-02T00:00:00.000Z",
        decider: "the team",
        decision: "not this quarter",
        kind: "decided",
        outcome: "rejected",
        why: "no capacity",
      },
    ];
    const entry = foldRegisterEntry({ events, slug: "a-slug" })!;
    expect(entry.status).toBe("rejected");
    expect(entry.decision).toEqual({
      decidedIso: "2026-08-02T00:00:00.000Z",
      decider: "the team",
      outcome: "rejected",
      text: "not this quarter",
    });
  });

  it("reopening a rejected proposal moves the status while the rejection stays on the record", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      {
        atIso: "2026-08-03T00:00:00.000Z",
        decidedIso: "2026-08-02T00:00:00.000Z",
        decider: "the team",
        decision: "not this quarter",
        kind: "decided",
        outcome: "rejected",
        why: "no capacity",
      },
      { atIso: "2026-08-09T00:00:00.000Z", kind: "status-changed", status: "discussed", why: "raised again" },
    ];
    const entry = foldRegisterEntry({ events, slug: "a-slug" })!;
    expect(entry.status).toBe("discussed");
    expect(entry.decision!.outcome).toBe("rejected");
  });
});

describe("the feedback ledger", () => {
  const PUSHBACK: RegisterEvent = {
    atIso: "2026-08-04T00:00:00.000Z",
    feedbackKind: "pushback",
    id: "f1",
    kind: "feedback-recorded",
    what: "too broad",
    where: "https://slack.test/1",
    who: "a reviewer",
  };

  it("folds a recorded piece of feedback with no answer against it", () => {
    const entry = foldRegisterEntry({ events: [CREATED, PUSHBACK], slug: "a-slug" })!;
    expect(entry.feedback).toEqual([
      {
        feedbackKind: "pushback",
        id: "f1",
        occurredIso: undefined,
        recordedIso: "2026-08-04T00:00:00.000Z",
        what: "too broad",
        where: "https://slack.test/1",
        who: "a reviewer",
      },
    ]);
  });

  it("an answer attaches to the item carrying its id and leaves the others alone", () => {
    const second: RegisterEvent = { ...PUSHBACK, id: "f2", what: "and slow", who: "another reviewer" };
    const events: readonly RegisterEvent[] = [
      CREATED,
      PUSHBACK,
      second,
      { atIso: "2026-08-05T00:00:00.000Z", how: "narrowed the scope", id: "f2", kind: "feedback-answered" },
    ];
    const entry = foldRegisterEntry({ events, slug: "a-slug" })!;
    expect(entry.feedback[0]!.answer).toBe(undefined);
    expect(entry.feedback[1]!.answer).toEqual({
      answeredIso: "2026-08-05T00:00:00.000Z",
      how: "narrowed the scope",
    });
  });

  it("a later answer replaces the earlier one on the fold, while both events stay in the journal", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      PUSHBACK,
      { atIso: "2026-08-05T00:00:00.000Z", how: "first go", id: "f1", kind: "feedback-answered" },
      { atIso: "2026-08-06T00:00:00.000Z", how: "actually, this", id: "f1", kind: "feedback-answered" },
    ];
    const entry = foldRegisterEntry({ events, slug: "a-slug" })!;
    expect(entry.feedback[0]!.answer!.how).toBe("actually, this");
  });

  it("only pushback and questions ever count as unanswered", () => {
    expect(ANSWER_OWING_FEEDBACK_KINDS).toEqual(["pushback", "question"]);
    const kinds: readonly RegisterEvent[] = [
      CREATED,
      PUSHBACK,
      { ...PUSHBACK, feedbackKind: "acknowledgement", id: "f2", where: undefined },
      { ...PUSHBACK, feedbackKind: "support", id: "f3", where: undefined },
      { ...PUSHBACK, feedbackKind: "question", id: "f4" },
    ];
    const entry = foldRegisterEntry({ events: kinds, slug: "a-slug" })!;
    expect(unansweredFeedback({ entries: [entry] }).map((item) => item.feedback.id)).toEqual(["f1", "f4"]);
  });

  it("sorts unanswered items pushback-first, then oldest-first inside a kind", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      { ...PUSHBACK, atIso: "2026-08-09T00:00:00.000Z", feedbackKind: "question", id: "f1" },
      { ...PUSHBACK, atIso: "2026-08-08T00:00:00.000Z", id: "f2" },
      { ...PUSHBACK, atIso: "2026-08-07T00:00:00.000Z", id: "f3" },
    ];
    const entry = foldRegisterEntry({ events, slug: "a-slug" })!;
    expect(unansweredFeedback({ entries: [entry] }).map((item) => item.feedback.id)).toEqual(["f3", "f2", "f1"]);
  });

  it("allocates the next id from the raw events, counting only recorded feedback", () => {
    expect(nextFeedbackId({ events: [CREATED] })).toBe("f1");
    expect(nextFeedbackId({ events: [CREATED, PUSHBACK] })).toBe("f2");
    const answered: RegisterEvent = {
      atIso: "2026-08-05T00:00:00.000Z",
      how: "x",
      id: "f1",
      kind: "feedback-answered",
    };
    expect(nextFeedbackId({ events: [CREATED, PUSHBACK, answered] })).toBe("f2");
  });
});

/**
 * Rapid-tag-burst identity: does a fresh tag queue behind an already-active ask from the same asker, rather
 * than start its own turn.
 */
import { describe, expect, it } from "vitest";

import { activeAsks } from "../../../../live/ask/burst.js";
import { foldIgnoredAsks, type IgnoredAsk } from "../../../../live/ask/ignore.js";
import { foldIgnoredConversations, type IgnoredConversation } from "../../../../live/ask/ignoredConversation.js";
import { type AskLifecycleEvent, type CapturedEvent } from "../../../../live/ask/lifecycle.js";

/** The instant every active-ask read in this file is judged at — inside the fixtures' own window. */
const NOW_ISO = "2026-08-14T00:05:00.000Z";

/** One permanently-ignored entry, folded into the same `ReadonlyMap` shape `currentlyIgnoredAsks` returns. */
function ignoredRegistry({
  channel,
  messageTs,
}: {
  channel: string;
  messageTs: string;
}): ReadonlyMap<string, IgnoredAsk> {
  return foldIgnoredAsks({
    entries: [{ channel, ignoredAtIso: "2026-08-14T00:00:00.000Z", messageTs, reason: "test", schemaVersion: 1 }],
  });
}

/** One permanently-ignored CONVERSATION, folded into the same shape `currentlyIgnoredConversations` returns. */
function ignoredConversationRegistry({ channel }: { channel: string }): ReadonlyMap<string, IgnoredConversation> {
  return foldIgnoredConversations({
    entries: [{ channel, ignoredAtIso: "2026-08-31T22:40:00.000Z", kind: "ignore", reason: "test", schemaVersion: 1 }],
  });
}

/** A `captured` event for a NEW top-level message — `threadTs === messageTs`. */
function captured({
  channel,
  messageTs,
  threadTs = messageTs,
  userId,
}: {
  channel: string;
  messageTs: string;
  threadTs?: string;
  userId: string;
}): CapturedEvent {
  return {
    channel,
    kind: "captured",
    messageTs,
    surface: "channel",
    threadTs: threadTs,
    tsIso: "2026-08-14T00:00:00.000Z",
    userId,
  };
}

describe("activeAsks", () => {
  it("reports a freshly captured ask as active", () => {
    const events: readonly AskLifecycleEvent[] = [captured({ channel: "C1", messageTs: "100.0001", userId: "U_A" })];

    expect(activeAsks({ nowIso: NOW_ISO, events })).toEqual([
      { channel: "C1", messageTs: "100.0001", state: "captured", threadTs: "100.0001", userId: "U_A" },
    ]);
  });

  it("reports a lease-expired ask as still active — unfinished business, overdue for a fresh judgement", () => {
    const events: readonly AskLifecycleEvent[] = [
      captured({ channel: "C1", messageTs: "100.0001", userId: "U_A" }),
      {
        channel: "C1",
        kind: "lease-expired",
        messageTs: "100.0001",
        threadTs: "100.0001",
        tsIso: "2026-08-14T00:01:00.000Z",
      },
    ];

    expect(activeAsks({ nowIso: NOW_ISO, events })).toEqual([
      { channel: "C1", messageTs: "100.0001", state: "lease-expired", threadTs: "100.0001", userId: "U_A" },
    ]);
  });

  it("excludes an ask that reached a terminal event", () => {
    const events: readonly AskLifecycleEvent[] = [
      captured({ channel: "C1", messageTs: "100.0001", userId: "U_A" }),
      {
        answerTs: "100.0002",
        channel: "C1",
        kind: "answered",
        messageTs: "100.0001",
        threadTs: "100.0001",
        tsIso: "2026-08-14T00:01:00.000Z",
      },
    ];

    expect(activeAsks({ nowIso: NOW_ISO, events })).toEqual([]);
  });

  it("excludes a failed ask — abandoned, not ongoing work", () => {
    const events: readonly AskLifecycleEvent[] = [
      captured({ channel: "C1", messageTs: "100.0001", userId: "U_A" }),
      {
        channel: "C1",
        kind: "failed",
        messageTs: "100.0001",
        reason: "the turn crashed",
        threadTs: "100.0001",
        tsIso: "2026-08-14T00:01:00.000Z",
      },
    ];

    expect(activeAsks({ nowIso: NOW_ISO, events })).toEqual([]);
  });

  it("excludes a permanently-ignored ask even though its own lifecycle state is still captured — the incident this closes", () => {
    const events: readonly AskLifecycleEvent[] = [captured({ channel: "C1", messageTs: "100.0001", userId: "U_A" })];
    const ignored = ignoredRegistry({ channel: "C1", messageTs: "100.0001" });

    expect(activeAsks({ nowIso: NOW_ISO, events, ignored })).toEqual([]);
  });

  it("still reports a NON-ignored active ask when a registry is supplied — a filter, not a blanket exclusion", () => {
    const events: readonly AskLifecycleEvent[] = [captured({ channel: "C1", messageTs: "100.0001", userId: "U_A" })];
    const ignored = ignoredRegistry({ channel: "C1", messageTs: "999.0001" });

    expect(activeAsks({ nowIso: NOW_ISO, events, ignored })).toEqual([
      { channel: "C1", messageTs: "100.0001", state: "captured", threadTs: "100.0001", userId: "U_A" },
    ]);
  });

  it("does not filter at all when no registry is supplied — existing callers are unaffected", () => {
    const events: readonly AskLifecycleEvent[] = [captured({ channel: "C1", messageTs: "100.0001", userId: "U_A" })];

    expect(activeAsks({ nowIso: NOW_ISO, events })).toEqual([
      { channel: "C1", messageTs: "100.0001", state: "captured", threadTs: "100.0001", userId: "U_A" },
    ]);
  });

  it("excludes an ask in a permanently-ignored CONVERSATION even though its own lifecycle state is still captured", () => {
    const events: readonly AskLifecycleEvent[] = [captured({ channel: "C1", messageTs: "100.0001", userId: "U_A" })];
    const ignoredConversations = ignoredConversationRegistry({ channel: "C1" });

    expect(activeAsks({ nowIso: NOW_ISO, events, ignoredConversations })).toEqual([]);
  });

  it("still reports an active ask in a DIFFERENT, non-ignored channel — a filter, not a blanket exclusion", () => {
    const events: readonly AskLifecycleEvent[] = [captured({ channel: "C1", messageTs: "100.0001", userId: "U_A" })];
    const ignoredConversations = ignoredConversationRegistry({ channel: "C_OTHER" });

    expect(activeAsks({ nowIso: NOW_ISO, events, ignoredConversations })).toEqual([
      { channel: "C1", messageTs: "100.0001", state: "captured", threadTs: "100.0001", userId: "U_A" },
    ]);
  });
});

/**
 * An ask no session ever routed stops holding its slot at the sweep's own bound, whether or not a sweep runs.
 *
 * Measured: two of the owner's asks stood at `checklist-posted` for 752 minutes with no routing
 * decision, spent the owner's cap of three, and the next tag queued behind them with only an `:eyes:` to show for it.
 * Every fixture here is captured at the same midnight, so the clock alone moves the verdict.
 */
describe("activeAsks and an ask no session ever routed", () => {
  const OWNER = "U_OWNER";

  /** A `checklist-posted` ask whose card went up one minute after capture — the stranded-ask shape. */
  function carded({ channel, messageTs }: { channel: string; messageTs: string }): AskLifecycleEvent[] {
    return [
      captured({ channel, messageTs, userId: OWNER }),
      {
        channel,
        kind: "checklist-posted",
        messageTs,
        threadTs: messageTs,
        tsIso: "2026-08-14T00:01:00.000Z",
        turnId: `turn-${messageTs}`,
        workingTs: "100.9000",
      },
    ];
  }

  it("keeps a captured ask active at 29 minutes — still inside the window a session takes to route it", () => {
    const events = [captured({ channel: "C1", messageTs: "100.0001", userId: OWNER })];

    expect(activeAsks({ events, nowIso: "2026-08-14T00:29:59.000Z" })).toEqual([
      { channel: "C1", messageTs: "100.0001", state: "captured", threadTs: "100.0001", userId: OWNER },
    ]);
  });

  it("drops a captured ask at 30 minutes — the minute the sweep would call it over", () => {
    const events = [captured({ channel: "C1", messageTs: "100.0001", userId: OWNER })];

    expect(activeAsks({ events, nowIso: "2026-08-14T00:30:00.000Z" })).toEqual([]);
  });

  it("measures a carded ask from its LAST event, not from its capture", () => {
    const events = carded({ channel: "C1", messageTs: "100.0001" });

    expect(activeAsks({ events, nowIso: "2026-08-14T00:30:00.000Z" }).map((ask) => ask.state)).toEqual([
      "checklist-posted",
    ]);
    expect(activeAsks({ events, nowIso: "2026-08-14T00:31:00.000Z" })).toEqual([]);
  });

  it("never ages out a DISPATCHED ask — a routed ask is the lease's business, not this bound's", () => {
    const events: AskLifecycleEvent[] = [
      captured({ channel: "C1", messageTs: "100.0001", userId: OWNER }),
      {
        channel: "C1",
        decision: {
          confidence: "high",
          needs: [],
          rationale: "n/a",
          response: "respond",
          schemaVersion: 1,
          tier: "inline",
          truthMode: "none",
        },
        kind: "dispatched",
        leaseExpiresAt: "2026-08-14T01:00:00.000Z",
        messageTs: "100.0001",
        threadTs: "100.0001",
        tier: "fresh-visible-session",
        tsIso: "2026-08-14T00:02:00.000Z",
      },
    ];

    expect(activeAsks({ events, nowIso: "2026-08-14T10:00:00.000Z" }).map((ask) => ask.state)).toEqual(["dispatched"]);
  });

  it("reproduces the incident: three dead carded asks stop counting, so a brief shows the owner nothing in flight", () => {
    const events = [
      ...carded({ channel: "C_DM", messageTs: "100.0001" }),
      ...carded({ channel: "C_DM", messageTs: "100.0002" }),
      ...carded({ channel: "C_OTHER", messageTs: "100.0003" }),
    ];

    expect(activeAsks({ events, nowIso: "2026-08-14T00:20:00.000Z" })).toHaveLength(3);
    expect(activeAsks({ events, nowIso: "2026-08-14T12:33:00.000Z" })).toEqual([]);
  });

  it("stops naming a dead holder to the NEXT tag's brief, while a live one is still named", () => {
    const events = [captured({ channel: "C1", messageTs: "100.0001", userId: "U_OTHER" })];

    expect(activeAsks({ events, nowIso: "2026-08-14T00:10:00.000Z" }).map((ask) => ask.messageTs)).toEqual([
      "100.0001",
    ]);
    expect(activeAsks({ events, nowIso: "2026-08-15T00:00:00.000Z" })).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { readSourceFreshness } from "../../components/live/readSourceFreshness";
import { freshnessWordsOf } from "../../lib/sourceFreshness";
import type { SourceFreshnessRow } from "../../lib/sourceFreshnessReport";
import { FRESHNESS_TONES, STATE_TONE } from "../../lib/sourceFreshnessTones";

const HOUR = 3_600_000;
const NOW_MS = Date.parse("2026-10-04T14:00:00.000Z");

/** An instant `hours` before NOW_MS. */
function hoursAgo({ hours }: { hours: number }): string {
  return new Date(NOW_MS - hours * HOUR).toISOString();
}

/** A wire row as `automation freshness --json` prints it — Slack, late, measured. */
function wireRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    behindMs: 15_193_461,
    blocker: null,
    cadence: "0 */4 * * *",
    label: "Slack",
    lastAttemptAtIso: "2026-10-04T09:46:00.000Z",
    lastVerifiedSyncAtIso: "2026-10-04T09:46:00.000Z",
    lateByMs: 793_461,
    marks: {
      blocked: false,
      failing: false,
      late: true,
      paused: false,
      recordUnreadable: false,
      unscheduled: false,
      unverified: true,
    },
    newestRecordAgeMs: 16_678_838,
    newestRecordAtIso: "2026-10-04T09:21:00.000Z",
    problems: [],
    recipeId: "resync-corpus-slack",
    source: "slack",
    state: "late",
    storedCadence: "0 */4 * * *",
    windowMs: 4 * HOUR,
    ...over,
  };
}

/** A parsed row with sensible defaults. */
function row(over: Partial<SourceFreshnessRow> = {}): SourceFreshnessRow {
  return {
    blocker: undefined,
    label: "Slack",
    lastVerifiedSyncAtIso: hoursAgo({ hours: 1 }),
    newestRecordAtIso: hoursAgo({ hours: 0.5 }),
    problems: [],
    source: "slack",
    state: "current",
    windowMs: 4 * HOUR,
    ...over,
  };
}

/** Every source the verb reports, Slack's row carrying `slack`'s overrides and the rest plain. */
function wireRows({ slack = {} }: { slack?: Record<string, unknown> } = {}): Record<string, unknown>[] {
  const others = [
    ["github", "GitHub"],
    ["linear", "Linear"],
    ["notion", "Notion"],
    ["gmail", "Gmail"],
    ["calendar", "Calendar"],
    ["fathom", "Fathom"],
    ["chatgpt", "ChatGPT"],
    ["outlook-calendar", "Outlook Calendar"],
    ["outlook", "Outlook"],
  ].map(([source, label]) => wireRow({ label, source }));
  return [wireRow(slack), ...others];
}

/** The verb's whole document over `sources`. */
function doc({ sources }: { sources: readonly Record<string, unknown>[] }): Record<string, unknown> {
  return { issues: [], observedAtIso: "2026-10-04T14:00:00.000Z", sources };
}

describe("readSourceFreshness", () => {
  it("reads the verb's document, nulls as absent, and never carries the wire's lateByMs", () => {
    const read = readSourceFreshness({ payload: doc({ sources: wireRows({ slack: { newestRecordAtIso: null } }) }) });
    expect(read!.observedAtIso).toBe("2026-10-04T14:00:00.000Z");
    expect(read!.sources.map((one) => one.source)).toEqual([
      "slack",
      "github",
      "linear",
      "notion",
      "gmail",
      "calendar",
      "fathom",
      "chatgpt",
      "outlook-calendar",
      "outlook",
    ]);
    expect(read!.sources[0]).toEqual({
      blocker: undefined,
      label: "Slack",
      lastVerifiedSyncAtIso: "2026-10-04T09:46:00.000Z",
      newestRecordAtIso: undefined,
      problems: [],
      source: "slack",
      state: "late",
      windowMs: 4 * HOUR,
    });
  });

  it("keeps a well-formed blocker", () => {
    const read = readSourceFreshness({
      payload: doc({
        sources: wireRows({ slack: { blocker: { reason: "signed out", steps: ["Sign in"] }, state: "blocked" } }),
      }),
    });
    expect(read!.sources.find((one) => one.source === "slack")!.blocker).toEqual({
      reason: "signed out",
      steps: ["Sign in"],
    });
  });

  it("refuses the whole report for one row it cannot read, never showing the rest", () => {
    const payload = (bad: Record<string, unknown>): unknown => doc({ sources: wireRows({ slack: bad }) });
    expect(readSourceFreshness({ payload: payload({}) })).not.toBe(undefined);
    expect(readSourceFreshness({ payload: payload({ state: "sideways" }) })).toBe(undefined);
    expect(readSourceFreshness({ payload: payload({ blocker: { reason: "x" } }) })).toBe(undefined);
    expect(readSourceFreshness({ payload: payload({ lastVerifiedSyncAtIso: 5 }) })).toBe(undefined);
    expect(readSourceFreshness({ payload: payload({ problems: "one" }) })).toBe(undefined);
    expect(readSourceFreshness({ payload: payload({ label: "Dropbox", source: "dropbox" }) })).toBe(undefined);
    expect(readSourceFreshness({ payload: payload({ source: undefined }) })).toBe(undefined);
    expect(readSourceFreshness({ payload: payload({ lastVerifiedSyncAtIso: "not-a-date" }) })).toBe(undefined);
    expect(readSourceFreshness({ payload: payload({ newestRecordAtIso: "not-a-date" }) })).toBe(undefined);
    expect(readSourceFreshness({ payload: payload({ lastVerifiedSyncAtIso: "2099-01-01T00:00:00.000Z" }) })).toBe(
      undefined,
    );
    expect(readSourceFreshness({ payload: payload({ newestRecordAtIso: "2027-09-05T23:30:00.000Z" }) })).not.toBe(
      undefined,
    );
    expect(readSourceFreshness({ payload: payload({ lastVerifiedSyncAtIso: null, state: "current" }) })).toBe(
      undefined,
    );
    expect(readSourceFreshness({ payload: payload({ lastVerifiedSyncAtIso: null, state: "late" }) })).toBe(undefined);
    expect(readSourceFreshness({ payload: payload({ lastVerifiedSyncAtIso: null, state: "never-synced" }) })).not.toBe(
      undefined,
    );
    const revoked = { reason: "token revoked", steps: ["Re-issue it"] };
    expect(readSourceFreshness({ payload: payload({ blocker: revoked, state: "current" }) })).toBe(undefined);
    expect(readSourceFreshness({ payload: payload({ problems: ["exited 1"], state: "late" }) })).toBe(undefined);
    expect(readSourceFreshness({ payload: payload({ problems: ["exited 1"], state: "failing" }) })).not.toBe(undefined);
  });

  it("names each row by its own source whatever label the wire claims", () => {
    const read = readSourceFreshness({ payload: doc({ sources: wireRows({ slack: { label: "GitHub" } }) }) });
    expect(read!.sources.map((one) => one.label)).toEqual([
      "Slack",
      "GitHub",
      "Linear",
      "Notion",
      "Gmail",
      "Calendar",
      "Fathom",
      "ChatGPT",
      "Outlook Calendar",
      "Outlook",
    ]);
  });

  it("words a current row by its sync time whatever lateness the wire claims", () => {
    const read = readSourceFreshness({
      payload: doc({
        sources: wireRows({
          slack: {
            lastVerifiedSyncAtIso: hoursAgo({ hours: 1 }),
            lateByMs: HOUR,
            newestRecordAtIso: hoursAgo({ hours: 0.5 }),
            state: "current",
          },
        }),
      }),
    });
    const slack = read!.sources.find((one) => one.source === "slack")!;
    expect(freshnessWordsOf({ nowMs: NOW_MS, row: slack }).sentence).toBe("Slack synced 1.0h ago.");
  });

  it("refuses a report missing a source or naming one twice, which would leave a panel's source unreported", () => {
    const all = wireRows();
    expect(readSourceFreshness({ payload: doc({ sources: all.slice(0, 1) }) })).toBe(undefined);
    expect(readSourceFreshness({ payload: doc({ sources: all.slice(0, -1) }) })).toBe(undefined);
    expect(readSourceFreshness({ payload: doc({ sources: [...all.slice(0, -1), ...all.slice(0, 1)] }) })).toBe(
      undefined,
    );
  });

  it("refuses a document whose own instant will not parse", () => {
    expect(readSourceFreshness({ payload: { ...doc({ sources: wireRows() }), observedAtIso: "not-a-date" } })).toBe(
      undefined,
    );
  });

  it("refuses a document missing its issues or its instant", () => {
    expect(readSourceFreshness({ payload: { observedAtIso: "2026-10-04T14:00:00.000Z", sources: wireRows() } })).toBe(
      undefined,
    );
    expect(readSourceFreshness({ payload: { issues: [], sources: wireRows() } })).toBe(undefined);
  });

  it("refuses a document with no rows, which would draw nothing and read as all clear", () => {
    expect(
      readSourceFreshness({ payload: { issues: [], observedAtIso: "2026-10-04T14:00:00.000Z", sources: [] } }),
    ).toBe(undefined);
  });
});

describe("freshnessWordsOf", () => {
  it("says a current source plainly, in the quiet colour", () => {
    expect(freshnessWordsOf({ nowMs: NOW_MS, row: row() })).toEqual({
      sentence: "Slack synced 1.0h ago.",
      tone: "fresh",
    });
  });

  it("speaks in minutes under an hour, tenths of hours under a day, then days", () => {
    const syncedAgo = ({ ms }: { ms: number }): string =>
      freshnessWordsOf({
        nowMs: NOW_MS,
        row: row({ lastVerifiedSyncAtIso: new Date(NOW_MS - ms).toISOString(), state: "paused" }),
      }).sentence;
    expect([syncedAgo({ ms: 59_999 }), syncedAgo({ ms: 12 * 60_000 }), syncedAgo({ ms: 74.4 * HOUR })]).toEqual([
      "Slack's sync is paused, and its last verified sync was just now. Stored Slack data may be out of date.",
      "Slack's sync is paused, and its last verified sync was 12m ago. Stored Slack data may be out of date.",
      "Slack's sync is paused, and its last verified sync was 3.1d ago. Stored Slack data may be out of date.",
    ]);
  });

  it("says how far past its window a late source is, and that its data may be out of date", () => {
    expect(
      freshnessWordsOf({ nowMs: NOW_MS, row: row({ lastVerifiedSyncAtIso: hoursAgo({ hours: 7 }), state: "late" }) }),
    ).toEqual({
      sentence:
        "Slack's last verified sync was 7.0h ago, 3.0h past its 4.0h window. Stored Slack data may be out of date.",
      tone: "attention",
    });
  });

  it("carries a failing sync's own first problem apart from its sentence, never set inside it (steer 7)", () => {
    const stderr =
      "`slopweaver refresh --source slack --store` exited 1\nError: socket hang up\n    at TLSSocket.onClose";
    expect(
      freshnessWordsOf({ nowMs: NOW_MS, row: row({ problems: [stderr, "a second problem"], state: "failing" }) }),
    ).toStrictEqual({
      failure: stderr,
      sentence: "Slack's last sync failed. Stored Slack data may be out of date.",
      tone: "attention",
    });
  });

  it("says a failing sync that recorded no problem with no reason to draw", () => {
    expect(freshnessWordsOf({ nowMs: NOW_MS, row: row({ problems: [], state: "failing" }) })).toStrictEqual({
      failure: undefined,
      sentence: "Slack's last sync failed. Stored Slack data may be out of date.",
      tone: "attention",
    });
  });

  it("draws no failure for a source that is not failing, whatever problems it recorded", () => {
    expect(
      freshnessWordsOf({ nowMs: NOW_MS, row: row({ problems: ["an old problem"], state: "paused" }) }).failure,
    ).toBe(undefined);
  });

  it("names a blocker's reason", () => {
    const words = freshnessWordsOf({
      nowMs: NOW_MS,
      row: row({ blocker: { reason: "the token was revoked", steps: ["Re-issue it"] }, state: "blocked" }),
    });
    expect(words.sentence).toBe(
      "Slack cannot sync until something only you can do is done: the token was revoked. Stored Slack data may be out of date.",
    );
  });

  it("never words a paused or unscheduled source as not yet out of date, since either may already be late", () => {
    const late = { lastVerifiedSyncAtIso: hoursAgo({ hours: 9 }) };
    expect(freshnessWordsOf({ nowMs: NOW_MS, row: row({ ...late, state: "paused" }) }).sentence).toBe(
      "Slack's sync is paused, and its last verified sync was 9.0h ago. Stored Slack data may be out of date.",
    );
    expect(freshnessWordsOf({ nowMs: NOW_MS, row: row({ ...late, state: "unscheduled" }) }).sentence).toBe(
      "Nothing is scheduled to sync Slack, and its last verified sync was 9.0h ago. Stored Slack data may be out of date.",
    );
  });

  it("warns that the stored copy may be out of date when the sync record is unreadable", () => {
    expect(freshnessWordsOf({ nowMs: NOW_MS, row: row({ state: "unreadable" }) }).sentence).toBe(
      "Can't tell how current Slack is: its sync record is unreadable. Stored Slack data may be out of date.",
    );
  });

  it("reads a current row late once the page's clock has carried it past its window, polls held or not", () => {
    expect(freshnessWordsOf({ nowMs: NOW_MS, row: row({ lastVerifiedSyncAtIso: hoursAgo({ hours: 4.5 }) }) })).toEqual({
      sentence:
        "Slack's last verified sync was 4.5h ago, 30m past its 4.0h window. Stored Slack data may be out of date.",
      tone: "attention",
    });
  });

  it("reads a current row unverified once its newest stored record is older than its window, or absent", () => {
    const unverified = {
      sentence:
        "Slack synced 1.0h ago, but its newest stored record is old, so whether it is current cannot be checked.",
      tone: "unchecked",
    };
    expect(freshnessWordsOf({ nowMs: NOW_MS, row: row({ newestRecordAtIso: hoursAgo({ hours: 8 }) }) })).toEqual(
      unverified,
    );
    expect(freshnessWordsOf({ nowMs: NOW_MS, row: row({ newestRecordAtIso: undefined }) })).toEqual(unverified);
  });

  it("cannot believe a verified sync later than the page's clock allows, and says so", () => {
    expect(freshnessWordsOf({ nowMs: NOW_MS, row: row({ lastVerifiedSyncAtIso: hoursAgo({ hours: -1 }) }) })).toEqual({
      sentence: "Can't tell how current Slack is: its sync record is unreadable. Stored Slack data may be out of date.",
      tone: "attention",
    });
    const withinTick = freshnessWordsOf({
      nowMs: NOW_MS,
      row: row({ lastVerifiedSyncAtIso: new Date(NOW_MS + 30_000).toISOString() }),
    });
    expect(withinTick.sentence).toBe("Slack synced just now.");
  });

  it("says a source with no verified sync never synced", () => {
    expect(
      freshnessWordsOf({ nowMs: NOW_MS, row: row({ lastVerifiedSyncAtIso: undefined, state: "never-synced" }) }),
    ).toEqual({
      sentence: "Slack has no verified successful sync. Stored Slack data may be out of date.",
      tone: "attention",
    });
  });
});

describe("STATE_TONE", () => {
  it("draws every state in one of three distinct colours, only unverified in the unchecked one", () => {
    const tones = Object.values(FRESHNESS_TONES);
    expect(tones.length).toBe(3);
    expect(new Set(tones.map((tone) => tone.className)).size).toBe(3);
    expect(STATE_TONE).toEqual({
      blocked: "attention",
      current: "fresh",
      failing: "attention",
      late: "attention",
      "never-synced": "attention",
      paused: "attention",
      unreadable: "attention",
      unscheduled: "attention",
      unverified: "unchecked",
    });
  });
});

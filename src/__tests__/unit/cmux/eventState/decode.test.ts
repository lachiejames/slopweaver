/**
 * The strict decoders for the cmux event state. The decoder they replace dropped an entry it could not read and
 * answered `{}` for a file it could not parse; these report every problem and drop nothing.
 */
import { describe, expect, it } from "vitest";

import { activitiesOfFile, decodeCursorFile, decodeSessionActivities } from "../../../../cmux/eventState/decode.js";
import type { SessionActivity } from "../../../../cmux/sessionActivity.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/**
 * One valid activity, overridable field by field.
 *
 * @param over the fields to replace
 * @returns the activity
 */
function activity(over: Partial<SessionActivity> = {}): SessionActivity {
  return {
    agentSessionId: "agent-1",
    agentSource: "claude",
    attentionKind: "notification",
    attentionSinceIso: "2026-10-31T03:59:00.000Z",
    cwd: "/work/acme",
    lastEventAtIso: "2026-10-31T03:59:00.000Z",
    lastEventName: "agent.hook.Notification",
    lastSeq: 40,
    lastTurnEndedAtIso: undefined,
    lastTurnStartedAtIso: "2026-10-31T03:50:00.000Z",
    sessionStartedAtIso: undefined,
    toolCalls: 3,
    workspaceId: "W1",
    ...over,
  };
}

describe("decodeSessionActivities", () => {
  it("decodes a valid fold whole", () => {
    const fold = { W1: activity(), W2: activity({ attentionKind: undefined, lastSeq: 12, workspaceId: "W2" }) };

    expect(unwrap(decodeSessionActivities({ activities: fold, cursorSeq: 40 }))).toEqual(fold);
  });

  it("unwraps a session id a fold stored in cmux's feed form, so a quiet seat heals on the first watch", () => {
    const wrapped = `cmux-feed-v1:Y2xhdWRl:${Buffer.from("07f92f28-f7e7-4bbc-9845-c9b4ef51d520").toString("base64url")}`;
    const fold = { W1: activity({ agentSessionId: wrapped }) };

    expect(unwrap(decodeSessionActivities({ activities: fold, cursorSeq: 40 }))["W1"]!.agentSessionId).toBe(
      "claude-07f92f28-f7e7-4bbc-9845-c9b4ef51d520",
    );
  });

  it("keeps a stored feed-form id whose parts do not decode exactly as it was", () => {
    const fold = { W1: activity({ agentSessionId: "cmux-feed-v1:Y2xhdWRl$:A" }) };

    expect(unwrap(decodeSessionActivities({ activities: fold, cursorSeq: 40 }))["W1"]!.agentSessionId).toBe(
      "cmux-feed-v1:Y2xhdWRl$:A",
    );
  });

  it("decodes an empty fold as empty", () => {
    expect(unwrap(decodeSessionActivities({ activities: {}, cursorSeq: 0 }))).toEqual({});
  });

  it("decodes a fold whose optional fields were dropped by a jsonb round trip", () => {
    const stored = { W1: { lastEventAtIso: "t", lastEventName: "n", lastSeq: 1, toolCalls: 0, workspaceId: "W1" } };

    expect(unwrap(decodeSessionActivities({ activities: stored, cursorSeq: 1 }))["W1"]!.cwd).toBeUndefined();
  });

  it("refuses a fold that is not an object", () => {
    expect(unwrapErr(decodeSessionActivities({ activities: [], cursorSeq: 1 }))).toEqual([
      "the fold is not an object keyed by workspace id",
    ]);
  });

  it("reports every bad entry at once rather than dropping any", () => {
    const fold = {
      W1: { ...activity(), toolCalls: -1 },
      W2: "not an entry",
      W3: { ...activity({ workspaceId: "W3" }), attentionKind: "shout", cwd: 4 },
    };

    expect(unwrapErr(decodeSessionActivities({ activities: fold, cursorSeq: 40 }))).toEqual([
      "activity W1's toolCalls is not a non-negative integer",
      "activity W2 is not an object",
      "activity W3's cwd is neither absent nor a string",
      "activity W3's attentionKind is not notification or question",
    ]);
  });

  it("refuses an entry filed under a key that is not its own workspace id", () => {
    expect(unwrapErr(decodeSessionActivities({ activities: { W9: activity() }, cursorSeq: 40 }))).toEqual([
      "activity W9 is filed under a key that is not its own workspaceId",
    ]);
  });

  it("keeps an entry keyed __proto__ as an entry, never letting it vanish from the fold", () => {
    // `JSON.parse` defines `__proto__` as an own key, exactly as a jsonb read or an import file delivers it.
    const stored: unknown = JSON.parse(
      JSON.stringify({ x: activity({ lastSeq: 7, workspaceId: "__proto__" }) }).replace('"x"', '"__proto__"'),
    );

    const decoded = unwrap(decodeSessionActivities({ activities: stored, cursorSeq: 7 }));

    expect(Object.keys(decoded)).toEqual(["__proto__"]);
    expect(Object.values(decoded).map((entry) => entry.lastSeq)).toEqual([7]);
  });

  it("refuses an entry folded past the cursor — the fold-ahead state a crash between two file writes left", () => {
    expect(
      unwrapErr(decodeSessionActivities({ activities: { W1: activity({ lastSeq: 41 }) }, cursorSeq: 40 })),
    ).toEqual(["activity W1 has folded seq 41, past the cursor 40 it is meant to be complete up to"]);
  });
});

describe("decodeCursorFile", () => {
  it("reads the sequence a cursor file recorded", () => {
    expect(unwrap(decodeCursorFile({ text: '{"seq":412,"recordedAtIso":"2026-09-16T04:00:00.000Z"}' }))).toBe(412);
  });

  it("refuses text that is not JSON, naming the file", () => {
    expect(unwrapErr(decodeCursorFile({ text: "{not json" }))).toEqual(["the cursor file: it is not JSON"]);
  });

  it("refuses a negative sequence", () => {
    expect(unwrapErr(decodeCursorFile({ text: '{"seq":-1}' }))).toEqual([
      "the cursor file: its seq is not a non-negative integer",
    ]);
  });
});

describe("activitiesOfFile", () => {
  it("unwraps the fold the activity file carries", () => {
    expect(unwrap(activitiesOfFile({ decoded: { activities: { W1: 1 }, recordedAtIso: "t" } }))).toEqual({ W1: 1 });
  });

  it("refuses an envelope with no activities object", () => {
    expect(unwrapErr(activitiesOfFile({ decoded: { activities: [] } }))).toEqual([
      "the activity file: it is not an object carrying an activities object",
    ]);
  });
});

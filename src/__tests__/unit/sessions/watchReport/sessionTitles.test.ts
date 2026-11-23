/* A seat's session title: read from a transcript store by its bare uuid, and the id form that reading accepts. */
import { describe, expect, it } from "vitest";

import { parseEventFrame } from "../../../../cmux/events.js";
import { foldSessionActivity } from "../../../../cmux/sessionActivity.js";
import { claudeTranscriptId, sessionWatchRows, withSessionTitles } from "../../../../sessions/watchReport.js";
import { NOW, UNMAPPED_ROW } from "./harness.js";

describe("withSessionTitles", () => {
  const UUID = "07f92f28-f7e7-4bbc-9845-c9b4ef51d520";
  /** Titles a transcript store holds, by bare uuid. */
  const titleOf: Parameters<typeof withSessionTitles>[0]["titleOf"] = (transcriptId) =>
    ({ [UUID]: "  Board ready set read failure ", "a0000075-0000-4000-8000-000000000081": " " })[transcriptId];

  it("titles a seat whose hook frame carried cmux's feed-form id, straight from the wire", () => {
    const line = JSON.stringify({
      id: "e1",
      name: "agent.hook.Stop",
      occurred_at: NOW,
      payload: {
        _source: "claude",
        session_id: `cmux-feed-v1:Y2xhdWRl:${Buffer.from(UUID).toString("base64url")}`,
      },
      seq: 1,
      type: "event",
      workspace_id: "W1",
    });
    const activities = foldSessionActivity({ events: [parseEventFrame({ line })!] });
    const watched = sessionWatchRows({ activities, idleAfterMs: 600_000, nowIso: NOW, workspaces: [] });

    const [row] = withSessionTitles({ rows: watched, titleOf });

    expect(row!.sessionId).toBe(`claude-${UUID}`);
    expect(row!.sessionTitle).toBe("Board ready set read failure");
  });

  it("reads a Claude session's title by its bare uuid, trimmed, and leaves another host's, an untitled or a blank one unset", () => {
    const rows = withSessionTitles({
      rows: [
        { ...UNMAPPED_ROW, sessionId: `claude-${UUID}` },
        { ...UNMAPPED_ROW, host: "claude", sessionId: UUID },
        { ...UNMAPPED_ROW, sessionId: UUID },
        { ...UNMAPPED_ROW, host: "codex", sessionId: UUID },
        { ...UNMAPPED_ROW, host: "codex", sessionId: `claude-${UUID}` },
        { ...UNMAPPED_ROW, sessionId: "codex-thread-1" },
        { ...UNMAPPED_ROW, sessionId: "claude-a0000075-0000-4000-8000-000000000081" },
        { ...UNMAPPED_ROW, sessionId: "claude-99999999-2222-3333-4444-555555555555" },
        UNMAPPED_ROW,
      ],
      titleOf,
    });
    expect(rows.map((row) => row.sessionTitle)).toEqual([
      "Board ready set read failure",
      "Board ready set read failure",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("claudeTranscriptId", () => {
  it("strips cmux's claude- prefix and refuses an id that is not a uuid", () => {
    expect([
      claudeTranscriptId({ sessionId: "claude-07f92f28-f7e7-4bbc-9845-c9b4ef51d520" }),
      claudeTranscriptId({ sessionId: "claude-abc" }),
      claudeTranscriptId({ sessionId: undefined }),
    ]).toEqual(["07f92f28-f7e7-4bbc-9845-c9b4ef51d520", undefined, undefined]);
  });
});

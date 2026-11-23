import { describe, expect, it } from "vitest";
import type { DripOutcome } from "../../../../../../cli/commands/slack/dripCore.js";
import { recordDraftRelease } from "../../../../../../cli/commands/slack/releaseSend.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../../lib/result.js";
import { SlackDraftErrors } from "../../../../../../outbound/slack/draftErrors.js";
import type { SlackDraftEvent } from "../../../../../../outbound/slack/draftRegister.js";
import { heldRow } from "./fixtures.js";

const SENT: readonly DripOutcome[] = [{ fileIds: [], index: 0, state: "sent", ts: "1700000001.000100" }];

describe("recordDraftRelease", () => {
  it("marks a landed send released under its ts", () => {
    const events: SlackDraftEvent[] = [];
    const code = recordDraftRelease({
      deps: {
        appendDraftEvent: ({ event }) => {
          events.push(event);
          return ok(true);
        },
      },
      draft: heldRow(),
      dryRun: false,
      exitCode: EXIT_OK,
      heldCuts: [],
      home: "/unused",
      outcomes: SENT,
    });

    expect(code).toBe(EXIT_OK);
    expect(events.map((event) => [event.kind, event.id, "ts" in event ? event.ts : ""])).toEqual([
      ["released", "sd-1a2b3c4d", "1700000001.000100"],
    ]);
  });

  it("journals the landed permalink and spends every other held cut, naming the released row", () => {
    const events: SlackDraftEvent[] = [];
    const permalink = "https://acme.slack.com/archives/D1/p1700000001000100";
    const code = recordDraftRelease({
      deps: {
        appendDraftEvent: ({ event }) => {
          events.push(event);
          return ok(true);
        },
      },
      draft: heldRow(),
      dryRun: false,
      exitCode: EXIT_OK,
      heldCuts: ["sd-0dd0c0de"],
      home: "/unused",
      outcomes: [{ fileIds: [], index: 0, permalink, state: "sent", ts: "1700000001.000100" }],
    });

    expect(code).toBe(EXIT_OK);
    expect(events.map(({ tsIso: _tsIso, ...rest }) => rest)).toEqual([
      // The digest of the words that went out, so a voice edit landing mid-send never reads as sent.
      {
        channel: "D1",
        digest: heldRow().digest,
        id: "sd-1a2b3c4d",
        kind: "released",
        permalink,
        ts: "1700000001.000100",
      },
      {
        id: "sd-0dd0c0de",
        kind: "dropped",
        note: "superseded by sd-1a2b3c4d, released as D1 1700000001.000100 — the same message",
      },
    ]);
  });

  it("leaves the row held when Slack refused the send, holding it slack-refused so the owner's card says why", () => {
    const events: SlackDraftEvent[] = [];
    const code = recordDraftRelease({
      deps: {
        appendDraftEvent: ({ event }) => {
          events.push(event);
          return ok(true);
        },
      },
      draft: heldRow(),
      dryRun: false,
      exitCode: EXIT_ERROR,
      heldCuts: ["sd-0dd0c0de"],
      home: "/unused",
      outcomes: [{ error: "channel_not_found", index: 0, state: "failed" }],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(events.map(({ tsIso: _tsIso, ...rest }) => rest)).toEqual([
      { id: "sd-1a2b3c4d", kind: "held", reason: "slack-refused", why: "Slack refused the send: channel_not_found" },
    ]);
  });

  it("holds a refusal past a message an EARLIER run confirmed, since this run sent nothing", () => {
    const events: SlackDraftEvent[] = [];
    const code = recordDraftRelease({
      deps: {
        appendDraftEvent: ({ event }) => {
          events.push(event);
          return ok(true);
        },
      },
      draft: heldRow(),
      dryRun: false,
      exitCode: EXIT_ERROR,
      heldCuts: [],
      home: "/unused",
      outcomes: [
        { index: 0, state: "already-sent", ts: "1700000001.000100" },
        { error: "channel_not_found", index: 1, state: "failed" },
      ],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(events.map(({ tsIso: _tsIso, ...rest }) => rest)).toEqual([
      { id: "sd-1a2b3c4d", kind: "held", reason: "slack-refused", why: "Slack refused the send: channel_not_found" },
    ]);
  });

  it("holds nothing when the send was never Slack's to refuse, or on a dry run", () => {
    const events: SlackDraftEvent[] = [];
    const deps = {
      appendDraftEvent: ({ event }: { event: SlackDraftEvent }) => {
        events.push(event);
        return ok(true as const);
      },
    };
    const unconfirmed = recordDraftRelease({
      deps,
      draft: heldRow(),
      dryRun: false,
      exitCode: EXIT_ERROR,
      heldCuts: [],
      home: "/unused",
      outcomes: [{ index: 0, reservedIso: "2026-10-08T00:00:00.000Z", state: "unconfirmed" }],
    });
    const dry = recordDraftRelease({
      deps,
      draft: heldRow(),
      dryRun: true,
      exitCode: EXIT_ERROR,
      heldCuts: [],
      home: "/unused",
      outcomes: [{ error: "channel_not_found", index: 0, state: "failed" }],
    });

    expect([unconfirmed, dry, events]).toEqual([EXIT_ERROR, EXIT_ERROR, []]);
  });

  it("exits non-zero when a landed send cannot be marked, so the held row is not silently re-offered", () => {
    const code = recordDraftRelease({
      deps: {
        appendDraftEvent: () => err(SlackDraftErrors.writeFailed({ cause: new Error("disk full"), path: "/q" })),
      },
      draft: heldRow(),
      dryRun: false,
      exitCode: EXIT_OK,
      heldCuts: [],
      home: "/unused",
      outcomes: SENT,
    });

    expect(code).toBe(EXIT_ERROR);
  });
});

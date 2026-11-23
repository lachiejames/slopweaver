/**
 * `releaseRefusalHold.ts` — a release the pre-send re-read refused is held with the reason the owner's Queue card draws, so a
 * thread that moved after the owner's yes says so the same tick rather than reading as a send still owed.
 */
import { describe, expect, it } from "vitest";

import { freshnessHoldReason, holdFreshnessRefusal } from "../../../../../cli/commands/slack/releaseRefusalHold.js";
import type { SlackWriteDeps } from "../../../../../cli/commands/slack/run.js";
import { holdSendThrow } from "../../../../../cli/commands/slack/sendFailureJournalling.js";
import { ok } from "../../../../../lib/result.js";
import type { SlackDraftEvent } from "../../../../../outbound/slack/draftRegister.js";
import { ReleaseFreshnessErrors } from "../../../../../outbound/slack/releaseFreshness.js";

const DRAFT_ID = "sd-c57b4ade";

const MOVED = ReleaseFreshnessErrors.threadMoved({
  changes: { added: ["1759900000.000100"], edited: [], removed: [] },
  draftId: DRAFT_ID,
});

/** A register that keeps what it is handed. */
function recordingDeps(): { deps: Pick<SlackWriteDeps, "appendDraftEvent">; events: SlackDraftEvent[] } {
  const events: SlackDraftEvent[] = [];
  return {
    deps: {
      appendDraftEvent: ({ event }) => {
        events.push(event);
        return ok(true as const);
      },
    },
    events,
  };
}

describe("freshnessHoldReason", () => {
  it("holds a moved thread, a stale clearance and an answered prior as thread-moved, an unreadable one as slack-refused", () => {
    const errors = [
      MOVED,
      ReleaseFreshnessErrors.clearanceMismatch({ changed: ["a"], cleared: [], draftId: DRAFT_ID }),
      ReleaseFreshnessErrors.priorAnswered({
        answeredTs: ["1"],
        draftId: DRAFT_ID,
        permalink: "https://x.slack.com/p",
      }),
      ReleaseFreshnessErrors.unreadable({ cause: "auth.test: invalid_auth", draftId: DRAFT_ID }),
      ReleaseFreshnessErrors.watermarkInvalid({ draftId: DRAFT_ID, tsIso: "nope" }),
    ];

    expect(errors.map((error) => freshnessHoldReason({ error }))).toEqual([
      "thread-moved",
      "thread-moved",
      "thread-moved",
      "slack-refused",
      undefined,
    ]);
  });
});

describe("holdFreshnessRefusal", () => {
  it("appends a thread-moved hold naming what moved", () => {
    const { deps, events } = recordingDeps();
    holdFreshnessRefusal({ deps, draftId: DRAFT_ID, dryRun: false, error: MOVED, home: "/unused" });

    expect(events).toEqual([
      { id: DRAFT_ID, kind: "held", reason: "thread-moved", tsIso: expect.any(String), why: MOVED.message },
    ]);
  });

  it("holds nothing on a dry run, or for a refusal the owner's card does not name", () => {
    const { deps, events } = recordingDeps();
    holdFreshnessRefusal({ deps, draftId: DRAFT_ID, dryRun: true, error: MOVED, home: "/unused" });
    const invalid = ReleaseFreshnessErrors.watermarkInvalid({ draftId: DRAFT_ID, tsIso: "nope" });
    holdFreshnessRefusal({ deps, draftId: DRAFT_ID, dryRun: false, error: invalid, home: "/unused" });

    expect(events).toEqual([]);
  });
});

describe("holdSendThrow", () => {
  const throwing = (): Promise<number> => Promise.reject(new Error("conversations.info: ratelimited"));

  it("holds the row slack-refused when the send throws, and still rethrows", async () => {
    const { deps, events } = recordingDeps();
    const run = holdSendThrow({
      deps,
      draft: { id: DRAFT_ID },
      drip: { dryRun: false, home: "/unused" },
      send: throwing,
    });

    await expect(run).rejects.toThrow("conversations.info: ratelimited");
    expect(events).toEqual([
      {
        id: DRAFT_ID,
        kind: "held",
        reason: "slack-refused",
        tsIso: expect.any(String),
        why: "the send threw before Slack confirmed it: conversations.info: ratelimited",
      },
    ]);
  });

  it("holds nothing on a dry run's throw or on a send that returned", async () => {
    const { deps, events } = recordingDeps();
    const dry = holdSendThrow({
      deps,
      draft: { id: DRAFT_ID },
      drip: { dryRun: true, home: "/unused" },
      send: throwing,
    });
    await expect(dry).rejects.toThrow("ratelimited");
    const sent = await holdSendThrow({
      deps,
      draft: { id: DRAFT_ID },
      drip: { dryRun: false, home: "/unused" },
      send: () => Promise.resolve(0),
    });

    expect(sent).toBe(0);
    expect(events).toEqual([]);
  });
});

/**
 * Registering a reply-less root the window sees once, so a tag posted into it after it scrolls out of every
 * later window is still found by the background phase.
 */
import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import type { RecoveryWindow } from "../../../../../live/listen/recoverSchedule.js";
import { recoverWorkspace } from "../../../../../live/listen/recoverSweep.js";
import { classificationFor, tagRow } from "./fixtures.js";

describe("recoverWorkspace — root registration", () => {
  /** The incident shape: the root is the BOT's own post and carries no replies when the window sees it. */
  const ROOT = "1786400000.000100";
  /** The window that SEES the root — the only window that ever will. */
  const FIRST_WINDOW: RecoveryWindow = {
    latestExclusiveTs: "1786400100.000000",
    oldestExclusiveTs: "1786399000.000000",
    sinceIso: "2026-08-10T00:00:00.000Z",
    untilIso: "2026-08-10T00:01:40.000Z",
  };
  /** A later window the root has already scrolled out of — where the tag actually lands. */
  const LATER_WINDOW: RecoveryWindow = {
    latestExclusiveTs: "1786622400.000000",
    oldestExclusiveTs: "1786622000.000000",
    sinceIso: "2026-08-12T15:53:20.000Z",
    untilIso: "2026-08-13T12:00:00.000Z",
  };

  it("registers a reply-less, never-read root so a LATER sweep still finds the tag posted into it", async () => {
    const TAG = "1786622100.000200";
    const seedApi: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [{ text: "fresh batch of vulnerability-fix PRs", ts: ROOT, user: "U_BOT" }] }),
      replies: async () => ({ messages: [] }),
    };

    const seeded = await recoverWorkspace({
      api: seedApi,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: {},
      window: FIRST_WINDOW,
    });

    expect(seeded.threadCheckpoints[`C1:${ROOT}`]?.cursorTs).toBe(ROOT);

    const laterApi: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [] }),
      replies: async () => ({ messages: [{ ts: ROOT, user: "U_BOT" }, tagRow({ ts: TAG })] }),
    };

    const later = await recoverWorkspace({
      api: laterApi,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: seeded.threadCheckpoints,
      window: LATER_WINDOW,
    });

    expect(later.candidates.map((c) => c.messageTs)).toEqual([TAG]);
    expect(later.threadCheckpoints[`C1:${ROOT}`]?.cursorTs).toBe(TAG);
  });

  it("finds nothing in that later sweep when the root was never registered — the defect, kept falsifiable", async () => {
    const TAG = "1786622100.000200";
    const laterApi: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [] }),
      replies: async () => ({ messages: [{ ts: ROOT, user: "U_BOT" }, tagRow({ ts: TAG })] }),
    };

    const later = await recoverWorkspace({
      api: laterApi,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: {},
      window: LATER_WINDOW,
    });

    expect(later.candidates).toEqual([]);
  });

  it("never downgrades a checkpoint the inventory already holds for that root", async () => {
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [{ text: "no tag", ts: ROOT, user: "U_BOT" }] }),
      replies: async () => ({ messages: [] }),
    };

    const result = await recoverWorkspace({
      api,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: {
        [`C1:${ROOT}`]: { cursorTs: "1786400099.000000", lastCheckedAtIso: "2026-08-10T00:00:00.000Z" },
      },
      window: FIRST_WINDOW,
    });

    expect(result.threadCheckpoints[`C1:${ROOT}`]?.cursorTs).toBe("1786400099.000000");
  });
});

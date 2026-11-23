/**
 * Settling every already-captured, unresolved ask a newly-suppressed conversation currently has. A temp home
 * has no Slack bot token, so every case here exercises the SELECTION logic (which asks in the channel are
 * unresolved) through the "no token configured" report path, rather than a live Slack call — the same
 * boundary `ignore.test.ts` uses for the exact-ask sibling.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { settleIgnoredConversationIndicators } from "../../../../../cli/commands/turn/ignoreConversationIndicators.js";
import type { AppendableAskLifecycleEvent } from "../../../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent } from "../../../../../live/ask/store.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-ignore-conversation-indicators-"));
  fixtureDirs.push(dir);
  return dir;
}

function capturedEvent({ channel, messageTs }: { channel: string; messageTs: string }): AppendableAskLifecycleEvent {
  return {
    channel,
    kind: "captured",
    messageTs,
    surface: "channel",
    threadTs: messageTs,
    tsIso: "2026-08-31T22:00:00.000Z",
    userId: "U_ASKER",
  };
}

function answeredEvent({ channel, messageTs }: { channel: string; messageTs: string }): AppendableAskLifecycleEvent {
  return {
    answerTs: `${messageTs}9`,
    channel,
    kind: "answered",
    messageTs,
    threadTs: messageTs,
    tsIso: "2026-08-31T22:05:00.000Z",
  };
}

describe("settleIgnoredConversationIndicators", () => {
  it("reports nothing when the channel has no ask-lifecycle entries at all", async () => {
    const home = tempHome();
    const reports: string[] = [];

    await settleIgnoredConversationIndicators({
      channel: "C1",
      home,
      reason: "every tag here is ignorable",
      report: ({ failure }) => reports.push(failure),
    });

    expect(reports).toEqual([]);
  });

  it("reports nothing when every ask in the channel already reached a terminal event", async () => {
    const home = tempHome();
    appendAskLifecycleEvent({ event: capturedEvent({ channel: "C1", messageTs: "1.1" }), home });
    appendAskLifecycleEvent({ event: answeredEvent({ channel: "C1", messageTs: "1.1" }), home });
    const reports: string[] = [];

    await settleIgnoredConversationIndicators({
      channel: "C1",
      home,
      reason: "every tag here is ignorable",
      report: ({ failure }) => reports.push(failure),
    });

    expect(reports).toEqual([]);
  });

  it("reports one no-token failure per unresolved ask this channel currently has", async () => {
    const home = tempHome();
    appendAskLifecycleEvent({ event: capturedEvent({ channel: "C1", messageTs: "1.1" }), home });
    appendAskLifecycleEvent({ event: capturedEvent({ channel: "C1", messageTs: "1.2" }), home });
    const reports: string[] = [];

    await settleIgnoredConversationIndicators({
      channel: "C1",
      env: {},
      home,
      reason: "every tag here is ignorable",
      report: ({ failure }) => reports.push(failure),
    });

    expect(reports).toEqual(["could not settle 2 already-captured ask(s) — no Slack bot token is configured"]);
  });

  it("never counts an unresolved ask in a DIFFERENT channel", async () => {
    const home = tempHome();
    appendAskLifecycleEvent({ event: capturedEvent({ channel: "C_OTHER", messageTs: "1.1" }), home });
    const reports: string[] = [];

    await settleIgnoredConversationIndicators({
      channel: "C1",
      home,
      reason: "every tag here is ignorable",
      report: ({ failure }) => reports.push(failure),
    });

    expect(reports).toEqual([]);
  });
});

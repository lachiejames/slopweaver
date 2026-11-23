/**
 * The shared capture-time UX composer — the individual wrappers (`withIgnoreCheck`, `withCapturedLifecycle`,
 * etc.) already have thorough behavioral coverage under `cli/commands/listen/run/` (whose tests import them
 * via re-export, so that coverage still exercises these real functions). This file covers what only the
 * COMPOSED order can prove: the five steps run in the documented sequence, and an ignored ask short-circuits
 * before any of the rest.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ok } from "../../../../lib/result.js";
import { appendIgnoredConversation } from "../../../../live/ask/ignoredConversationStore.js";
import { appendIgnoredAsk } from "../../../../live/ask/ignoreStore.js";
import {
  type CapturedChecklistDeps,
  type CaptureReactionDeps,
  capturedMentionHandler,
} from "../../../../live/listen/capture.js";
import type { Mention } from "../../../../live/listen/mention.js";
import { CARD_LINE_CAP } from "../../../../live/turn/progressCard.js";
import type { TodoStep } from "../../../../outbound/assistant/todoBlock.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const MENTION: Mention = {
  channel: "C_BOT",
  messageTs: "1785114398.557099",
  surface: "channel",
  text: "what are my open PRs?",
  threadTs: "1785114000.000100",
  userId: "U_ASKER",
};

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-capture-composer-"));
  fixtureDirs.push(home);
  return home;
}

function fixture({ home }: { home: string }): {
  readonly calls: string[];
  readonly sink: Mention[];
  readonly postedSteps: (readonly TodoStep[])[];
  readonly handler: (mention: Mention) => Promise<void>;
} {
  const calls: string[] = [];
  const sink: Mention[] = [];
  const postedSteps: (readonly TodoStep[])[] = [];
  const lifecycle = ["hourglass_flowing_sand", "eyes", "white_check_mark", "warning"];
  const reaction: CaptureReactionDeps = {
    addReaction: async () => {
      calls.push("reaction");
      return true;
    },
    emoji: "eyes",
    lifecycle,
    log: () => {},
    removeReaction: async ({ name }) => {
      calls.push(`retire:${name}`);
      return true;
    },
  };
  const checklist: CapturedChecklistDeps = {
    log: () => {},
    mintTurnId: () => "turn-1",
    postChecklist: async ({ steps }) => {
      calls.push("checklist");
      postedSteps.push(steps);
      return { channel: "C_BOT", ts: "1785114398.000900" };
    },
    setStatus: async () => {
      calls.push("status");
      return ok(undefined);
    },
  };
  const handler = capturedMentionHandler({
    checklist,
    lifecycle: { home, log: () => {} },
    reaction,
    sink: async (mention) => {
      calls.push("sink");
      sink.push(mention);
    },
  });
  return { calls, handler, postedSteps, sink };
}

describe("capturedMentionHandler", () => {
  it("runs ignore-check, reaction, checklist/status, then the sink, in that order", async () => {
    const { calls, handler, sink } = fixture({ home: tempHome() });

    await handler(MENTION);

    expect(calls).toEqual([
      "retire:hourglass_flowing_sand",
      "retire:white_check_mark",
      "retire:warning",
      "reaction",
      "checklist",
      "status",
      "sink",
    ]);
    expect(sink[0]?.started).toEqual({ turnId: "turn-1", workingTs: "1785114398.000900" });
  });

  it("drops a permanently-ignored ask before ANY other step runs", async () => {
    const home = tempHome();
    appendIgnoredAsk({
      entry: {
        channel: MENTION.channel,
        ignoredAtIso: "2026-08-12T00:00:00.000Z",
        messageTs: MENTION.messageTs,
        reason: "not worth answering again",
        schemaVersion: 1,
      },
      home,
    });
    const { calls, handler } = fixture({ home });

    await handler(MENTION);

    expect(calls).toEqual([]);
  });

  /**
   * MEASURED DEFECT (a report on a stuck-turn thread): the capture-time checklist
   * built step 0's detail from the raw tag text with no cap and no addressing strip, so a long tag rode
   * straight into the FIRST frame a public card ever shows — before `turn brief`/`dispatch` ever runs the
   * `progressChecklistSteps` clamp this same PR already hardened.
   */
  it("clamps a long tag's text to the card cap, rather than quoting it whole", async () => {
    const home = tempHome();
    const long = "why did the deploy fail? ".repeat(20);
    const { handler, postedSteps } = fixture({ home });

    await handler({ ...MENTION, text: long });

    const detail = postedSteps[0]![0]!.detail!;
    expect(detail.length).toBeLessThanOrEqual(CARD_LINE_CAP);
    expect(long.length).toBeGreaterThan(CARD_LINE_CAP);
  });

  it("strips the asker's own addressing prefix from step 0's detail, same as the routed checklist does", async () => {
    const home = tempHome();
    const { handler, postedSteps } = fixture({ home });

    await handler({ ...MENTION, text: "@(U0BOT) which of my open PRs are waiting on someone else?" });

    expect(postedSteps[0]![0]!.detail).toBe('"which of my open PRs are waiting on someone else?"');
  });

  it("drops a tag in a permanently-ignored CONVERSATION before ANY other step runs — a no-op at capture", async () => {
    const home = tempHome();
    appendIgnoredConversation({
      entry: {
        channel: MENTION.channel,
        ignoredAtIso: "2026-08-31T22:40:00.000Z",
        kind: "ignore",
        reason: "every tag here is ignorable",
        schemaVersion: 1,
      },
      home,
    });
    const { calls, handler } = fixture({ home });

    await handler(MENTION);

    expect(calls).toEqual([]);
  });

  it("does not drop a tag in a DIFFERENT, non-ignored conversation", async () => {
    const home = tempHome();
    appendIgnoredConversation({
      entry: {
        channel: "C_UNRELATED",
        ignoredAtIso: "2026-08-31T22:40:00.000Z",
        kind: "ignore",
        reason: "n/a",
        schemaVersion: 1,
      },
      home,
    });
    const { calls, handler } = fixture({ home });

    await handler(MENTION);

    expect(calls).toContain("sink");
  });
});

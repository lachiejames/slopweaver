/**
 * The bot's own threads, registered with recovery off the placement journal: which settled posts register, under
 * which key, and from which cursor.
 */
import { describe, expect, it } from "vitest";

import { OWN_THREAD_LOOKBACK_DAYS, ownThreadRegistrations } from "../../../../live/listen/recoverOwnThreads.js";
import type { PlacementSettled } from "../../../../live/slack/placementJournal.js";

/** Five in the morning UTC on a fixed day as a Slack ts — the sweep's clock. */
const NOW = "1791090000.000000";

/** A settled post under `root` at `ts` — the bot's, unless `asOwner`. */
function settled({
  asOwner = false,
  root,
  ts,
}: {
  asOwner?: boolean;
  root: string | undefined;
  ts: string;
}): PlacementSettled {
  return {
    ...(asOwner ? {} : { botId: "B0BOT" }),
    final: { channel: "C0ENG", ts },
    intended: { channel: "C0ENG", threadTs: root },
    kind: "placement-settled",
    outcome: "verified",
    schemaVersion: 1,
    surface: "postAssistantMessage",
    threadRoot: root,
    tsIso: "2026-10-04T04:00:00.000Z",
    userId: "U0BOT",
  };
}

describe("ownThreadRegistrations", () => {
  it("registers each thread the bot answered in, cursored at its own FIRST message there, so a reply between two of its posts is not jumped", () => {
    const rows = [
      settled({ root: "1791080000.000100", ts: "1791080100.000100" }),
      settled({ root: "1791080000.000100", ts: "1791085000.000100" }),
      settled({ root: "1791070000.000100", ts: "1791070000.000100" }),
    ];
    expect(ownThreadRegistrations({ nowTs: NOW, rows })).toEqual({
      "C0ENG:1791070000.000100": { cursorTs: "1791070000.000100" },
      "C0ENG:1791080000.000100": { cursorTs: "1791080100.000100" },
    });
  });

  it("skips a post as the owner, one the read-back never saw, one past the look-back, and one at or after the sweep's own clock", () => {
    const tooOld = String(1791090000 - OWN_THREAD_LOOKBACK_DAYS * 24 * 60 * 60 - 1);
    const atCutoff = String(1791090000 - OWN_THREAD_LOOKBACK_DAYS * 24 * 60 * 60);
    const rows = [
      settled({ asOwner: true, root: "1791080000.000100", ts: "1791080100.000100" }),
      settled({ root: undefined, ts: "1791080200.000100" }),
      settled({ root: `${tooOld}.000100`, ts: `${tooOld}.000100` }),
      settled({ root: `${atCutoff}.000000`, ts: `${atCutoff}.000000` }),
      settled({ root: NOW, ts: NOW }),
      settled({ root: "1791090001.000000", ts: "1791090001.000000" }),
    ];
    expect(ownThreadRegistrations({ nowTs: NOW, rows })).toEqual({});
  });

  it("cursors a thread at the bot's first post even when that post is older than the look-back", () => {
    const beforeWindow = `${String(1791090000 - OWN_THREAD_LOOKBACK_DAYS * 24 * 60 * 60 - 1)}.000100`;
    const rows = [
      settled({ root: "1789800000.000100", ts: beforeWindow }),
      settled({ root: "1789800000.000100", ts: "1790000100.000100" }),
    ];
    expect(ownThreadRegistrations({ nowTs: NOW, rows })).toEqual({
      "C0ENG:1789800000.000100": { cursorTs: beforeWindow },
    });
  });

  it("skips a ts the durable state would refuse, rather than poisoning it", () => {
    expect(
      ownThreadRegistrations({ nowTs: NOW, rows: [settled({ root: "1791080000", ts: "1791080100.000100" })] }),
    ).toEqual({});
  });
});

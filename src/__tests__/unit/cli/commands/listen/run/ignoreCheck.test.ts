/** `withIgnoreCheck` drops a permanently-ignored ask before the wrapped handler runs, and only that exact ask. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { withIgnoreCheck } from "../../../../../../cli/commands/listen/run.js";
import { appendIgnoredAsk } from "../../../../../../live/ask/ignoreStore.js";
import type { Mention } from "../../../../../../live/listen/mention.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("withIgnoreCheck", () => {
  const MENTION: Mention = {
    channel: "C_BOT",
    messageTs: "1785114398.557099",
    surface: "channel",
    text: "what are my open PRs?",
    threadTs: "1785114000.000100",
    userId: "U_ASKER",
  };

  function tempHome(): string {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-listen-ignore-"));
    fixtureDirs.push(dir);
    return dir;
  }

  it("drops a permanently-ignored ask before the wrapped handler ever runs", async () => {
    const home = tempHome();
    appendIgnoredAsk({
      entry: {
        channel: MENTION.channel,
        ignoredAtIso: "2026-08-12T00:00:00.000Z",
        messageTs: MENTION.messageTs,
        reason: "the owner asked not to be bothered about this one again",
        schemaVersion: 1,
      },
      home,
    });
    const lines: string[] = [];
    let handled = 0;
    await withIgnoreCheck({
      deps: { home, log: ({ line }) => lines.push(line) },
      handler: async () => {
        handled++;
      },
    })(MENTION);
    expect(handled).toBe(0);
    expect(lines).toEqual(["dropping a permanently-ignored ask — C_BOT/1785114398.557099"]);
  });

  it("calls the wrapped handler for an ask the registry never named", async () => {
    const home = tempHome();
    let handled = 0;
    await withIgnoreCheck({
      deps: { home, log: () => {} },
      handler: async () => {
        handled++;
      },
    })(MENTION);
    expect(handled).toBe(1);
  });

  it("never confuses one ask for another sharing the same thread but a different messageTs", async () => {
    const home = tempHome();
    appendIgnoredAsk({
      entry: {
        channel: MENTION.channel,
        ignoredAtIso: "2026-08-12T00:00:00.000Z",
        messageTs: "9999999999.000000",
        reason: "a different ask entirely",
        schemaVersion: 1,
      },
      home,
    });
    let handled = 0;
    await withIgnoreCheck({
      deps: { home, log: () => {} },
      handler: async () => {
        handled++;
      },
    })(MENTION);
    expect(handled).toBe(1);
  });
});

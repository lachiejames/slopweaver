/** `withCapturedLifecycle` journals a captured ask before the wrapped handler runs, and never blocks it. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { withCapturedLifecycle } from "../../../../../../cli/commands/listen/run.js";
import { readAskLifecycleText } from "../../../../../../live/ask/store.js";
import type { Mention } from "../../../../../../live/listen/mention.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("withCapturedLifecycle", () => {
  const MENTION: Mention = {
    channel: "C_BOT",
    messageTs: "1785114398.557099",
    surface: "channel",
    text: "what are my open PRs?",
    threadTs: "1785114000.000100",
    userId: "U_ASKER",
  };

  function tempHome(): string {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-listen-lifecycle-"));
    fixtureDirs.push(dir);
    return dir;
  }

  it("appends a captured event carrying this exact ask's identity, before the wrapped handler runs", async () => {
    const home = tempHome();
    let logAtHandlerTime = "";
    await withCapturedLifecycle({
      deps: { home, log: () => {} },
      handler: async () => {
        logAtHandlerTime = readAskLifecycleText({ home });
      },
    })(MENTION);
    // Read INSIDE the wrapped handler, not after — proving the append landed before the handler ran, not
    // merely before this assertion.
    expect(logAtHandlerTime.trim().length).toBeGreaterThan(0);
    const logged = JSON.parse(logAtHandlerTime.trim());
    expect(logged.kind).toBe("captured");
    expect(logged.channel).toBe("C_BOT");
    expect(logged.messageTs).toBe("1785114398.557099");
    expect(logged.userId).toBe("U_ASKER");
    expect(logged.surface).toBe("channel");
  });

  it("still calls the handler when the append fails — a full disk must not block capture", async () => {
    // A home path that cannot be created as a directory (its parent is a file, not a directory) makes the
    // real `mkdirSync` inside `appendAskLifecycleEvent` throw — the exact failure mode this wrapper exists
    // to survive, exercised for real rather than through an injected fake.
    const dir = tempHome();
    const blockedHome = join(dir, "not-a-directory-because-this-is-a-file", "deeper");
    writeFileSync(join(dir, "not-a-directory-because-this-is-a-file"), "x");
    const lines: string[] = [];
    let handled = 0;
    await withCapturedLifecycle({
      deps: { home: blockedHome, log: ({ line }) => lines.push(line) },
      handler: async () => {
        handled++;
      },
    })(MENTION);
    expect(handled).toBe(1);
    expect(lines[0]).toContain("could not append the captured ask-lifecycle event");
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { withChecklistPostedLifecycle } from "../../../../../../cli/commands/listen/run.js";
import { readAskLifecycleText } from "../../../../../../live/ask/store.js";
import type { Mention } from "../../../../../../live/listen/mention.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * The durable half of the checklist-freeze fix: `turn brief` can only recover a `started` ref it never
 * received on the command line if SOMETHING durably recorded it first. This is that something.
 */
describe("withChecklistPostedLifecycle", () => {
  const WITH_STARTED: Mention = {
    channel: "C_BOT",
    messageTs: "1785114398.557099",
    started: { turnId: "turn-1", workingTs: "1785114398.000900" },
    surface: "channel",
    text: "what are my open PRs?",
    threadTs: "1785114000.000100",
    userId: "U_ASKER",
  };
  const WITHOUT_STARTED: Mention = {
    channel: "C_BOT",
    messageTs: "1785114398.557099",
    surface: "channel",
    text: "what are my open PRs?",
    threadTs: "1785114000.000100",
    userId: "U_ASKER",
  };

  function tempHome(): string {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-listen-checklist-posted-"));
    fixtureDirs.push(dir);
    return dir;
  }

  it("appends a checklist-posted event carrying the turnId/workingTs, before the wrapped handler runs", async () => {
    const home = tempHome();
    let logAtHandlerTime = "";
    await withChecklistPostedLifecycle({
      deps: { home, log: () => {} },
      handler: async () => {
        logAtHandlerTime = readAskLifecycleText({ home });
      },
    })(WITH_STARTED);

    const logged = JSON.parse(logAtHandlerTime.trim());
    expect(logged.kind).toBe("checklist-posted");
    expect(logged.channel).toBe("C_BOT");
    expect(logged.messageTs).toBe("1785114398.557099");
    expect(logged.turnId).toBe("turn-1");
    expect(logged.workingTs).toBe("1785114398.000900");
  });

  it("appends nothing when the checklist was never posted — no `started` to record", async () => {
    const home = tempHome();
    let handled = 0;
    await withChecklistPostedLifecycle({
      deps: { home, log: () => {} },
      handler: async () => {
        handled++;
      },
    })(WITHOUT_STARTED);

    expect(handled).toBe(1);
    expect(readAskLifecycleText({ home })).toBe("");
  });

  it("still calls the handler when the append fails — a full disk must not block the turn", async () => {
    const dir = tempHome();
    const blockedHome = join(dir, "not-a-directory-because-this-is-a-file", "deeper");
    writeFileSync(join(dir, "not-a-directory-because-this-is-a-file"), "x");
    const lines: string[] = [];
    let handled = 0;
    await withChecklistPostedLifecycle({
      deps: { home: blockedHome, log: ({ line }) => lines.push(line) },
      handler: async () => {
        handled++;
      },
    })(WITH_STARTED);

    expect(handled).toBe(1);
    expect(lines[0]).toContain("could not append the checklist-posted ask-lifecycle event");
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSpawnRunEvents } from "../../../../../cli/commands/cmux/spawnPreflight.js";
import { appendRunEvent, runJournalPath } from "../../../../../handover/runStore.js";
import { err, ok } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "spawn-preflight-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("readSpawnRunEvents", () => {
  it("reads a doc nobody has started as an empty journal", () => {
    expect(readSpawnRunEvents({ home, slug: "a-doc" })).toEqual(ok([]));
  });

  it("refuses a journal with an unreadable line, naming the line, rather than guessing start versus resume", () => {
    const runsDir = stateHomePaths({ home }).runs;
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(runJournalPath({ runsDir, slug: "a-doc" }), "{ not json\n");

    expect(readSpawnRunEvents({ home, slug: "a-doc" })).toEqual(
      err("a-doc's run journal has unreadable line(s) 1 — refusing to guess start versus resume"),
    );
  });

  it("answers the journal's one recorded event", () => {
    const runsDir = stateHomePaths({ home }).runs;
    appendRunEvent({
      event: { atIso: "2026-10-01T00:00:00.000Z", branch: "a-branch", docHash: "abc123", kind: "started" },
      runsDir,
      slug: "a-doc",
    });

    expect(readSpawnRunEvents({ home, slug: "a-doc" })).toEqual(
      ok([{ atIso: "2026-10-01T00:00:00.000Z", branch: "a-branch", docHash: "abc123", kind: "started" }]),
    );
  });
});

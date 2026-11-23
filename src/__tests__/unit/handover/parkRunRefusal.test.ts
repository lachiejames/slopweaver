/**
 * `handover park` refuses a run that is not waiting on a recorded question, before it touches cmux — over a real
 * board and journal in a throwaway home.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandoverPark } from "../../../cli/commands/handover/parkRun.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { appendRunEvent, readRunJournal } from "../../../handover/runStore.js";
import { unwrap } from "../../../lib/result.js";

describe("runHandoverPark", () => {
  let home: string;
  let runsDir: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "park-refusal-"));
    runsDir = join(home, "runs");
    mkdirSync(join(home, "handovers"), { recursive: true });
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(
      join(home, "handovers", "park-me.md"),
      ["---", "slug: park-me", "summary: a run", "status: in-progress", "---", "", "# Park me", ""].join("\n"),
    );
    appendRunEvent({
      event: { atIso: "2026-10-09T11:00:00.000Z", branch: "park-me", docHash: "hash", kind: "started" },
      runsDir,
      slug: "park-me",
    });
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a run with no open question and journals nothing", async () => {
    const code = await runHandoverPark(["node", "cli", "handover", "park", "park-me", "--home", home]);
    expect(code).toBe(EXIT_ERROR);
    expect(unwrap(readRunJournal({ runsDir, slug: "park-me" })).events.map((event) => event.kind)).toEqual(["started"]);
  });

  it("refuses a malformed or doubled wake as usage, before it reads the board", async () => {
    const codes = await Promise.all(
      [
        ["--wake-at", "soon"],
        ["--wake-on-checks", "acme-admin#9877"],
        ["--wake-at", "2026-10-15T03:13:00Z", "--wake-on-checks", "o/r#1"],
      ].map((flags) =>
        runHandoverPark(["node", "cli", "handover", "park", "park-me", "--home", join(home, "absent"), ...flags]),
      ),
    );
    expect(codes).toEqual([EXIT_USAGE, EXIT_USAGE, EXIT_USAGE]);
  });

  it("refuses a closed run even with a wake named, and journals nothing more", async () => {
    appendRunEvent({
      event: { atIso: "2026-10-09T12:00:00.000Z", kind: "abandoned", why: "superseded" },
      runsDir,
      slug: "park-me",
    });
    const code = await runHandoverPark([
      "node",
      "cli",
      "handover",
      "park",
      "park-me",
      "--home",
      home,
      "--wake-at",
      "2026-10-15T03:13:00Z",
    ]);
    expect(code).toBe(EXIT_ERROR);
    expect(unwrap(readRunJournal({ runsDir, slug: "park-me" })).events.map((event) => event.kind)).toEqual([
      "started",
      "abandoned",
    ]);
  });
});

/**
 * A Codex chair named by a pin record whose instant will not parse is still named in `profile words`' gaps, as
 * unread, so the answer never reads as a chair with zero turns.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readSupervisorWords } from "../../../profile/supervisorWords.js";
import { stateHomePaths } from "../../../stateHome.js";
import { CODEX_CHAIR_UNREAD } from "../../../supervisor/chain.js";

const CODEX_ID = "019a1a98-9b15-7482-8000-000000000001";

const scratch: string[] = [];

afterEach(() => {
  scratch.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A fresh temp directory, removed after the test. */
function temp({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

describe("readSupervisorWords over a Codex pin with no readable instant", () => {
  it("names the Codex chair as unread beside the unreadable instant", () => {
    const home = temp({ prefix: "words-codex-pin-" });
    const path = stateHomePaths({ home }).supervisorPinJson;
    mkdirSync(join(path, ".."), { recursive: true });
    const record = {
      pinnedAtIso: "not-an-instant",
      session: { host: "codex", id: CODEX_ID },
      workspaceId: "ws-1",
      workspaceRef: "workspace:1",
    };
    writeFileSync(path, JSON.stringify(record), "utf8");

    const read = readSupervisorWords({
      claudeHome: temp({ prefix: "words-claude-" }),
      home,
      sinceIso: "2026-09-04T00:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect(read.problems).toEqual([
      `the supervisor pin record at ${path} carries no readable pinnedAtIso`,
      `chair codex:${CODEX_ID} would not read: ${CODEX_CHAIR_UNREAD}`,
      "with the pin record unreadable, who holds the pin now is unknown, so the journal's last chair was not read from its last link on",
      "no supervisor chain is recorded, so no supervisor turn was read — `slopweaver supervisor chain --rescan`",
    ]);
  });
});

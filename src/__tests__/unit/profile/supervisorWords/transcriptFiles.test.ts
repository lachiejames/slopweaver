/**
 * How `readSupervisorWords` finds a chair's transcript file: a project directory it could not look inside, two
 * copies of one transcript, and a transcript that is a FIFO each leave the chair named as unread, never guessed at
 * or blocked on.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readSupervisorWords } from "../../../../profile/supervisorWords.js";
import { A, A_FIRST, claudeHomeWith, pin, seat, temp, userLine, useTempDirs } from "./harness.js";

useTempDirs();

describe("readSupervisorWords", () => {
  // A project directory that will not say whether it holds a copy leaves uniqueness unproven.
  it("names a chair whose transcript lookup met a project directory it could not look inside", () => {
    const home = temp({ prefix: "words-home-" });
    seat({ home, links: [pin({ at: "2026-09-04T22:00:00.000Z", session: A })] });
    const claudeHome = claudeHomeWith({
      transcripts: {
        [A]: [userLine({ text: "the readable copy", timestamp: "2026-09-04T23:00:00.000Z", uuid: A_FIRST })],
      },
    });
    const shut = join(claudeHome, "projects", "-a-shut-directory");
    mkdirSync(shut, { recursive: true });
    chmodSync(shut, 0o000);
    try {
      const read = readSupervisorWords({
        claudeHome,
        home,
        sinceIso: "2026-09-04T22:00:00.000Z",
        untilIso: "2026-09-06T00:00:00.000Z",
      });

      expect([read.turns, read.problems.length]).toEqual([[], 1]);
      expect(read.problems[0]).toContain(`chair ${A} would not read: ${join(shut, `${A}.jsonl`)} could not be read`);
    } finally {
      chmodSync(shut, 0o700);
    }
  });

  // Which of two same-named transcripts is the session's record is not directory order's to decide.
  it("names a chair whose transcript two project directories both hold, listing neither copy", () => {
    const home = temp({ prefix: "words-home-" });
    seat({ home, links: [pin({ at: "2026-09-04T22:00:00.000Z", session: A })] });
    const claudeHome = claudeHomeWith({
      transcripts: {
        [A]: [userLine({ text: "the first copy", timestamp: "2026-09-04T23:00:00.000Z", uuid: A_FIRST })],
      },
    });
    const copy = join(claudeHome, "projects", "-a-restored-copy");
    mkdirSync(copy, { recursive: true });
    writeFileSync(
      join(copy, `${A}.jsonl`),
      `${userLine({ text: "the other copy", timestamp: "2026-09-04T23:00:00.000Z", uuid: A_FIRST })}\n`,
      "utf8",
    );

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T22:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect([read.turns, read.problems.length]).toEqual([[], 1]);
    expect(read.problems[0]).toContain(`chair ${A} would not read: 2 transcripts are named ${A}.jsonl`);
  });

  it("names a chair transcript that is a FIFO as unread, never blocking on it", () => {
    const home = temp({ prefix: "words-home-" });
    seat({ home, links: [pin({ at: "2026-09-04T22:00:00.000Z", session: A })] });
    const claudeHome = temp({ prefix: "words-claude-" });
    mkdirSync(join(claudeHome, "projects", "-project"), { recursive: true });
    const path = join(claudeHome, "projects", "-project", `${A}.jsonl`);
    execFileSync("mkfifo", [path]);

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T22:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect(read.turns).toEqual([]);
    expect(read.problems.length).toBe(1);
    expect(read.problems[0]).toContain(`chair ${A} would not read`);
    expect(read.problems[0]).toContain("not a regular file");
  });
});

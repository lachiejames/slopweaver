/**
 * The intake-mark ledger on disk: an absent ledger is no marks, a written one round-trips, and a present one
 * that cannot be read is an error rather than an empty list a sweep would read as "nothing cleared".
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { IntakeMark } from "../../../supervisor/intake.js";
import { appendIntakeMark, boardSlugLookup, readIntakeMarks } from "../../../supervisor/intakeStore.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A throwaway state home, removed after the test that minted it. */
function stateHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-intake-marks-"));
  homes.push(home);
  return home;
}

const MARK: IntakeMark = {
  byClaudeSessionId: "a0000075-0000-4000-8000-000000000082",
  kind: "no-ask",
  markedAtIso: "2026-09-24T00:00:00.000Z",
  pointer: "talk:a0000017-0000-4000-8000-000000000019",
  witness: "a steer the chair already acted on",
};

describe("readIntakeMarks", () => {
  it("reads an absent ledger as no marks", () => {
    expect(unwrap(readIntakeMarks({ home: stateHome() }))).toEqual([]);
  });

  it("round-trips a mark it appended", () => {
    const home = stateHome();
    appendIntakeMark({ home, mark: MARK });

    expect(unwrap(readIntakeMarks({ home })).map((mark) => mark.pointer)).toEqual([MARK.pointer]);
  });

  it("reports a present ledger it cannot read as an error, never as no marks", () => {
    const home = stateHome();
    mkdirSync(stateHomePaths({ home }).intakeMarksJsonl, { recursive: true });

    expect(unwrapErr(readIntakeMarks({ home })).message).toContain("could not be read");
    // Refused on its file type before any open — a FIFO in the same place would otherwise block the read.
    expect(unwrapErr(readIntakeMarks({ home })).message).toContain("not a regular file");
  });

  it("reports a ledger that is a symlink loop as an error, though existsSync would call it absent", () => {
    const home = stateHome();
    const path = stateHomePaths({ home }).intakeMarksJsonl;
    mkdirSync(join(path, ".."), { recursive: true });
    symlinkSync("intake-marks.jsonl", path);

    expect(unwrapErr(readIntakeMarks({ home })).message).toContain("ELOOP");
  });

  it("reports a dangling ledger symlink as an error, though its stat answers ENOENT", () => {
    const home = stateHome();
    const path = stateHomePaths({ home }).intakeMarksJsonl;
    mkdirSync(join(path, ".."), { recursive: true });
    symlinkSync("missing-ledger.jsonl", path);

    expect(unwrapErr(readIntakeMarks({ home })).message).toContain("dangling symlink");
  });
});

describe("boardSlugLookup", () => {
  /** A minimal row declaring `slug`, written under whatever file name the caller gives it. */
  const row = ({ slug }: { slug: string }): string =>
    `---\nslug: ${slug}\nkind: ask\nsummary: x\nstatus: ready\naskedIso: 2026-09-22T12:00:00.000Z\n---\n\n# x\n`;

  it("finds a row by its own file, live or archived, and an archived row filed under another name", () => {
    const handoverDir = join(stateHome(), "handovers");
    mkdirSync(join(handoverDir, "archive"), { recursive: true });
    writeFileSync(join(handoverDir, "the-ask.md"), row({ slug: "the-ask" }));
    writeFileSync(join(handoverDir, "archive", "closed-ask.md"), row({ slug: "closed-ask" }));
    writeFileSync(join(handoverDir, "archive", "legacy-name.md"), row({ slug: "renamed-ask" }));
    writeFileSync(join(handoverDir, "linked-target.txt"), row({ slug: "linked-ask" }));
    symlinkSync("linked-target.txt", join(handoverDir, "another-name.md"));
    // Past the board's 2 MiB read limit, so the board itself would never read this row.
    writeFileSync(join(handoverDir, "oversize.md"), `${row({ slug: "oversize-row" })}${"x".repeat(2 * 1024 * 1024)}`);
    const lookup = boardSlugLookup({ handoverDir });
    const asked = ["the-ask", "closed-ask", "renamed-ask", "linked-ask", "legacy-name", "oversize-row", "no-such-row"];

    expect(asked.map((slug) => lookup.has(slug))).toEqual([true, true, true, true, false, false, false]);
  });

  it("takes a doc declaring no slug as its file name's row, exactly as the board reads it", () => {
    const handoverDir = join(stateHome(), "handovers");
    mkdirSync(handoverDir, { recursive: true });
    writeFileSync(join(handoverDir, "ghost.md"), row({ slug: "ghost" }).replace("slug: ghost\n", ""));

    expect(boardSlugLookup({ handoverDir }).has("ghost")).toBe(true);
  });
});

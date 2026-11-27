/**
 * The takeover gate's read over real archive files in a temp home: a ruling a fresh `state-archive` carries into a
 * new file is the SAME ruling, not a new unread turn. Reproduces the case where the archive written by
 * `supervisor state-archive` re-addressed an older ruling and `cmux takeover` refused a chair already shown it.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  runSupervisorOwnerTurns,
  sessionOf,
  unreadOwnerTurns,
} from "../../../../../cli/commands/supervisor/ownerTurnsRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { rulingArchiveDir } from "../../../../../handover/archivedRulings.js";
import { sha256Text } from "../../../../../lib/hash.js";
import { unwrap } from "../../../../../lib/result.js";
import { appendOwnerTurnReceipts, readOwnerTurnReceipts } from "../../../../../supervisor/ownerTurnReceiptStore.js";
import { readOwnerTurnWindow } from "../../../../../supervisor/ownerTurnWindow.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const NOW_ISO = "2026-10-20T00:00:00.000Z";
const SESSION = "chair-335";
const RULING = "- RULING 12 Oct 10:08Z the one-pager set https://example.slack.com/archives/C1/p1";

/** A throwaway state home. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "owner-turns-archive-"));
  homes.push(home);
  return home;
}

/** Write one archived state-doc block carrying `lines` under its RULINGS heading, touched at `atIso`. */
function archive({ home, name, lines, atIso }: { home: string; name: string; lines: string[]; atIso: string }): string {
  const dir = rulingArchiveDir({ home });
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, ["# Archived block", "", "### RULINGS", "", ...lines, ""].join("\n"));
  const at = new Date(atIso);
  utimesSync(path, at, at);
  return path;
}

/** Record that this chair was shown the ruling at `path`'s row, as the verb writes it: with the hash of its words. */
function receipt({ home, path, line }: { home: string; path: string; line: number }): void {
  unwrap(
    appendOwnerTurnReceipts({
      home,
      receipts: [
        {
          bytes: RULING.length,
          pointer: `ruling:${path}#${String(line)}`,
          readAtIso: NOW_ISO,
          session: { host: "claude-code", id: SESSION },
          textSha256: sha256Text({ text: RULING }),
        },
      ],
    }),
  );
}

describe("the owner-turn gate over carried-forward archive rulings", () => {
  it("counts a ruling a new archive re-addressed as READ when the chair was shown it in an earlier file", () => {
    const home = freshHome();
    const earlier = archive({ atIso: "2026-10-19T12:46:00.000Z", home, lines: [RULING], name: "state-1246.md" });
    receipt({ home, line: 5, path: earlier });
    archive({
      atIso: "2026-10-19T23:46:00.000Z",
      home,
      lines: ["- an unanchored line", RULING],
      name: "state-2347.md",
    });

    const report = unreadOwnerTurns({ session: { host: "claude-code", id: SESSION }, days: 7, home, nowIso: NOW_ISO });

    expect(report.unread).toBe(0);
    expect(report.total).toBe(1);
  });

  it("still reads it when the receipted copy has aged out of the window and only the new copy is inside", () => {
    const home = freshHome();
    const old = archive({ atIso: "2026-10-01T00:00:00.000Z", home, lines: [RULING], name: "state-old.md" });
    receipt({ home, line: 5, path: old });
    archive({ atIso: "2026-10-19T23:46:00.000Z", home, lines: [RULING], name: "state-2347.md" });

    expect(
      unreadOwnerTurns({ session: { host: "claude-code", id: SESSION }, days: 7, home, nowIso: NOW_ISO }).unread,
    ).toBe(0);
  });

  it("shows a fresh chair each ruling ONCE however many archives carried it, and a new ruling as unread", () => {
    const home = freshHome();
    archive({ atIso: "2026-10-18T10:00:00.000Z", home, lines: [RULING], name: "state-a.md" });
    archive({ atIso: "2026-10-19T12:46:00.000Z", home, lines: [RULING], name: "state-b.md" });
    const newest = archive({
      atIso: "2026-10-19T23:46:00.000Z",
      home,
      lines: [RULING, "- RULING 19 Oct the Renovate closes https://example.slack.com/archives/C1/p2"],
      name: "state-c.md",
    });

    // No chain link is recorded, so no chair transcript is read and the state home stands in for Claude's.
    const window = readOwnerTurnWindow({ claudeHome: home, days: 7, home, nowIso: NOW_ISO });

    expect(window.turns.map((entry) => entry.pointer)).toEqual([
      `ruling:${join(rulingArchiveDir({ home }), "state-a.md")}#5`,
      `ruling:${newest}#6`,
    ]);
    expect(
      unreadOwnerTurns({ session: { host: "claude-code", id: SESSION }, days: 7, home, nowIso: NOW_ISO }).unread,
    ).toBe(2);
  });

  it("writes the hash of a printed ruling's words, so a copy archived AFTER the print, then edited, still reads", () => {
    const home = freshHome();
    archive({ atIso: "2026-10-19T12:46:00.000Z", home, lines: [RULING], name: "state-1246.md" });
    const printed = runSupervisorOwnerTurns([
      "node",
      "slopweaver",
      "supervisor",
      "owner-turns",
      "--home",
      home,
      "--session",
      SESSION,
      "--now",
      "2026-10-19T13:00:00.000Z",
    ]);
    archive({ atIso: "2026-10-20T10:46:00.000Z", home, lines: ["- an appended line", RULING], name: "state-2347.md" });

    expect(printed).toBe(EXIT_OK);
    expect(unwrap(readOwnerTurnReceipts({ home })).map((row) => row.textSha256)).toEqual([
      sha256Text({ text: RULING }),
    ]);
    expect(
      unreadOwnerTurns({ session: { host: "claude-code", id: SESSION }, days: 7, home, nowIso: NOW_ISO }).unread,
    ).toBe(0);
  });

  it("records a Codex thread's receipts under its host, never as the Claude session sharing its id", () => {
    const home = freshHome();
    archive({ atIso: "2026-10-19T12:46:00.000Z", home, lines: [RULING], name: "state-1246.md" });
    const printed = runSupervisorOwnerTurns([
      "node",
      "slopweaver",
      "supervisor",
      "owner-turns",
      "--home",
      home,
      "--session",
      `codex:${SESSION}`,
      "--now",
      "2026-10-19T13:00:00.000Z",
    ]);

    expect(printed).toBe(EXIT_OK);
    expect(unwrap(readOwnerTurnReceipts({ home })).map((row) => row.session)).toEqual([{ host: "codex", id: SESSION }]);
    expect(
      unreadOwnerTurns({ session: { host: "claude-code", id: SESSION }, days: 7, home, nowIso: NOW_ISO }).unread,
    ).toBe(1);
  });

  it("reads --session as a chain line prints it, and refuses one naming no session as the caller's mistake", () => {
    expect(
      ["chair-1", "codex:t-1", "claude-code:c-1", "explicit:x", "codex:../x"].map((flag) =>
        sessionOf({ env: {}, flag }),
      ),
    ).toStrictEqual([
      { host: "claude-code", id: "chair-1" },
      { host: "codex", id: "t-1" },
      { host: "claude-code", id: "c-1" },
      {
        exit: EXIT_USAGE,
        refusal:
          "supervisor owner-turns: --session explicit:x names no session — the form is <id> (a Claude Code session), claude-code:<id> or codex:<thread-id>",
      },
      {
        exit: EXIT_USAGE,
        refusal:
          "supervisor owner-turns: --session codex:../x names no session — the form is <id> (a Claude Code session), claude-code:<id> or codex:<thread-id>",
      },
    ]);
  });

  it("reads a CRLF copy and an LF copy of one ruling as the same words", () => {
    const home = freshHome();
    const crlf = archive({ atIso: "2026-10-19T12:46:00.000Z", home, lines: [RULING], name: "state-1246.md" });
    writeFileSync(crlf, ["# Archived block", "", "### RULINGS", "", RULING, ""].join("\r\n"));
    utimesSync(crlf, new Date("2026-10-19T12:46:00.000Z"), new Date("2026-10-19T12:46:00.000Z"));
    receipt({ home, line: 5, path: crlf });
    archive({ atIso: "2026-10-19T23:46:00.000Z", home, lines: [RULING], name: "state-2347.md" });

    const report = unreadOwnerTurns({ session: { host: "claude-code", id: SESSION }, days: 7, home, nowIso: NOW_ISO });

    expect(report.total).toBe(1);
    expect(report.unread).toBe(0);
  });

  it("reads a ruling row ended by a lone CR, mid-file or at its end, as the same words as its LF copy", () => {
    const home = freshHome();
    const loneCr = archive({ atIso: "2026-10-19T12:46:00.000Z", home, lines: [RULING], name: "state-1246.md" });
    writeFileSync(loneCr, `# Archived block\r\r### RULINGS\r\r${RULING}\r# Next\r`);
    utimesSync(loneCr, new Date("2026-10-19T12:46:00.000Z"), new Date("2026-10-19T12:46:00.000Z"));
    receipt({ home, line: 5, path: loneCr });
    archive({ atIso: "2026-10-19T23:46:00.000Z", home, lines: [RULING], name: "state-2347.md" });

    expect(
      unreadOwnerTurns({ session: { host: "claude-code", id: SESSION }, days: 7, home, nowIso: NOW_ISO }).unread,
    ).toBe(0);
  });

  it("shows a ruling again when its only receipt is LEGACY, carrying no hash, even on the very same pointer", () => {
    const home = freshHome();
    const rewritten = archive({ atIso: "2026-10-19T12:00:00.000Z", home, lines: [RULING], name: "state-1246.md" });
    unwrap(
      appendOwnerTurnReceipts({
        home,
        receipts: [
          {
            bytes: 1,
            pointer: `ruling:${rewritten}#5`,
            readAtIso: "2026-10-19T13:00:00.000Z",
            session: { host: "claude-code", id: SESSION },
          },
        ],
      }),
    );

    expect(
      unreadOwnerTurns({ session: { host: "claude-code", id: SESSION }, days: 7, home, nowIso: NOW_ISO }).unread,
    ).toBe(1);
  });

  it("refuses rather than counting short when an archive entry will not read, every other ruling read", () => {
    const home = freshHome();
    const earlier = archive({ atIso: "2026-10-19T12:46:00.000Z", home, lines: [RULING], name: "state-1246.md" });
    receipt({ home, line: 5, path: earlier });
    mkdirSync(join(rulingArchiveDir({ home }), "state-2347.md"));

    const report = unreadOwnerTurns({ session: { host: "claude-code", id: SESSION }, days: 7, home, nowIso: NOW_ISO });

    expect(report.unread).toBe(0);
    expect(report.unreadable).toBe("ruling archive: state-2347.md is not a regular file");
  });

  it("never lets another chair's receipt on those words count for this one", () => {
    const home = freshHome();
    const earlier = archive({ atIso: "2026-10-19T12:46:00.000Z", home, lines: [RULING], name: "state-1246.md" });
    unwrap(
      appendOwnerTurnReceipts({
        home,
        receipts: [
          {
            bytes: 1,
            pointer: `ruling:${earlier}#5`,
            readAtIso: NOW_ISO,
            session: { host: "claude-code", id: "another-chair" },
          },
        ],
      }),
    );
    archive({ atIso: "2026-10-19T23:46:00.000Z", home, lines: [RULING], name: "state-2347.md" });

    expect(
      unreadOwnerTurns({ session: { host: "claude-code", id: SESSION }, days: 7, home, nowIso: NOW_ISO }).unread,
    ).toBe(1);
  });
});

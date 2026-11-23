/**
 * `hasPositiveBootSignal` — rejecting a shell error, AND a not-yet-rendered launch, masquerading as a boot,
 * not just "did the screen change". The real banner substrings below are captured live against
 * `claude --plugin-dir …` (`Claude Code v2.1.231`) and `codex --no-alt-screen` (`OpenAI Codex (v0.145.0)`).
 */
import { describe, expect, it } from "vitest";

import {
  EXIT_SIGHTINGS_TO_FAIL,
  hasPositiveBootSignal,
  hasReadyPromptSignal,
  NO_EXIT_SIGHTINGS,
  newExitLine,
  newMissingConversationExit,
  nextExitSightings,
  readMissingConversation,
  readyPromptIsAssertable,
} from "../../../cmux/bootSignal.js";

const BEFORE = "$ ";
const MISSING_ID = "68f60302-1c1e-4a0e-9a57-0c1b1f2e3d4c";
/** A running Claude's live composer prompt: `❯` and a NON-BREAKING space, which no zsh theme draws. */
const COMPOSER = "❯ ";
const RULE = "─".repeat(40);

describe("hasPositiveBootSignal", () => {
  it("rejects an unchanged screen", () => {
    expect(hasPositiveBootSignal({ before: BEFORE, host: "claude-code", screen: BEFORE })).toBe(false);
  });

  it("rejects an empty screen", () => {
    expect(hasPositiveBootSignal({ before: BEFORE, host: "claude-code", screen: "" })).toBe(false);
  });

  it("rejects a whitespace-only screen", () => {
    expect(hasPositiveBootSignal({ before: BEFORE, host: "claude-code", screen: "   \n  " })).toBe(false);
  });

  it("accepts a screen carrying claude-code's real boot banner", () => {
    expect(
      hasPositiveBootSignal({ before: BEFORE, host: "claude-code", screen: "╭─── Claude Code v2.1.231 ───╮" }),
    ).toBe(true);
  });

  it("accepts a screen carrying codex's real boot banner", () => {
    expect(hasPositiveBootSignal({ before: BEFORE, host: "codex", screen: ">_ OpenAI Codex (v0.145.0)" })).toBe(true);
  });

  it("rejects a screen that merely echoes the just-typed boot line back, before the CLI has rendered anything", () => {
    // This doc's own root cause, reproduced live: the shell echoes the typed `claude --plugin-dir …` line
    // one tick before the process has actually exec'd — a real screen change, no error shape, but not a boot.
    expect(
      hasPositiveBootSignal({
        before: BEFORE,
        host: "claude-code",
        screen: `${BEFORE}claude --plugin-dir /repo`,
      }),
    ).toBe(false);
  });

  it("rejects the codex boot line's own echo the same way", () => {
    expect(hasPositiveBootSignal({ before: BEFORE, host: "codex", screen: `${BEFORE}codex --no-alt-screen` })).toBe(
      false,
    );
  });

  it("rejects a command-not-found shell error, even though the screen changed", () => {
    expect(hasPositiveBootSignal({ before: BEFORE, host: "codex", screen: "zsh: command not found: codex" })).toBe(
      false,
    );
  });

  it("rejects a permission-denied shell error", () => {
    expect(
      hasPositiveBootSignal({ before: BEFORE, host: "claude-code", screen: "bash: claude: Permission denied" }),
    ).toBe(false);
  });

  it("rejects a no-such-file-or-directory error", () => {
    expect(
      hasPositiveBootSignal({
        before: BEFORE,
        host: "claude-code",
        screen: "claude: No such file or directory",
      }),
    ).toBe(false);
  });

  // MEASURED: a `--resume` of a session with no transcript printed this, its banner above it, and exited.
  it("rejects Claude's missing-conversation exit even with its banner on screen", () => {
    const screen = `Claude Code v2.1.287\nNo conversation found with session ID: ${MISSING_ID}\n$ `;

    expect(hasPositiveBootSignal({ before: BEFORE, host: "claude-code", screen })).toBe(false);
  });

  it("accepts a booted Claude whose live session quotes the missing-conversation phrase above its composer", () => {
    const screen = `Claude Code v2.1.287\n⎿  No conversation found with session ID: ${MISSING_ID}\n${RULE}\n${COMPOSER}\n${RULE}`;

    expect(hasPositiveBootSignal({ before: BEFORE, host: "claude-code", screen })).toBe(true);
  });

  it("accepts a boot over an old exit left on screen, since the lowest line has Claude's chrome below it", () => {
    const screen = `No conversation found with session ID: ${MISSING_ID}\n$ claude\nClaude Code v2.1.287\n${RULE}\n${COMPOSER}`;

    expect(hasPositiveBootSignal({ before: BEFORE, host: "claude-code", screen })).toBe(true);
  });
});

describe("readMissingConversation", () => {
  const exit = `No conversation found with session ID: ${MISSING_ID}`;

  it("counts every column-0 line, so a launch compares against the lines before it typed", () => {
    const relaunch = `$ claude --resume ${MISSING_ID}`;

    expect([
      readMissingConversation({ screen: "$ " }),
      readMissingConversation({ screen: `${relaunch}\n${exit}\n$ ` }),
      readMissingConversation({ screen: `${relaunch}\n${exit}\n${relaunch}\n${exit}\n$ ` }),
    ]).toEqual([
      { lastIsExit: false, lines: 0, lowest: undefined },
      { lastIsExit: true, lines: 1, lowest: exit },
      { lastIsExit: true, lines: 2, lowest: exit },
    ]);
  });

  it("reads an exit under any shell prompt theme, reading no prompt shape", () => {
    expect(
      [
        readMissingConversation({ screen: `${exit}\nada@mac ~/dev % ` }),
        readMissingConversation({ screen: `${exit}\n╭─ ~/dev/slopweaver main\n╰─❯ ` }),
        readMissingConversation({ screen: `${exit}\n❯ ` }),
      ].map((reading) => reading.lastIsExit),
    ).toEqual([true, true, true]);
  });

  it("does not see the phrase indented under Claude's gutter, as a hook or tool result renders it", () => {
    expect(readMissingConversation({ screen: `⏺ hook said:\n  ⎿  ${exit}\n$ ` })).toEqual({
      lastIsExit: false,
      lines: 0,
      lowest: undefined,
    });
  });

  it("reads a column-0 line with a running Claude's chrome drawn below it as no exit", () => {
    expect(
      [
        readMissingConversation({ screen: `${exit}\n${RULE}\n${COMPOSER}\n${RULE}` }),
        readMissingConversation({ screen: `${exit}\n  ? for shortcuts` }),
        readMissingConversation({ screen: `${exit}\n$ claude\nClaude Code v2.1.287` }),
      ].map((reading) => reading.lastIsExit),
    ).toEqual([false, false, false]);
  });
});

describe("newMissingConversationExit", () => {
  const exit = ({ id }: { id: string }): string => `No conversation found with session ID: ${id}`;

  // A counterexample: a count of EXITS stayed at 1 across this real new failure.
  it("sees a new exit printed after a relaunch booted Claude's banner under an old one", () => {
    const before = readMissingConversation({ screen: `${exit({ id: "old" })}\n$ ` });
    const after = readMissingConversation({
      screen: `${exit({ id: "old" })}\n$ claude --resume new\nClaude Code v2.1.287\n${exit({ id: "new" })}\nada@mac ~/dev % `,
    });

    expect(newMissingConversationExit({ after, before })).toBe(true);
  });

  // A counterexample: the old line scrolled off as the new one printed, leaving the count level.
  it("sees a new exit whose old one scrolled off the screen as it printed", () => {
    const before = readMissingConversation({ screen: `${exit({ id: "old" })}\n$ ` });
    const after = readMissingConversation({ screen: `$ claude --resume new\n${exit({ id: "new" })}\n$ ` });

    expect([before.lines, after.lines, newMissingConversationExit({ after, before })]).toEqual([1, 1, true]);
  });

  it("reads the same session's exit, its old one scrolled off, as level: the stated residue", () => {
    const before = readMissingConversation({ screen: `${exit({ id: "same" })}\n$ ` });
    const after = readMissingConversation({ screen: `$ claude --resume same\n${exit({ id: "same" })}\n$ ` });

    expect(newMissingConversationExit({ after, before })).toBe(false);
  });

  it("never counts the old exit a launch found on screen as this launch's", () => {
    const screen = `${exit({ id: "old" })}\n$ `;

    expect(
      newMissingConversationExit({
        after: readMissingConversation({ screen: `${screen}claude --resume new` }),
        before: readMissingConversation({ screen }),
      }),
    ).toBe(false);
  });

  it("never reads a new line a live session quotes, with its composer below, as an exit", () => {
    const before = readMissingConversation({ screen: "$ " });
    const after = readMissingConversation({
      screen: `Claude Code v2.1.287\n${exit({ id: "x" })}\n${RULE}\n${COMPOSER}\n${RULE}`,
    });

    expect(newMissingConversationExit({ after, before })).toBe(false);
  });

  it("names the new exit line with its line count, and nothing for a screen with none", () => {
    const before = readMissingConversation({ screen: "$ " });

    expect(newExitLine({ after: readMissingConversation({ screen: `${exit({ id: "new" })}\n$ ` }), before })).toEqual({
      line: exit({ id: "new" }),
      lines: 1,
    });
    expect(newExitLine({ after: before, before })).toBe(undefined);
  });
});

describe("nextExitSightings", () => {
  const A = { line: "A", lines: 1 };

  it("extends a run on the same exit, restarts it on a different one, and ends it on none", () => {
    const once = nextExitSightings({ exit: A, sightings: NO_EXIT_SIGHTINGS });
    const twice = nextExitSightings({ exit: A, sightings: once });
    const other = nextExitSightings({ exit: { line: "B", lines: 1 }, sightings: twice });
    const none = nextExitSightings({ exit: undefined, sightings: other });

    expect([once, twice, other, none]).toEqual([
      { count: 1, exit: A },
      { count: 2, exit: A },
      { count: 1, exit: { line: "B", lines: 1 } },
      NO_EXIT_SIGHTINGS,
    ]);
  });

  // A counterexample: two quotes a read apart never reach the bound.
  it("never reaches the bound on lines that differ on every read", () => {
    const run = ["quoted-A", "quoted-B", "quoted-A"].reduce(
      (sightings, line) => nextExitSightings({ exit: { line, lines: 1 }, sightings }),
      NO_EXIT_SIGHTINGS,
    );

    expect(run).toEqual({ count: 1, exit: { line: "quoted-A", lines: 1 } });
    expect(run.count).toBeLessThan(EXIT_SIGHTINGS_TO_FAIL);
  });

  // A counterexample: the same quote printed again below the first is a second line, not one standing.
  it("restarts the run when an identical line prints again below the first", () => {
    const before = readMissingConversation({ screen: "$ " });
    const line = "No conversation found with session ID: quoted";
    const quote = `${line}\n⏺ first quote`;
    const reads = [quote, `${quote}\n${line}\n⏺ second quote`];

    const run = reads.reduce(
      (sightings, screen) =>
        nextExitSightings({ exit: newExitLine({ after: readMissingConversation({ screen }), before }), sightings }),
      NO_EXIT_SIGHTINGS,
    );

    expect(run).toEqual({ count: 1, exit: { line, lines: 2 } });
  });
});

describe("readyPromptIsAssertable / hasReadyPromptSignal", () => {
  it("can answer readiness for claude-code, and says outright that it cannot for codex", () => {
    expect(readyPromptIsAssertable({ host: "claude-code" })).toBe(true);
    expect(readyPromptIsAssertable({ host: "codex" })).toBe(false);
  });

  it("sees the input box a real claude session renders — the moment a paste will be accepted", () => {
    expect(hasReadyPromptSignal({ host: "claude-code", screen: "Claude Code v2.1.241\n\n❯ \n" })).toBe(true);
    expect(hasReadyPromptSignal({ host: "claude-code", screen: "some output\n? for shortcuts" })).toBe(true);
  });

  it("does NOT call the boot banner alone ready — that is the whole distinction from hasPositiveBootSignal", () => {
    const banner = "Claude Code v2.1.241 booting…";
    expect(hasPositiveBootSignal({ before: "$ ", host: "claude-code", screen: banner })).toBe(true);
    expect(hasReadyPromptSignal({ host: "claude-code", screen: banner })).toBe(false);
  });

  it("is false for an unreadable screen, and false for a host with no measured pattern", () => {
    expect(hasReadyPromptSignal({ host: "claude-code", screen: undefined })).toBe(false);
    expect(hasReadyPromptSignal({ host: "codex", screen: "OpenAI Codex (v0.145.0)\n❯ " })).toBe(false);
  });
});

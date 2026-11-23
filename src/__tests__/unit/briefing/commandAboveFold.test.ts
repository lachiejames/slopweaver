/**
 * The command-above-the-fold criterion, and the false-positive set that shaped it.
 *
 * The prose cases are not invented: they are the phrases a purely lexical criterion matched when it was run
 * over every JSON document in the owner's own `supervisor-scratch/handoff-<n>`, and the
 * reason the shipped criterion reads a `code` run's kind first. A test that only checked the commands would
 * have passed for that criterion too.
 */
import { describe, expect, it } from "vitest";

import {
  codeRunsOfFold,
  commandAboveFoldRefusal,
  hiddenCommand,
  isCommand,
} from "../../../briefing/commandAboveFold.js";
import type { BriefingFold } from "../../../outbound/briefing/types.js";

/** The two commands the setup-token card carried, verbatim from `pre-t4b-open-pages.json`. */
const MINT = "claude setup-token";
const PASTE = "pbpaste | slopweaver claude token --plan plan-four --stdin";

describe("isCommand", () => {
  it("accepts a multi-token invocation of a known head, pipeline included", () => {
    expect(isCommand({ text: MINT })).toBe(true);
    expect(isCommand({ text: PASTE })).toBe(true);
    expect(isCommand({ text: "slopweaver claude token --status" })).toBe(true);
    expect(isCommand({ text: "gh pr view 742" })).toBe(true);
  });

  it("refuses a one-token code run, which is a name rather than something to run", () => {
    expect(isCommand({ text: "plan-four" })).toBe(false);
    expect(isCommand({ text: "detail" })).toBe(false);
    expect(isCommand({ text: "slopweaver" })).toBe(false);
  });

  it("refuses a head this fleet does not hand the owner", () => {
    expect(isCommand({ text: "sleep 1" })).toBe(false);
    expect(isCommand({ text: "curl https://example.test" })).toBe(false);
  });

  // A disk-indexing repair page handed the owner all three of these by hand, so they are on the list by evidence
  // rather than by guess — see `COMMAND_HEADS` for why a macOS tool is not there by default.
  it("accepts the macOS commands the owner's own pages have actually asked them to run", () => {
    expect(isCommand({ text: "mdutil -E" })).toBe(true);
    expect(isCommand({ text: "launchctl disable system/com.apple.metadata.mds" })).toBe(true);
    expect(isCommand({ text: "gcloud auth login" })).toBe(true);
  });

  it("is insensitive to case, backticks and spacing, so a composer's formatting cannot dodge it", () => {
    expect(isCommand({ text: "`Claude   setup-token`" })).toBe(true);
  });
});

describe("hiddenCommand", () => {
  it("reports the command the fold carries and the cells never name", () => {
    const aboveFold = "Minting a setup token means running claude setup-token signed into that account.";

    expect(hiddenCommand({ aboveFold, commands: [MINT, PASTE] })).toBe(PASTE);
  });

  it("passes the card that names both commands above the fold", () => {
    const aboveFold =
      "The first command in any terminal is `claude setup-token`. With that token copied, the second " +
      "command is `pbpaste | slopweaver claude token --plan plan-four --stdin`.";

    expect(hiddenCommand({ aboveFold, commands: [MINT, PASTE] })).toBe(undefined);
  });

  it("reports nothing when the fold carries no commands at all", () => {
    expect(hiddenCommand({ aboveFold: "", commands: ["plan-four", "detail", "main"] })).toBe(undefined);
  });
});

describe("the structural half of the criterion", () => {
  /**
   * Every phrase the purely lexical criterion matched on the owner's own documents, none of them a command.
   * `isCommand` accepts them and that is stated rather than hidden — what keeps them out is that prose is
   * never a `code` run, which is the property this block asserts.
   */
  const MEASURED_PROSE = [
    "slopweaver and the fleet",
    "slopweaver at the door",
    "slopweaver against main",
    "slopweaver as them",
    "slopweaver runs the sweep",
    "claude code",
    "claude session",
    "git watch loops",
  ];

  it("is what the whole rule rests on: the lexical half alone accepts every one of them", () => {
    expect(MEASURED_PROSE.length).toBeGreaterThan(0);
    expect(MEASURED_PROSE.filter((text) => !isCommand({ text }))).toEqual([]);
  });

  it("keeps them out because a fold of prose yields no commands to check", () => {
    const fold: BriefingFold = {
      blocks: [{ content: MEASURED_PROSE.map((text) => ({ kind: "text" as const, text })), kind: "para" }],
      summary: "what the sweep found",
    };

    expect(codeRunsOfFold({ fold })).toEqual([]);
    expect(hiddenCommand({ aboveFold: "", commands: codeRunsOfFold({ fold }) })).toBe(undefined);
  });

  it("still finds a real command sitting in the same fold as that prose", () => {
    const fold: BriefingFold = {
      blocks: [
        { content: MEASURED_PROSE.map((text) => ({ kind: "text" as const, text })), kind: "para" },
        { content: [{ kind: "code", text: PASTE }], kind: "para" },
      ],
      summary: "what the sweep found",
    };

    expect(hiddenCommand({ aboveFold: "", commands: codeRunsOfFold({ fold }) })).toBe(PASTE);
  });
});

describe("codeRunsOfFold", () => {
  it("reads a code run out of a paragraph, a list item and a nested fold, in reading order", () => {
    const fold: BriefingFold = {
      blocks: [
        {
          content: [
            { kind: "text", text: "First " },
            { kind: "code", text: MINT },
          ],
          kind: "para",
        },
        {
          items: [[{ kind: "code", text: PASTE }]],
          kind: "list",
          ordered: true,
        },
        {
          fold: {
            blocks: [{ content: [{ kind: "code", text: "slopweaver claude token --status" }], kind: "para" }],
            summary: "then check it",
          },
          kind: "fold",
        },
      ],
      summary: "the two commands",
    };

    expect(codeRunsOfFold({ fold })).toEqual([MINT, PASTE, "slopweaver claude token --status"]);
  });

  it("reads no run out of a fold whose blocks carry only text", () => {
    const fold: BriefingFold = {
      blocks: [{ content: [{ kind: "text", text: "Nothing to type here." }], kind: "para" }],
      summary: "what it found",
    };

    expect(codeRunsOfFold({ fold })).toEqual([]);
  });
});

describe("commandAboveFoldRefusal", () => {
  it("names the command and tells the composer to fold other prose rather than the command", () => {
    const line = commandAboveFoldRefusal({ command: PASTE });

    expect(line).toContain(PASTE);
    expect(line).toContain("never the command");
  });
});

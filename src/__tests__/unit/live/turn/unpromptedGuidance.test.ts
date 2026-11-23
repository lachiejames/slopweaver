/**
 * The unprompted-help guidance block: nothing for a tagged ask, and the judgement rules for a `witness help`
 * one, ending on a blank line so the brief's next section starts clean.
 */
import { describe, expect, it } from "vitest";

import { unpromptedHelpLines } from "../../../../live/turn/unpromptedGuidance.js";

describe("unpromptedHelpLines", () => {
  it("prints nothing for a tagged ask", () => {
    expect(unpromptedHelpLines({ unprompted: false })).toEqual([]);
  });

  it("opens on UNPROMPTED and carries the named-person rule for an unprompted one", () => {
    const lines = unpromptedHelpLines({ unprompted: true });
    expect(lines[0]).toBe(
      "UNPROMPTED — nobody tagged this bot in this message. `witness help` opened it as an ask because the thread,",
    );
    expect(lines).toContain(
      "  - Never do work a named person was asked to do. A status question asked of someone else IS answerable.",
    );
    expect(lines.at(-1)).toBe("");
  });

  it("finishes a PR or ticket ask only when the person explicitly asked for it, never on the bot's own question", () => {
    const lines = unpromptedHelpLines({ unprompted: true });
    expect(lines).toContain(
      "  - One exception: earlier in this thread the asker EXPLICITLY asked the bot for a PR, a ticket or a fix,",
    );
    expect(lines).toContain("    The bot's own question is never the ask: read the thread for the person's words.");
  });

  it("revises the bot's own answer on an untagged correction, superseding the old one", () => {
    expect(unpromptedHelpLines({ unprompted: true })).toContain(
      "    and if it holds, post the revised answer with the old answer's ts in the form's `supersedes`.",
    );
  });
});

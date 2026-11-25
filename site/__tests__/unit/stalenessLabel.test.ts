/*
 * What a staleness mark says when the owner points at it: what could not be read, why in plain words, and how old the data
 * still drawn beside it is — one line per subject, so three failed registers are three lines, not the first and a
 * count — and, apart from those words, the raw message each plain line was told from, for the fold beneath.
 */
import { describe, expect, it } from "vitest";

import { stalenessLabel, stalenessRaw, stalenessShortWords } from "../../lib/stalenessLabel";

/** The page's own age words, reduced to the instant so each case names exactly which one it aged. */
const age = (iso: string): string => `at ${iso}`;

describe("stalenessShortWords", () => {
  it("returns each fact's own short words in order, each once", () => {
    expect(
      stalenessShortWords({
        facts: [
          { shortWords: "burn not read", subject: "the fleet burn reading", why: "timed out" },
          { subject: "the week", why: "exited 1" },
          { shortWords: "app build not read", subject: "the app's own build", why: "no answer" },
          { shortWords: "burn not read", subject: "Codex's sessions in the fleet burn reading", why: "timed out" },
        ],
      }),
    ).toStrictEqual(["burn not read", "app build not read"]);
  });

  it("returns nothing when no fact supplied any, so the mark stays a glyph alone", () => {
    expect(stalenessShortWords({ facts: [{ subject: "your hands", why: "exited 1" }] })).toStrictEqual([]);
    expect(stalenessShortWords({ facts: [] })).toStrictEqual([]);
  });

  it("leaves the hover's words unchanged by a fact's short words", () => {
    const fact = { subject: "the fleet burn reading", why: "timed out" };
    expect(stalenessLabel({ age, facts: [{ ...fact, shortWords: "burn not read" }] })).toBe(
      stalenessLabel({ age, facts: [fact] }),
    );
  });
});

describe("stalenessLabel", () => {
  it("says what could not be read, why in plain words, and the age of the reading still shown", () => {
    expect(
      stalenessLabel({
        age,
        facts: [
          { observedAtIso: "2026-10-10T14:40:00.000Z", subject: "your hands", why: "slopweaver hand list exited 1" },
        ],
      }),
    ).toBe(
      "Your hands could not be read. Its command stopped with an error and gave no reason. Showing the reading from " +
        "at 2026-10-10T14:40:00.000Z.",
    );
  });

  it("says nothing earlier is shown when no reading had answered, never lifting a reason it does not know", () => {
    expect(stalenessLabel({ age, facts: [{ subject: "The board", why: "the route timed out" }] })).toBe(
      "The board could not be read. It failed with a technical error. Nothing earlier to show.",
    );
  });

  it("says what the console is doing about it after the line that carries it, closed with a stop", () => {
    expect([
      stalenessLabel({
        age,
        facts: [
          {
            after: "The console tries again today 9:14 am",
            observedAtIso: "2026-10-10T14:40:00.000Z",
            subject: "the current board",
            why: "slopweaver handover list exited 1",
          },
        ],
      }),
      stalenessLabel({
        age,
        facts: [{ after: "The console is reading it again now", subject: "the board projection", why: "exit 2" }],
      }),
    ]).toEqual([
      "The current board could not be read. Its command stopped with an error and gave no reason. Showing the reading " +
        "from at 2026-10-10T14:40:00.000Z. The console tries again today 9:14 am.",
      "The board projection could not be read. It failed with a technical error. Nothing earlier to show. The console " +
        "is reading it again now.",
    ]);
  });

  it("names every subject on a line of its own, in the order given", () => {
    expect(
      stalenessLabel({
        age,
        facts: [
          { subject: "held replies", why: "its latest read did not answer" },
          { observedAtIso: "2026-10-10T14:40:00.000Z", subject: "your hands", why: "slopweaver hand list exited 1" },
        ],
      }).split("\n"),
    ).toStrictEqual([
      "Held replies could not be read. Its latest read did not answer. Nothing earlier to show.",
      "Your hands could not be read. Its command stopped with an error and gave no reason. Showing the reading from " +
        "at 2026-10-10T14:40:00.000Z.",
    ]);
  });

  it("never puts a stack trace in the hover's words, saying it as a technical error instead", () => {
    const trace =
      "slopweaver board read exited 1: TypeError: x is undefined · at readBoard (/repo/src/handover/board.ts:12:3) · at main";

    expect(stalenessLabel({ age, facts: [{ subject: "the board", why: trace }] })).toBe(
      "The board could not be read. Its command stopped with a technical error. Nothing earlier to show.",
    );
  });

  it("says nothing when there is nothing to say", () => {
    expect(stalenessLabel({ age, facts: [] })).toBe("");
  });

  it("says a withheld value is not shown, in the console's own words, never as a failed read", () => {
    const aged =
      "the reading it counts is 43 minutes old, past the 30-minute landing cadence; the console takes a fresh one now";
    expect(stalenessLabel({ age, facts: [{ subject: "this count", why: "", withheld: aged }] })).toBe(
      `This count is not shown: ${aged}.`,
    );
  });

  it("says a withheld value's quoted read reason plainly after the console's own words", () => {
    expect(
      stalenessLabel({
        age,
        facts: [
          {
            subject: "this count",
            why: "slopweaver github landing did not answer within 240s",
            withheld:
              "the console's latest refresh of your pull requests failed; the console tries again today 9:11 pm",
          },
        ],
      }),
    ).toBe(
      "This count is not shown: the console's latest refresh of your pull requests failed; the console tries again " +
        "today 9:11 pm. It did not answer in time.",
    );
  });
});

describe("stalenessRaw", () => {
  it("keeps the raw message behind each plain line that is not the message itself, subject first", () => {
    expect(
      stalenessRaw({
        facts: [
          { subject: "the board", why: "the route timed out" },
          { subject: "your hands", why: "slopweaver hand list exited 1: HTTP 401 Unauthorized" },
        ],
      }),
    ).toEqual(["The board: the route timed out", "Your hands: slopweaver hand list exited 1: HTTP 401 Unauthorized"]);
  });

  it("keeps nothing when every reason is one of Slopweaver's own sentences", () => {
    expect(stalenessRaw({ facts: [{ subject: "held replies", why: "its latest read did not answer" }] })).toEqual([]);
  });

  it("keeps nothing for a withheld value with no read reason, and the raw message for one that quotes a read", () => {
    expect(
      stalenessRaw({
        facts: [
          { subject: "this count", why: "", withheld: "the reading it counts is 43 minutes old" },
          { subject: "this count", why: "slopweaver github landing exited 1: boom", withheld: "a refresh failed" },
        ],
      }),
    ).toEqual(["This count: slopweaver github landing exited 1: boom"]);
  });
});

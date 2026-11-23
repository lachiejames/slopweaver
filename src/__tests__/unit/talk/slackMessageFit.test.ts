/**
 * The shared fit behind `slack_open` and `slack_thread_after`: whole messages by size, the first that does not fit cut
 * between graphemes and named, never a fixed per-message cap — the 1,200-character cut that left the voice unable to
 * read two replies to their end.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { TalkErrors } from "../../../talk/errors.js";
import { PAGE_TOOL_ANSWER_MAX_BYTES } from "../../../talk/pageOutline.js";
import type { SpokenSlackMessage } from "../../../talk/slackAfter.js";
import {
  cutClause,
  fitAnswer,
  fitSlackMessages,
  MIN_PARTIAL_CHARACTERS,
  SLACK_READ_ANSWER_MAX_BYTES,
} from "../../../talk/slackMessageFit.js";

/** One spoken message, at a fixed instant per author. */
function said({ author, text }: { author: string; text: string }): SpokenSlackMessage {
  return { atIso: "2026-10-20T01:02:56.000Z", author, files: [], text };
}

/** One message's serialised size, in UTF-8 bytes. */
function bytesOf({ message }: { message: SpokenSlackMessage }): number {
  return Buffer.byteLength(JSON.stringify(message), "utf8");
}

const OPENING = said({ author: "Ada Owner", text: "fresh batch of vulnerability-fix PRs for your review" });
const JASPER = said({ author: "Jasper Nolan", text: `feedback from my robot to yours ${"x".repeat(2400)} the end` });
const BOT = said({ author: "acme-bot", text: `in plain english ${"y".repeat(1800)} the end` });

describe("fitSlackMessages", () => {
  it("carries every message WHOLE when they fit, however long one is", () => {
    const fit = fitSlackMessages({
      maxBytes: 8 * 1024,
      messages: [JASPER, BOT],
      minimumPartialCharacters: MIN_PARTIAL_CHARACTERS,
      priority: OPENING,
    });
    expect(fit.priority).toEqual(OPENING);
    expect(fit.messages).toEqual([JASPER, BOT]);
    expect(fit.cut).toEqual([]);
    expect(fit.omitted).toBe(0);
  });

  it("keeps the newest whole, cuts the next to the room left and names it, and omits only older ones", () => {
    const older = said({ author: "Rosa Lindqvist", text: "an older reply" });
    const maxBytes = bytesOf({ message: OPENING }) + bytesOf({ message: BOT }) + 1 + 600;
    const fit = fitSlackMessages({
      maxBytes,
      messages: [older, JASPER, BOT],
      minimumPartialCharacters: MIN_PARTIAL_CHARACTERS,
      priority: OPENING,
    });
    expect(fit.priority).toEqual(OPENING);
    expect(fit.messages.map((message) => message.author)).toEqual(["Jasper Nolan", "acme-bot"]);
    expect(fit.messages[1]).toEqual(BOT);
    const kept = fit.cut[0]!.keptChars;
    // JASPER's words are ASCII, so one character is one UTF-16 unit and `length` counts them.
    expect(fit.cut).toEqual([
      { atIso: JASPER.atIso, author: "Jasper Nolan", keptChars: kept, wholeChars: JASPER.text.length },
    ]);
    expect(fit.messages[0]!.text).toBe(`${JASPER.text.slice(0, kept)} …`);
    expect(fit.omitted).toBe(1);
    const used = bytesOf({ message: OPENING }) + fit.messages.reduce((sum, m) => sum + bytesOf({ message: m }), 1);
    expect(used).toBeLessThanOrEqual(maxBytes);
    // The longest prefix: one more character would not have fitted.
    const oneMore = { ...JASPER, text: `${JASPER.text.slice(0, kept + 1)} …` };
    expect(used - bytesOf({ message: fit.messages[0]! }) + bytesOf({ message: oneMore })).toBeGreaterThan(maxBytes);
  });

  it("cuts the opening itself when it alone is over the budget, and names it first", () => {
    const fit = fitSlackMessages({
      maxBytes: 1024,
      messages: [BOT],
      minimumPartialCharacters: MIN_PARTIAL_CHARACTERS,
      priority: JASPER,
    });
    expect(fit.cut.map((one) => one.author)).toEqual(["Jasper Nolan"]);
    expect(bytesOf({ message: fit.priority! })).toBeLessThanOrEqual(1024);
    expect(fit.messages).toEqual([]);
    expect(fit.omitted).toBe(1);
  });

  it("leaves a message out rather than carry a cut shorter than the threshold, and keeps one at it", () => {
    const text = "z".repeat(500);
    const message = said({ author: "Ari", text });
    const atThreshold = bytesOf({ message: { ...message, text: `${"z".repeat(MIN_PARTIAL_CHARACTERS)} …` } });
    const at = fitSlackMessages({
      maxBytes: atThreshold,
      messages: [message],
      minimumPartialCharacters: 80,
      priority: null,
    });
    expect(at.cut).toEqual([{ atIso: message.atIso, author: "Ari", keptChars: 80, wholeChars: 500 }]);
    const below = fitSlackMessages({
      maxBytes: atThreshold - 1,
      messages: [message],
      minimumPartialCharacters: 80,
      priority: null,
    });
    expect(below.messages).toEqual([]);
    expect(below.cut).toEqual([]);
    expect(below.omitted).toBe(1);
  });

  it("names a priority message with no room for even a cut, and carries the rest in its room", () => {
    const fit = fitSlackMessages({
      maxBytes: bytesOf({ message: OPENING }),
      messages: [OPENING],
      minimumPartialCharacters: 80,
      priority: JASPER,
    });
    expect(fit.priority).toBe(null);
    expect(fit.messages).toEqual([OPENING]);
    expect(fit.cut).toEqual([
      { atIso: JASPER.atIso, author: "Jasper Nolan", keptChars: 0, wholeChars: JASPER.text.length },
    ]);
    expect(fit.usedBytes).toBe(bytesOf({ message: OPENING }));
  });

  it("counts JSON escapes, so quote- and control-heavy words still fit the bytes", () => {
    const message = said({ author: "Ari", text: '"\\\n\u0001'.repeat(400) });
    const fit = fitSlackMessages({ maxBytes: 900, messages: [message], minimumPartialCharacters: 80, priority: null });
    expect(bytesOf({ message: fit.messages[0]! })).toBeLessThanOrEqual(900);
    expect(fit.cut[0]!.wholeChars).toBe(1600);
  });

  it("never splits an astral character, counting it as one", () => {
    const message = said({ author: "Ari", text: "🔐".repeat(300) });
    const fit = fitSlackMessages({ maxBytes: 600, messages: [message], minimumPartialCharacters: 80, priority: null });
    const cut = fit.cut[0]!;
    expect(cut.wholeChars).toBe(300);
    expect(fit.messages[0]!.text).toBe(`${"🔐".repeat(cut.keptChars)} …`);
  });

  it("never splits a joined emoji, counting the whole sequence as one character", () => {
    // Woman, ZWJ, woman, ZWJ, girl: five code points, eight UTF-16 units, one character on screen.
    const family = "\u{1F469}‍\u{1F469}‍\u{1F467}";
    const message = said({ author: "Ari", text: family.repeat(200) });
    const fit = fitSlackMessages({ maxBytes: 2000, messages: [message], minimumPartialCharacters: 80, priority: null });
    const cut = fit.cut[0]!;
    expect(cut.wholeChars).toBe(200);
    expect(fit.messages[0]!.text).toBe(`${family.repeat(cut.keptChars)} …`);
  });
});

describe("fitAnswer", () => {
  it("keeps the read's answer, page additions aside, inside the page's tool cap", () => {
    expect(SLACK_READ_ANSWER_MAX_BYTES).toBe(PAGE_TOOL_ANSWER_MAX_BYTES - 5 * 1024);
  });

  // The page's cap is UTF-8 bytes, so a read of multibyte names is measured by its bytes.
  it("measures the ceiling in bytes, shrinking a read whose names fit it in characters but not in bytes", () => {
    const people = Array.from({ length: 40 }, (_, at) => `語語語語語語語語語語 ${String(at)}`);
    const build = ({ budget }: { budget: number }) => {
      const fit = fitSlackMessages({
        maxBytes: budget,
        messages: [JASPER, BOT],
        minimumPartialCharacters: 80,
        priority: OPENING,
      });
      return {
        answer: { cut: fit.cut, messages: fit.messages, opening: fit.priority, people },
        usedBytes: fit.usedBytes,
      };
    };
    const whole = build({ budget: 8 * 1024 }).answer;
    const ceilingBytes = JSON.stringify(whole).length + 10;
    expect(Buffer.byteLength(JSON.stringify(whole), "utf8")).toBeGreaterThan(ceilingBytes);
    const answer = unwrap(fitAnswer({ build, ceilingBytes, maxBytes: 8 * 1024 }));
    expect(Buffer.byteLength(JSON.stringify(answer), "utf8")).toBeLessThanOrEqual(ceilingBytes);
    expect(answer.people).toEqual(people);
  });

  it("shrinks the message budget until the WHOLE answer fits the byte ceiling", () => {
    const people = Array.from({ length: 100 }, (_, at) => `Person number ${String(at)} with a long display name`);
    const answer = unwrap(
      fitAnswer({
        build: ({ budget }) => {
          const fit = fitSlackMessages({
            maxBytes: budget,
            messages: [JASPER, BOT],
            minimumPartialCharacters: 80,
            priority: OPENING,
          });
          return {
            answer: { cut: fit.cut, messages: fit.messages, opening: fit.priority, people },
            usedBytes: fit.usedBytes,
          };
        },
        ceilingBytes: 8_000,
        maxBytes: 8 * 1024,
      }),
    );
    expect(Buffer.byteLength(JSON.stringify(answer), "utf8")).toBeLessThanOrEqual(8_000);
    expect(answer.opening).toEqual(OPENING);
    expect(answer.cut.length).toBe(1);
  });

  it("says why when not even an answer carrying no message fits", () => {
    const refused = fitAnswer({
      build: () => ({ answer: { warnings: ["w".repeat(200)] }, usedBytes: 0 }),
      ceilingBytes: 100,
      maxBytes: 4096,
    });
    expect(unwrapErr(refused)).toEqual(TalkErrors.slackAnswerOverCeiling({ bytes: 217, ceilingBytes: 100 }));
    expect(unwrapErr(refused).message).toBe(
      "the read's own sentence, names and warnings come to 217 bytes with no message in them, over the " +
        "100-byte answer ceiling, so nothing could be carried",
    );
  });
});

describe("cutClause", () => {
  it("names each cut message by author and time, and is empty when nothing was cut", () => {
    expect(cutClause({ cut: [] })).toBe("");
    expect(
      cutClause({
        cut: [{ atIso: "2026-10-20T01:02:56.000Z", author: "Jasper Nolan", keptChars: 900, wholeChars: 2431 }],
      }),
    ).toBe(
      " Too long to carry whole in one answer, so cut: Jasper Nolan's at 2026-10-20T01:02:56.000Z (900 of 2431 characters are here).",
    );
  });
});

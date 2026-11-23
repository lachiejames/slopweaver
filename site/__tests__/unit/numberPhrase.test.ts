/*
 * Numbers in one phrase read one way : 1.7K beside 5.9K, or 1,734 beside 5,977, never mixed.
 */

import { describe, expect, it } from "vitest";

import { formatNumberPhrase, oneNumberNotation } from "../../lib/numberPhrase";

describe("formatNumberPhrase", () => {
  it("writes every value of a phrase in the one notation asked for", () => {
    expect([
      formatNumberPhrase({ notation: "exact", values: [1734, 5977] }),
      formatNumberPhrase({ notation: "compact", values: [1734, 5977] }),
    ]).toEqual([
      ["1,734", "5,977"],
      ["1.7K", "5.9K"],
    ]);
  });

  it("truncates rather than rounds, drops a trailing .0, and leaves a count under a thousand whole", () => {
    expect(formatNumberPhrase({ notation: "compact", values: [999, 1000, 4100, 12_999, -1734, 3_456_789] })).toEqual([
      "999",
      "1K",
      "4.1K",
      "12.9K",
      "-1.7K",
      "3.4M",
    ]);
  });

  it("leaves the values it was given as they were", () => {
    const values = [1734, 5977];
    formatNumberPhrase({ notation: "compact", values });
    expect(values).toEqual([1734, 5977]);
  });
});

describe("oneNumberNotation", () => {
  it("shortens a sentence's exact thousands when it already shortens one", () => {
    expect(oneNumberNotation({ text: "1.7K of 5,977 rows matched." })).toBe("1.7K of 5.9K rows matched.");
  });

  it("judges each sentence alone, keeping the gap between them", () => {
    expect(oneNumberNotation({ text: "It read 12K rows.  Then 1,734 of 5,977 matched." })).toBe(
      "It read 12K rows.  Then 1,734 of 5,977 matched.",
    );
  });

  it("leaves a sentence of exact counts, a year beside a short count, and plain prose as written", () => {
    expect([
      oneNumberNotation({ text: "1,734 of 5,977 rows matched." }),
      oneNumberNotation({ text: "In 2026 it read 1.7K rows." }),
      oneNumberNotation({ text: "Nothing to count here." }),
      oneNumberNotation({ text: "" }),
    ]).toEqual(["1,734 of 5,977 rows matched.", "In 2026 it read 1.7K rows.", "Nothing to count here.", ""]);
  });

  it("never rewrites a quote, nor lets one decide, and ends a sentence at a stop inside a closing quote", () => {
    expect([
      oneNumberNotation({ text: "Your words were “5,977 rows.” The card summary is 1K." }),
      oneNumberNotation({ text: 'It read 1.7K rows under "5,977 of them failed".' }),
      oneNumberNotation({ text: 'It read 5,977 rows under "1.7K failed".' }),
      oneNumberNotation({ text: "It read 5,977 rows under ‘1.7K failed’ and they said ‘6,999 failed’." }),
    ]).toEqual([
      "Your words were “5,977 rows.” The card summary is 1K.",
      'It read 1.7K rows under "5,977 of them failed".',
      'It read 5,977 rows under "1.7K failed".',
      "It read 5,977 rows under ‘1.7K failed’ and they said ‘6,999 failed’.",
    ]);
  });

  it("never closes a curly-quoted span at an apostrophe inside it", () => {
    expect(oneNumberNotation({ text: "Summary is 1K; they said ‘That’s 5,977 rows’." })).toBe(
      "Summary is 1K; they said ‘That’s 5,977 rows’.",
    );
  });

  it("leaves a count too large to read back exactly as written", () => {
    expect(oneNumberNotation({ text: "1K of 9,999,999,999,999,999 rows." })).toBe("1K of 9,999,999,999,999,999 rows.");
  });

  it("never ends a sentence at a stop inside a quote, and does end one at a quote closing on a stop", () => {
    expect([
      oneNumberNotation({ text: 'They said "Fine. 5,977 failed," and summary is 1K.' }),
      oneNumberNotation({ text: 'It read 5,977 rows, "all of them." Then 1.7K of 2,500 matched.' }),
    ]).toEqual([
      'They said "Fine. 5,977 failed," and summary is 1K.',
      'It read 5,977 rows, "all of them." Then 1.7K of 2.5K matched.',
    ]);
  });
});

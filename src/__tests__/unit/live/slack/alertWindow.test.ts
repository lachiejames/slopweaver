import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseAlertWindow, windowOldestTs } from "../../../../live/slack/alertWindow.js";

describe("parseAlertWindow — refused before any token resolve or network call", () => {
  it("parses each unit into its duration", () => {
    expect(unwrap(parseAlertWindow({ text: "90m" }))).toEqual({ label: "90m", ms: 5_400_000 });
    expect(unwrap(parseAlertWindow({ text: "24h" }))).toEqual({ label: "24h", ms: 86_400_000 });
    expect(unwrap(parseAlertWindow({ text: "7d" }))).toEqual({ label: "7d", ms: 604_800_000 });
    expect(unwrap(parseAlertWindow({ text: "2w" }))).toEqual({ label: "2w", ms: 1_209_600_000 });
  });

  it("echoes the caller's own text as the label rather than re-rendering the duration", () => {
    // `24h` and `1d` are the same duration and are not the same statement about what was looked at. The label
    // lands on the card, so it stays what the caller typed.
    expect(unwrap(parseAlertWindow({ text: "24h" })).label).toBe("24h");
    expect(unwrap(parseAlertWindow({ text: "1d" })).label).toBe("1d");
  });

  it("trims surrounding whitespace, because a shell quote is an easy way to add some", () => {
    expect(unwrap(parseAlertWindow({ text: "  7d " })).label).toBe("7d");
  });

  it("REFUSES a window with no unit, naming the whole accepted shape", () => {
    const parsed = parseAlertWindow({ text: "7" });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)[0]).toContain("expected digits followed by m (minutes), h (hours), d (days) or w");
  });

  it("REFUSES a unit it does not have, rather than guessing the nearest one", () => {
    expect(unwrapErr(parseAlertWindow({ text: "3y" }))).toEqual([
      'invalid --window "3y": expected digits followed by m (minutes), h (hours), d (days) or w ' +
        "(weeks) — e.g. 90m, 24h, 7d, 2w",
    ]);
    expect(unwrapErr(parseAlertWindow({ text: "1mo" }))).toEqual([
      'invalid --window "1mo": expected digits followed by m (minutes), h (hours), d (days) or w ' +
        "(weeks) — e.g. 90m, 24h, 7d, 2w",
    ]);
  });

  it("REFUSES a zero window, which would read nothing and report it as quiet", () => {
    const parsed = parseAlertWindow({ text: "0d" });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)[0]).toContain("a window of zero reads nothing");
  });

  it("REFUSES a digit run long enough to overflow the form's `window` cap", () => {
    // Seven digits is the first length whose label would exceed the 12-character `window` field. Bounding it here
    // means a valid-looking window cannot build a card the form then refuses for a cap the caller never saw.
    expect(parseAlertWindow({ text: "999999d" }).isOk()).toBe(true);
    expect(parseAlertWindow({ text: "1234567d" }).isErr()).toBe(true);
  });

  it("REFUSES a negative or fractional window", () => {
    expect(unwrapErr(parseAlertWindow({ text: "-7d" }))).toEqual([
      'invalid --window "-7d": expected digits followed by m (minutes), h (hours), d (days) or w ' +
        "(weeks) — e.g. 90m, 24h, 7d, 2w",
    ]);
    expect(unwrapErr(parseAlertWindow({ text: "1.5d" }))).toEqual([
      'invalid --window "1.5d": expected digits followed by m (minutes), h (hours), d (days) or w ' +
        "(weeks) — e.g. 90m, 24h, 7d, 2w",
    ]);
  });

  it("REFUSES an empty window", () => {
    expect(unwrapErr(parseAlertWindow({ text: "" }))).toEqual([
      'invalid --window "": expected digits followed by m (minutes), h (hours), d (days) or w ' +
        "(weeks) — e.g. 90m, 24h, 7d, 2w",
    ]);
  });
});

describe("windowOldestTs — the Slack bound, from an injected clock", () => {
  it("subtracts the window and renders epoch SECONDS, not milliseconds", () => {
    const window = unwrap(parseAlertWindow({ text: "1h" }));

    expect(windowOldestTs({ nowMs: 1_800_000_000_000, window })).toBe("1799996400");
  });

  it("floors to a whole second, because Slack's bound is a decimal string it compares as a number", () => {
    const window = unwrap(parseAlertWindow({ text: "1m" }));

    expect(windowOldestTs({ nowMs: 1_800_000_000_999, window })).toBe("1799999940");
  });

  it("clamps at the epoch rather than emitting a negative bound", () => {
    const window = unwrap(parseAlertWindow({ text: "999999d" }));

    expect(windowOldestTs({ nowMs: 1_800_000_000_000, window })).toBe("0");
  });
});

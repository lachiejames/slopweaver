/** The chair's context reminder: when it fires, what it says, and what an unreadable window or transcript reads as. */
import { describe, expect, it } from "vitest";

import {
  CONTEXT_REMINDER_FRACTION,
  judgeChairContext,
  parseAutoCompactWindow,
  windowAtBoot,
} from "../../../supervisor/chairContext.js";

describe("judgeChairContext", () => {
  it("fires at exactly half the window — the ruling's 'around half full'", () => {
    expect(CONTEXT_REMINDER_FRACTION).toBe(0.5);
    const judged = judgeChairContext({
      readings: new Map([["a0000032", { depthTokens: 150_000, kind: "measured", windowTokens: 300_000 } as const]]),
      sessionIds: ["a0000032"],
    });
    expect(judged).toStrictEqual({
      notes: [],
      reminders: [
        "REMINDER — session a0000032 carries 150k of its 300k auto-compact window (50%), around half full: hand off at the next natural break. Nothing is blocked and the sweep re-arms as normal.",
      ],
    });
  });

  it("says nothing one token below half", () => {
    const judged = judgeChairContext({
      readings: new Map([["a0000032", { depthTokens: 149_999, kind: "measured", windowTokens: 300_000 } as const]]),
      sessionIds: ["a0000032"],
    });
    expect(judged).toStrictEqual({ notes: [], reminders: [] });
  });

  it("names an unreadable window or a session with no reading UNMEASURED, never a reminder", () => {
    const judged = judgeChairContext({
      readings: new Map([["a0000032", { kind: "unmeasured", why: "no `autoCompactWindow`" } as const]]),
      sessionIds: ["a0000032", "a0000049"],
    });
    expect(judged).toStrictEqual({
      notes: [
        "session a0000032: its context fill is UNMEASURED — no `autoCompactWindow`",
        "session a0000049: its context fill is UNMEASURED — its transcript was not read",
      ],
      reminders: [],
    });
  });

  it("judges each of two chair sessions on its own fill", () => {
    const judged = judgeChairContext({
      readings: new Map([
        ["a0000032", { depthTokens: 40_000, kind: "measured", windowTokens: 300_000 } as const],
        ["a0000049", { depthTokens: 290_000, kind: "measured", windowTokens: 300_000 } as const],
      ]),
      sessionIds: ["a0000032", "a0000049"],
    });
    expect(judged).toStrictEqual({
      notes: [],
      reminders: [
        "REMINDER — session a0000049 carries 290k of its 300k auto-compact window (97%), around half full: hand off at the next natural break. Nothing is blocked and the sweep re-arms as normal.",
      ],
    });
  });

  it("reminds once for two live processes resuming one session id", () => {
    const judged = judgeChairContext({
      readings: new Map([["a0000032", { depthTokens: 200_000, kind: "measured", windowTokens: 300_000 } as const]]),
      sessionIds: ["a0000032", "a0000032"],
    });
    expect(judged).toStrictEqual({
      notes: [],
      reminders: [
        "REMINDER — session a0000032 carries 200k of its 300k auto-compact window (67%), around half full: hand off at the next natural break. Nothing is blocked and the sweep re-arms as normal.",
      ],
    });
  });

  it("reads nothing for a chair with no sessions", () => {
    expect(judgeChairContext({ readings: new Map(), sessionIds: [] })).toStrictEqual({ notes: [], reminders: [] });
  });
});

describe("windowAtBoot", () => {
  const BOOT_MS = Date.UTC(2026, 10, 6);

  it("trusts a settings file last changed at or before the session's boot", () => {
    expect(windowAtBoot({ bootedAtMs: BOOT_MS, settingsChangedAtMs: BOOT_MS, windowTokens: 300_000 })).toStrictEqual({
      windowTokens: 300_000,
    });
  });

  it("refuses a settings file changed after the boot — the running session still runs its boot window", () => {
    expect(
      windowAtBoot({ bootedAtMs: BOOT_MS, settingsChangedAtMs: BOOT_MS + 1, windowTokens: 100_000 }),
    ).toStrictEqual({
      why: "Claude Code's settings changed after this session booted, so the window it runs may not be the one the file now names",
    });
  });

  it.each([
    { bootedAtMs: 0, name: "no boot instant" },
    { bootedAtMs: Number.POSITIVE_INFINITY, name: "an infinite boot instant, as `1e309` parses" },
    { bootedAtMs: Number.NaN, name: "a NaN boot instant" },
  ])("refuses a registry that records $name", ({ bootedAtMs }) => {
    expect(windowAtBoot({ bootedAtMs, settingsChangedAtMs: BOOT_MS, windowTokens: 300_000 })).toStrictEqual({
      why: "the Claude session registry records no boot instant, so which window it booted with is unknown",
    });
  });

  it("refuses a settings instant that is not finite", () => {
    expect(windowAtBoot({ bootedAtMs: BOOT_MS, settingsChangedAtMs: Number.NaN, windowTokens: 300_000 })).toStrictEqual(
      {
        why: "Claude Code's settings changed after this session booted, so the window it runs may not be the one the file now names",
      },
    );
  });
});

describe("parseAutoCompactWindow", () => {
  it("reads the install's window", () => {
    expect(parseAutoCompactWindow({ text: '{"autoCompactWindow":300000,"model":"fable"}' })).toStrictEqual({
      windowTokens: 300_000,
    });
  });

  it("names a settings file with no window rather than guessing the model's", () => {
    expect(parseAutoCompactWindow({ text: '{"model":"fable"}' })).toStrictEqual({
      why: "Claude Code's settings name no `autoCompactWindow`, so the window is the model's own, which no file here records",
    });
  });

  it("refuses a window that is not a positive integer", () => {
    expect(parseAutoCompactWindow({ text: '{"autoCompactWindow":"300k"}' })).toStrictEqual({
      why: "Claude Code's `autoCompactWindow` is not a positive integer (300k)",
    });
  });

  it("names a settings file that is not JSON", () => {
    // The parser's wording is the Node pinned in `.nvmrc`; a Node bump that rewords it reddens this, on purpose.
    expect(parseAutoCompactWindow({ text: "{" })).toStrictEqual({
      why: "Claude Code's settings file is not JSON (SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2))",
    });
  });
});

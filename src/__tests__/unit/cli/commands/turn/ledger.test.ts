/**
 * `turn ledger`'s own shell — what its argv accepts and refuses, and the two surfaces it renders: the row
 * lines a person reads and the footer that states its denominators and its one admitted absence.
 */
import { describe, expect, it } from "vitest";

import {
  parseTurnLedgerArgs,
  turnLedgerFooterLines,
  turnLedgerRowLines,
  turnLedgerWindowRejections,
} from "../../../../../cli/commands/turn/ledger.js";
import { TURN_LEDGER_FLAG_SPEC, TURN_LEDGER_USAGE } from "../../../../../cli/commands/turn/ledgerUsage.js";
import { unwrap } from "../../../../../lib/result.js";
import { TURN_LEDGER_PHASE_KEYS, type TurnLedgerRow } from "../../../../../live/turn/ledger.js";

/** One fully-measured row, with any field a test varies overridable. */
const row = (over: Partial<TurnLedgerRow> = {}): TurnLedgerRow => ({
  askText: "why did the staging pool exhaust",
  capturedIso: "2026-09-19T03:22:12.000Z",
  channel: "C1",
  completions: 1,
  dispatches: 1,
  ending: "answered",
  messageTs: "1789788122.066099",
  phases: { investigation: 960, noticed: 10, review: 1670, spinUp: 120, total: 3060 },
  reversedPhases: [],
  rounds: [{ outcome: "broken", spawnedAtIso: "2026-09-19T03:45:12.000Z" }],
  secondaryFailures: [],
  surface: "channel",
  taggedIso: "2026-09-19T03:22:02.000Z",
  terminal: true,
  threadTs: "1789788122.066099",
  userId: "U_ASKER",
  ...over,
});

describe("parseTurnLedgerArgs", () => {
  it("accepts every flag its own spec advertises", () => {
    const parsed = unwrap(
      parseTurnLedgerArgs({
        rest: ["--since", "2026-09-19T00:00:00Z", "--channel", "C1", "--limit", "5", "--json", "--home", "/tmp"],
      }),
    );

    expect(parsed.values["since"]).toBe("2026-09-19T00:00:00Z");
    expect(parsed.values["channel"]).toBe("C1");
    expect(parsed.values["limit"]).toBe("5");
    expect(parsed.values["json"]).toBe(true);
    expect(parsed.values["home"]).toBe("/tmp");
  });

  it("refuses a flag it does not declare", () => {
    const parsed = parseTurnLedgerArgs({ rest: ["--nope"] });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().join(" ")).toContain("--nope");
  });

  it("advertises in its usage exactly the flags its spec declares", () => {
    const declared = [...TURN_LEDGER_FLAG_SPEC.string, ...TURN_LEDGER_FLAG_SPEC.boolean].map((name) => `--${name}`);

    expect(declared.filter((flag) => !TURN_LEDGER_USAGE.includes(`${flag} `))).toEqual([]);
  });

  it("names every phase it measures in its own usage", () => {
    expect(TURN_LEDGER_PHASE_KEYS.length).toBeGreaterThan(0);
    expect(TURN_LEDGER_USAGE).toContain("It reports NO REACTIONS on the answer");
  });
});

describe("turnLedgerWindowRejections", () => {
  it("passes a window with neither bound", () => {
    expect(turnLedgerWindowRejections({ values: {} })).toEqual([]);
  });

  it("refuses a --since that is not an instant, naming the value", () => {
    const rejections = turnLedgerWindowRejections({ values: { since: "yesterday" } });

    expect(rejections).toEqual(["--since yesterday is not an ISO-8601 instant"]);
  });

  it("refuses a --limit that is not a whole number", () => {
    const rejections = turnLedgerWindowRejections({ values: { limit: "-3" } });

    expect(rejections).toEqual(["--limit -3 is not a whole number"]);
  });

  it("reports both rejections at once rather than stopping at the first", () => {
    const rejections = turnLedgerWindowRejections({ values: { limit: "x", since: "y" } });

    expect(rejections.length).toBe(2);
  });
});

describe("turnLedgerRowLines", () => {
  it("puts every phase, the rounds and the address on one line, with the ask's words under it", () => {
    const lines = turnLedgerRowLines({ row: row() });

    expect(lines.length).toBe(2);
    expect(lines[0]).toBe(
      "2026-09-19T03:22:02.000Z  channel  answered  notice 10s  spin-up 2m  invest 16m  review 28m  total 51m  " +
        "rounds 1 (broken)  C1/1789788122.066099",
    );
    expect(lines[1]).toBe('    "why did the staging pool exhaust"');
  });

  it("writes a dash for a phase the record set could not prove", () => {
    const lines = turnLedgerRowLines({ row: row({ phases: { noticed: 10 } }) });

    expect(lines[0]).toContain("spin-up —");
    expect(lines[0]).toContain("total —");
  });

  it("marks a re-dispatched ask on its own line rather than hiding it", () => {
    const lines = turnLedgerRowLines({ row: row({ dispatches: 3 }) });

    expect(lines[0]).toContain("re-dispatched x3");
  });

  it("falls back to the capture instant, and says so, when the tag's own instant is absent", () => {
    const lines = turnLedgerRowLines({ row: row({ taggedIso: undefined }) });

    expect(lines[0]!.startsWith("2026-09-19T03:22:12.000Z (captured)")).toBe(true);
  });

  it("prints one line when the capture row carried no text", () => {
    const lines = turnLedgerRowLines({ row: row({ askText: undefined }) });

    expect(lines.length).toBe(1);
  });

  it("flattens every run of whitespace and truncates a long ask at its own width", () => {
    const lines = turnLedgerRowLines({ row: row({ askText: `${"a\n".repeat(80)}tail` }) });

    expect(lines[1]).toBe(`    "${"a ".repeat(48)}…"`);
    expect(lines[1]!.includes("\n")).toBe(false);
  });

  it("spells a reversed phase differently from a silent one, on the same line", () => {
    const lines = turnLedgerRowLines({
      row: row({ phases: { noticed: 10 }, reversedPhases: ["review", "total"] }),
    });

    expect(lines[0]).toContain("review reversed");
    expect(lines[0]).toContain("total reversed");
    expect(lines[0]).toContain("spin-up —");
    expect(/(notice|spin-up|invest|review|total) -\d/u.test(lines[0]!)).toBe(false);
  });

  it("says rounds 0 for an ask nothing reviewed", () => {
    const lines = turnLedgerRowLines({ row: row({ rounds: [] }) });

    expect(lines[0]).toContain("rounds 0");
  });
});

describe("turnLedgerFooterLines", () => {
  const stats = [
    { count: 2, excludedRedispatched: 0, key: "noticed" as const, meanSeconds: 15, medianSeconds: 15, reversed: 0 },
    {
      count: 1,
      excludedRedispatched: 1,
      key: "investigation" as const,
      meanSeconds: 960,
      medianSeconds: 960,
      reversed: 0,
    },
    { count: 0, excludedRedispatched: 0, key: "review" as const, reversed: 0 },
  ];

  it("states the window, the per-phase denominators and what it does not hold", () => {
    const lines = turnLedgerFooterLines({
      rows: [row(), row({ terminal: false })],
      stats,
      unreadable: { asks: 0, completions: 0 },
    });

    expect(lines[1]).toBe("2 ask(s) in this window, 1 with a terminal event.");
    expect(lines[2]).toContain("mean 15s");
    expect(lines[2]).toContain("over 2 row(s)");
    expect(lines.at(-1)).toBe(
      "  No reactions on the answer: nothing on this machine records a human reaction to a bot answer yet.",
    );
  });

  it("names how many re-dispatched rows a generation-scoped mean left out", () => {
    const lines = turnLedgerFooterLines({ rows: [row()], stats, unreadable: { asks: 0, completions: 0 } });

    expect(lines[3]).toContain("1 re-dispatched excluded");
  });

  it("says a phase no row carries has no figures rather than printing a zero", () => {
    const lines = turnLedgerFooterLines({ rows: [row()], stats, unreadable: { asks: 0, completions: 0 } });

    expect(lines[4]).toContain("no row in this window carries it (0 measured)");
  });

  it("counts reversed spans per phase and once in total, and stays silent when there are none", () => {
    const withReversed = turnLedgerFooterLines({
      rows: [row()],
      stats: [
        { count: 2, excludedRedispatched: 0, key: "noticed" as const, meanSeconds: 15, medianSeconds: 15, reversed: 3 },
        { count: 0, excludedRedispatched: 0, key: "review" as const, reversed: 1 },
      ],
      unreadable: { asks: 0, completions: 0 },
    });

    expect(withReversed[2]).toContain("over 2 row(s), 3 reversed");
    expect(withReversed[3]).toContain("(0 measured, 1 reversed)");
    expect(withReversed.filter((line) => line.includes("closed BEFORE they opened"))).toEqual([
      "  4 span(s) closed BEFORE they opened and read `reversed` above: the two clocks behind them disagree," +
        " so there is no duration to print or average.",
    ]);
    expect(
      turnLedgerFooterLines({ rows: [row()], stats, unreadable: { asks: 0, completions: 0 } }).filter((line) =>
        line.includes("closed BEFORE they opened"),
      ),
    ).toEqual([]);
  });

  it("reports the lines each log could not read, and omits the clause when both are clean", () => {
    const dirty = turnLedgerFooterLines({ rows: [row()], stats, unreadable: { asks: 69, completions: 2 } });
    const clean = turnLedgerFooterLines({ rows: [row()], stats, unreadable: { asks: 0, completions: 0 } });

    expect(dirty.filter((line) => line.includes("unreadable ask-log line(s)"))).toEqual([
      "  69 unreadable ask-log line(s) and 2 unreadable completion line(s) were stepped over.",
    ]);
    expect(clean.filter((line) => line.includes("unreadable ask-log line(s)"))).toEqual([]);
  });
});

/**
 * The fleet burn's pure folds: Claude turns counted once per message id inside the window, Codex sessions counted
 * as the rise of their cumulative total across it, and every way a figure stops being whole saying so.
 */
import { describe, expect, it } from "vitest";

import {
  advanceCodexSession,
  type CodexSessionFold,
  codexBurnOf,
  emptyCodexSessionFold,
} from "../../../fleet/codexBurn.js";
import { advanceClaudeBurn, burnWindowOf, claudeBurnOf, emptyClaudeBurnFold } from "../../../fleet/hostBurn.js";

/** The instant every window here ends at. */
const NOW_MS = Date.parse("2026-10-08T12:00:00.000Z");
const WINDOW = burnWindowOf({ nowMs: NOW_MS });

/** A Claude assistant line: input 10, cache creation 20, cache read 300, output `output`. */
const claudeLine = ({ id, at, output = 5 }: { id: string; at: string; output?: number }): string =>
  JSON.stringify({
    message: {
      id,
      model: "claude-opus-5",
      usage: { cache_creation_input_tokens: 20, cache_read_input_tokens: 300, input_tokens: 10, output_tokens: output },
    },
    timestamp: at,
    type: "assistant",
  });

/** A Codex `token_count` line carrying cumulative totals. */
const codexLine = ({ at, total, output }: { at: string; total: number; output: number }): string =>
  JSON.stringify({
    payload: { info: { total_token_usage: { output_tokens: output, total_tokens: total } }, type: "token_count" },
    timestamp: at,
    type: "event_msg",
  });

/** Fold Claude lines, each with its transcript path. */
const claude = ({ lines }: { lines: readonly { path: string; line: string }[] }) => {
  const fold = emptyClaudeBurnFold();
  for (const { path, line } of lines) {
    advanceClaudeBurn({ fold, line, path, window: WINDOW });
  }
  return fold;
};

/** Fold one Codex rollout's lines. */
const codexSession = ({ lines }: { lines: readonly string[] }): CodexSessionFold => {
  const fold = emptyCodexSessionFold();
  for (const line of lines) {
    advanceCodexSession({ fold, line, window: WINDOW });
  }
  return fold;
};

describe("burnWindowOf", () => {
  it("opens 24 hours before the instant and marks the last ten minutes active", () => {
    expect([WINDOW.cutoffMs, WINDOW.activeFromMs, WINDOW.nowMs].map((ms) => new Date(ms).toISOString())).toEqual([
      "2026-10-07T12:00:00.000Z",
      "2026-10-08T11:50:00.000Z",
      "2026-10-08T12:00:00.000Z",
    ]);
  });
});

describe("claudeBurnOf", () => {
  it("counts all four counters once per message id, fleet-wide, and the output beside them", () => {
    const fold = claude({
      lines: [
        { line: claudeLine({ at: "2026-10-08T09:00:00.000Z", id: "m1" }), path: "/a.jsonl" },
        { line: claudeLine({ at: "2026-10-08T09:00:01.000Z", id: "m1" }), path: "/a.jsonl" },
        { line: claudeLine({ at: "2026-10-08T11:55:00.000Z", id: "m2", output: 7 }), path: "/b.jsonl" },
      ],
    });
    expect(claudeBurnOf({ fold, problems: [] })).toEqual({
      activeSessions: 1,
      kind: "measured",
      outputTokens: 12,
      projectedWeekTokens: 4704,
      sessions: 2,
      totalTokens: 672,
    });
  });

  it("leaves out a turn stamped at the window's opening instant or after it closes, and counts one just inside", () => {
    const fold = claude({
      lines: [
        { line: claudeLine({ at: "2026-10-07T12:00:00.000Z", id: "edge" }), path: "/a.jsonl" },
        { line: claudeLine({ at: "2026-10-08T12:00:01.000Z", id: "future" }), path: "/a.jsonl" },
        { line: claudeLine({ at: "2026-10-07T12:00:00.001Z", id: "inside" }), path: "/a.jsonl" },
      ],
    });
    expect([fold.totalTokens, fold.active.size, [...fold.seen]]).toEqual([335, 0, ["inside"]]);
  });

  it("reports a measured zero over a window with no turns, never unavailable", () => {
    expect(claudeBurnOf({ fold: emptyClaudeBurnFold(), problems: [] })).toEqual({
      activeSessions: 0,
      kind: "measured",
      outputTokens: 0,
      projectedWeekTokens: 0,
      sessions: 0,
      totalTokens: 0,
    });
  });

  it("is partial, with no projection, when a transcript could not be read or a usage line carried no id", () => {
    const idless = JSON.stringify({
      message: { usage: { output_tokens: 3 } },
      timestamp: "2026-10-08T09:00:00.000Z",
      type: "assistant",
    });
    const fold = claude({
      lines: [
        { line: idless, path: "/a.jsonl" },
        { line: claudeLine({ at: "2026-10-08T09:00:00.000Z", id: "m1" }), path: "/a.jsonl" },
      ],
    });
    expect(claudeBurnOf({ fold, problems: ["/gone.jsonl: could not be opened"] })).toEqual({
      activeSessions: 0,
      kind: "partial",
      outputTokens: 5,
      problems: ["/gone.jsonl: could not be opened", "1 usage line(s) could not be read"],
      sessions: 1,
      totalTokens: 335,
    });
  });

  it("is partial when a line carrying usage will not decode, or a usage turn carries no instant to judge it by", () => {
    const truncated = '{"timestamp":"2026-10-08T11:30:00.000Z","type":"assistant","message":{"id":"m2","usage":';
    const unstamped = JSON.stringify({ message: { id: "m3", usage: { output_tokens: 3 } }, type: "assistant" });
    const fold = claude({
      lines: [
        { line: truncated, path: "/a.jsonl" },
        { line: unstamped, path: "/a.jsonl" },
        { line: claudeLine({ at: "2026-10-08T09:00:00.000Z", id: "m1" }), path: "/a.jsonl" },
      ],
    });
    expect(claudeBurnOf({ fold, problems: [] })).toEqual({
      activeSessions: 0,
      kind: "partial",
      outputTokens: 5,
      problems: ["2 usage line(s) could not be read"],
      sessions: 1,
      totalTokens: 335,
    });
  });

  it("stays measured over a usage-free line and a usage turn outside the window", () => {
    const fold = claude({
      lines: [
        { line: JSON.stringify({ message: { content: "hi" }, type: "user" }), path: "/a.jsonl" },
        { line: claudeLine({ at: "2026-10-06T09:00:00.000Z", id: "old" }), path: "/a.jsonl" },
      ],
    });
    expect(claudeBurnOf({ fold, problems: [] }).kind).toBe("measured");
  });

  it("counts only an assistant turn, never another record that carries usage", () => {
    const user = JSON.parse(claudeLine({ at: "2026-10-08T11:00:00.000Z", id: "u1" })) as Record<string, unknown>;
    const fold = claude({
      lines: [
        { line: JSON.stringify({ ...user, type: "user" }), path: "/a.jsonl" },
        { line: claudeLine({ at: "2026-10-08T11:00:00.000Z", id: "a1" }), path: "/a.jsonl" },
      ],
    });
    expect(claudeBurnOf({ fold, problems: [] })).toEqual({
      activeSessions: 0,
      kind: "measured",
      outputTokens: 5,
      projectedWeekTokens: 2345,
      sessions: 1,
      totalTokens: 335,
    });
  });
});

describe("codexBurnOf", () => {
  it("counts a session begun inside the window as its last total, and an older one as its rise across the window", () => {
    const fresh = codexSession({
      lines: [
        codexLine({ at: "2026-10-08T10:00:00.000Z", output: 10, total: 1000 }),
        codexLine({ at: "2026-10-08T11:58:00.000Z", output: 30, total: 4000 }),
      ],
    });
    const older = codexSession({
      lines: [
        codexLine({ at: "2026-10-07T08:00:00.000Z", output: 50, total: 9000 }),
        codexLine({ at: "2026-10-07T11:00:00.000Z", output: 60, total: 10_000 }),
        codexLine({ at: "2026-10-08T01:00:00.000Z", output: 70, total: 12_500 }),
      ],
    });
    expect(
      codexBurnOf({
        problems: [],
        sessions: [
          { fold: fresh, path: "/fresh.jsonl" },
          { fold: older, path: "/older.jsonl" },
        ],
        window: WINDOW,
      }),
    ).toEqual({
      activeSessions: 1,
      kind: "measured",
      outputTokens: 40,
      projectedWeekTokens: 45_500,
      sessions: 2,
      totalTokens: 6500,
    });
  });

  it("skips a capped account's null reading and a session that drew nothing in the window", () => {
    const capped = JSON.stringify({
      payload: { info: null, type: "token_count" },
      timestamp: "2026-10-08T10:00:00.000Z",
    });
    const idle = codexSession({
      lines: [
        codexLine({ at: "2026-10-07T08:00:00.000Z", output: 5, total: 900 }),
        capped,
        codexLine({ at: "2026-10-08T10:00:00.000Z", output: 5, total: 900 }),
      ],
    });
    expect(codexBurnOf({ problems: [], sessions: [{ fold: idle, path: "/idle.jsonl" }], window: WINDOW })).toEqual({
      activeSessions: 0,
      kind: "measured",
      outputTokens: 0,
      projectedWeekTokens: 0,
      sessions: 0,
      totalTokens: 0,
    });
  });

  it("is partial, naming the rollout, when its cumulative counter fell inside the window", () => {
    const fell = codexSession({
      lines: [
        codexLine({ at: "2026-10-08T10:00:00.000Z", output: 10, total: 5000 }),
        codexLine({ at: "2026-10-08T11:00:00.000Z", output: 2, total: 300 }),
      ],
    });
    const whole = codexSession({ lines: [codexLine({ at: "2026-10-08T10:00:00.000Z", output: 1, total: 100 })] });
    expect(
      codexBurnOf({
        problems: [],
        sessions: [
          { fold: fell, path: "/fell.jsonl" },
          { fold: whole, path: "/whole.jsonl" },
        ],
        window: WINDOW,
      }),
    ).toEqual({
      activeSessions: 0,
      kind: "partial",
      outputTokens: 1,
      problems: ["/fell.jsonl: its cumulative token counter fell inside the window"],
      sessions: 1,
      totalTokens: 100,
    });
  });

  it("is partial when the in-window total sits below the baseline before it", () => {
    const below = codexSession({
      lines: [
        codexLine({ at: "2026-10-07T08:00:00.000Z", output: 50, total: 9000 }),
        codexLine({ at: "2026-10-08T10:00:00.000Z", output: 10, total: 100 }),
      ],
    });
    expect(codexBurnOf({ problems: [], sessions: [{ fold: below, path: "/below.jsonl" }], window: WINDOW })).toEqual({
      activeSessions: 0,
      kind: "partial",
      outputTokens: 0,
      problems: ["/below.jsonl: its cumulative token counter fell across the window's start"],
      sessions: 0,
      totalTokens: 0,
    });
  });

  it("is partial when the counter falls just past the window's start and climbs back above the baseline", () => {
    const recovered = codexSession({
      lines: [
        codexLine({ at: "2026-10-07T08:00:00.000Z", output: 100, total: 1000 }),
        codexLine({ at: "2026-10-07T12:01:00.000Z", output: 10, total: 100 }),
        codexLine({ at: "2026-10-08T10:00:00.000Z", output: 150, total: 1500 }),
      ],
    });
    expect(
      codexBurnOf({ problems: [], sessions: [{ fold: recovered, path: "/recovered.jsonl" }], window: WINDOW }),
    ).toEqual({
      activeSessions: 0,
      kind: "partial",
      outputTokens: 0,
      problems: ["/recovered.jsonl: its cumulative token counter fell across the window's start"],
      sessions: 0,
      totalTokens: 0,
    });
  });

  it("is partial when a rollout's readings are not in time order, since its baseline is then uncertain", () => {
    const shuffled = codexSession({
      lines: [
        codexLine({ at: "2026-10-07T12:00:00.000Z", output: 10, total: 100 }),
        codexLine({ at: "2026-10-07T11:00:00.000Z", output: 5, total: 50 }),
        codexLine({ at: "2026-10-08T10:00:00.000Z", output: 15, total: 150 }),
      ],
    });
    expect(
      codexBurnOf({ problems: [], sessions: [{ fold: shuffled, path: "/shuffled.jsonl" }], window: WINDOW }),
    ).toEqual({
      activeSessions: 0,
      kind: "partial",
      outputTokens: 0,
      problems: ["/shuffled.jsonl: its token readings are not in time order"],
      sessions: 0,
      totalTokens: 0,
    });
  });

  it("is partial when a token_count line will not decode or carries no instant, even with no whole reading", () => {
    const torn = codexSession({ lines: ['{"timestamp":"2026-10-08T11:00:00.000Z","payload":{"type":"token_count"'] });
    const unstamped = codexSession({
      lines: [
        JSON.stringify({ payload: { info: null, type: "token_count" } }),
        codexLine({ at: "2026-10-08T10:00:00.000Z", output: 1, total: 100 }),
      ],
    });
    expect(
      codexBurnOf({
        problems: [],
        sessions: [
          { fold: torn, path: "/torn.jsonl" },
          { fold: unstamped, path: "/unstamped.jsonl" },
        ],
        window: WINDOW,
      }),
    ).toEqual({
      activeSessions: 0,
      kind: "partial",
      outputTokens: 0,
      problems: [
        "/torn.jsonl: a token_count line would not decode",
        "/unstamped.jsonl: a token_count line carried no timestamp",
      ],
      sessions: 0,
      totalTokens: 0,
    });
  });

  it("is partial when the output counter falls and recovers while the total never falls", () => {
    const outputFell = codexSession({
      lines: [
        codexLine({ at: "2026-10-07T11:00:00.000Z", output: 100, total: 1000 }),
        codexLine({ at: "2026-10-08T09:00:00.000Z", output: 110, total: 1100 }),
        codexLine({ at: "2026-10-08T10:00:00.000Z", output: 5, total: 1200 }),
        codexLine({ at: "2026-10-08T11:00:00.000Z", output: 130, total: 1300 }),
      ],
    });
    expect(codexBurnOf({ problems: [], sessions: [{ fold: outputFell, path: "/o.jsonl" }], window: WINDOW })).toEqual({
      activeSessions: 0,
      kind: "partial",
      outputTokens: 0,
      problems: ["/o.jsonl: its cumulative token counter fell inside the window"],
      sessions: 0,
      totalTokens: 0,
    });
  });

  it("is partial when a reading's counters will not read as counts, rather than falling back to the one before", () => {
    const stringly = codexSession({
      lines: [
        codexLine({ at: "2026-10-07T11:00:00.000Z", output: 100, total: 1000 }),
        codexLine({ at: "2026-10-08T10:00:00.000Z", output: 120, total: 1200 }),
        JSON.stringify({
          payload: { info: { total_token_usage: { output_tokens: 130, total_tokens: "1300" } }, type: "token_count" },
          timestamp: "2026-10-08T11:00:00.000Z",
          type: "event_msg",
        }),
      ],
    });
    expect(codexBurnOf({ problems: [], sessions: [{ fold: stringly, path: "/s.jsonl" }], window: WINDOW })).toEqual({
      activeSessions: 0,
      kind: "partial",
      outputTokens: 0,
      problems: ["/s.jsonl: a token_count reading's counters would not read"],
      sessions: 0,
      totalTokens: 0,
    });
  });
});

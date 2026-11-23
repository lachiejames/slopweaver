import { describe, expect, it } from "vitest";

import type { RefreshDeps } from "../../../../../cli/commands/refresh/deps.js";
import { emitRefreshSummary, emitSummaryLine } from "../../../../../cli/commands/refresh/summary.js";

/** One logger call, tagged with the channel it arrived on, so cross-channel ORDER is assertable too. */
type LoggerCall =
  | { readonly channel: "out"; readonly line: string }
  | { readonly channel: "warn" | "error" | "info"; readonly msg: string };

/** A plain capturing logger: every call on every channel lands in ONE ordered list. */
function capturingLogger(): { readonly calls: LoggerCall[]; readonly sink: RefreshDeps["logger"] } {
  const calls: LoggerCall[] = [];
  const sink: RefreshDeps["logger"] = {
    error: ({ msg }) => {
      calls.push({ channel: "error", msg });
    },
    info: ({ msg }) => {
      calls.push({ channel: "info", msg });
    },
    out: ({ line }) => {
      calls.push({ channel: "out", line });
    },
    warn: ({ msg }) => {
      calls.push({ channel: "warn", msg });
    },
  };
  return { calls, sink };
}

// Each text's wording belongs to a DIFFERENT level than the one it is sent at, so a router that read the
// channel off the words ("refused" means error, "wrote" means stdout) rather than off `level` fails.
describe("emitSummaryLine", () => {
  it("writes an `out` line to stdout as `{ line }` and touches no diagnostic channel", () => {
    const { calls, sink } = capturingLogger();
    emitSummaryLine({ level: "out", sink, text: "linear refused 7 page(s)" });
    expect(calls).toEqual([{ channel: "out", line: "linear refused 7 page(s)" }]);
  });

  it("writes a `warn` line to the warn diagnostic as `{ msg }`, never to stdout", () => {
    const { calls, sink } = capturingLogger();
    emitSummaryLine({ level: "warn", sink, text: "github wrote 41 record(s)" });
    expect(calls).toEqual([{ channel: "warn", msg: "github wrote 41 record(s)" }]);
  });

  it("writes an `error` line to the error diagnostic as `{ msg }`, never to warn or stdout", () => {
    const { calls, sink } = capturingLogger();
    emitSummaryLine({ level: "error", sink, text: "slack skipped 3 channel(s)" });
    expect(calls).toEqual([{ channel: "error", msg: "slack skipped 3 channel(s)" }]);
  });
});

describe("emitRefreshSummary", () => {
  const home = "/home-sentinel-quebec";

  it("emits every line verbatim, in order, each on its own channel, when numbers-only is off", () => {
    const { calls, sink } = capturingLogger();
    emitRefreshSummary({
      home,
      lines: [
        { level: "warn", text: "notion paused at /home-sentinel-quebec/corpus/bronze/notion after 12 page(s)" },
        { level: "out", text: "gmail wrote 88 record(s) through 2026-10-02T04:05:06.000Z" },
        { level: "error", text: "calendar failed 2 window(s) at /home-sentinel-quebec/corpus/bronze/calendar" },
        { level: "out", text: "fathom wrote 5 call(s)" },
      ],
      numbersOnly: false,
      sink,
    });
    expect(calls).toEqual([
      { channel: "warn", msg: "notion paused at /home-sentinel-quebec/corpus/bronze/notion after 12 page(s)" },
      { channel: "out", line: "gmail wrote 88 record(s) through 2026-10-02T04:05:06.000Z" },
      { channel: "error", msg: "calendar failed 2 window(s) at /home-sentinel-quebec/corpus/bronze/calendar" },
      { channel: "out", line: "fathom wrote 5 call(s)" },
    ]);
  });

  it("withholds every occurrence of the bronze path, and only it, when numbers-only is on", () => {
    const { calls, sink } = capturingLogger();
    emitRefreshSummary({
      home,
      lines: [
        {
          level: "out",
          // A DIFFERENT home's bronze path comes first, so a label read off the text rather than off `home`
          // withholds the wrong one.
          text:
            "github copied /home-decoy-romeo/corpus/bronze/github, then wrote 42 record(s) to " +
            "/home-sentinel-quebec/corpus/bronze/github and " +
            "/home-sentinel-quebec/corpus/bronze/github-reviews at 2026-10-01T03:04:05.000Z",
        },
        {
          level: "error",
          text: "slack lost 9 file(s) under /home-sentinel-quebec/corpus/bronze/slack; /home-sentinel-quebec/corpus/bronze unwritable",
        },
        // Every level carries the bronze path here, so sanitising cannot be keyed on the level.
        {
          level: "warn",
          text: "ledger kept at /home-sentinel-quebec/ledgers, 6 row(s) behind /home-sentinel-quebec/corpus/bronze",
        },
      ],
      numbersOnly: true,
      sink,
    });
    expect(calls).toEqual([
      {
        channel: "out",
        line:
          "github copied /home-decoy-romeo/corpus/bronze/github, then wrote 42 record(s) to [withheld]/github and " +
          "[withheld]/github-reviews at 2026-10-01T03:04:05.000Z",
      },
      { channel: "error", msg: "slack lost 9 file(s) under [withheld]/slack; [withheld] unwritable" },
      { channel: "warn", msg: "ledger kept at /home-sentinel-quebec/ledgers, 6 row(s) behind [withheld]" },
    ]);
  });

  // Line count and the first line's level are shared with the numbers-only case above, so neither can stand in
  // for the flag: only `numbersOnly` separates this verbatim summary from that withheld one. Each line's wording
  // also belongs to another level, so the channel cannot be read off the words either.
  it("keeps a three-line summary opening on stdout verbatim when numbers-only is off", () => {
    const { calls, sink } = capturingLogger();
    emitRefreshSummary({
      home,
      lines: [
        { level: "out", text: "drive refused 4 file(s) at /home-sentinel-quebec/corpus/bronze/drive" },
        { level: "error", text: "linear wrote 17 issue(s) to /home-sentinel-quebec/corpus/bronze/linear" },
        { level: "warn", text: "atlas copied 3 page(s)" },
      ],
      numbersOnly: false,
      sink,
    });
    expect(calls).toEqual([
      { channel: "out", line: "drive refused 4 file(s) at /home-sentinel-quebec/corpus/bronze/drive" },
      { channel: "error", msg: "linear wrote 17 issue(s) to /home-sentinel-quebec/corpus/bronze/linear" },
      { channel: "warn", msg: "atlas copied 3 page(s)" },
    ]);
  });

  // A numbers-only summary opening on a diagnostic rather than stdout, so withholding is never tied to the first
  // line's level as well as to the flag.
  it("withholds the bronze path from a one-line numbers-only summary opening on a warning", () => {
    const { calls, sink } = capturingLogger();
    emitRefreshSummary({
      home,
      lines: [{ level: "warn", text: "slack wrote 3 file(s) at /home-sentinel-quebec/corpus/bronze/slack" }],
      numbersOnly: true,
      sink,
    });
    expect(calls).toEqual([{ channel: "warn", msg: "slack wrote 3 file(s) at [withheld]/slack" }]);
  });

  // The same count and first level as the one-line case above, with the flag off, so withholding is never tied
  // to a summary being a single line either.
  it("keeps a one-line summary opening on a warning verbatim when numbers-only is off", () => {
    const { calls, sink } = capturingLogger();
    emitRefreshSummary({
      home,
      lines: [{ level: "warn", text: "notion wrote 8 page(s) at /home-sentinel-quebec/corpus/bronze/notion" }],
      numbersOnly: false,
      sink,
    });
    expect(calls).toEqual([
      { channel: "warn", msg: "notion wrote 8 page(s) at /home-sentinel-quebec/corpus/bronze/notion" },
    ]);
  });

  it("emits nothing at all for an empty summary", () => {
    const { calls, sink } = capturingLogger();
    emitRefreshSummary({ home, lines: [], numbersOnly: true, sink });
    expect(calls).toEqual([]);
  });
});

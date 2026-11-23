/*
 * `decodeClaudeWatch` against the verb's REAL parser, `parseClaudeWatchArgs` — run over the same tails, so a new
 * drift between the process-table decoder and the parser fails here instead of in a review: hand-picked tables,
 * repeated flags, the `--wait` reading, `--once`/`--dry-run`, and every short tail exhaustively. It was split out
 * when the process-snapshot suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { parseClaudeWatchArgs } from "../../../../../cli/commands/claude/watchArgs.js";
import { unwrap } from "../../../../../lib/result.js";
import { decodeClaudeWatch, type ProcessRow } from "../../../../../live/standing/processes.js";

describe("decodeClaudeWatch agrees with the verb's REAL parser on every tail", () => {
  // The two have drifted four ways before (`1e0`, an unknown flag, a trailing `--`, `--wait` as launch mode),
  // each a false NOT-running. This table runs the real parser and the
  // decoder over the same tails, so a new drift fails here instead of in a review.
  const tails: readonly (readonly string[])[] = [
    [],
    ["--interval", "5"],
    ["--interval=60"],
    ["--interval", "1e0"],
    ["--interval", "0"],
    ["--interval"],
    ["--interval", "--wait"],
    ["--interval="],
    ["--json"],
    ["--json=true"],
    ["--wait"],
    ["--waiting"],
    ["--not-a-flag"],
    ["120"],
    ["--"],
    ["--", "x"],
    ["--interval", "5", "--interval", "99"],
    ["--interval", "99", "--interval", "5"],
    ["--interval", "--wait", "--interval=5"],
    ["--interval", "--once", "--interval=5"],
    ["--interval", "--", "--interval=5"],
  ];

  it.each(tails)("accepts exactly when the parser does: %j", (...tail) => {
    const row: ProcessRow = { argv: ["node /wt/x/src/cli/index.ts claude watch", ...tail].join(" "), pid: 1, ppid: 0 };
    expect(decodeClaudeWatch({ row }) !== undefined).toBe(parseClaudeWatchArgs({ rest: tail }).isOk());
  });
});

describe("decodeClaudeWatch agrees with the parser when a flag repeats", () => {
  // `parseArgs` keeps the LAST value per switch, so `--json=true --json` is a running standing watch
  // the decoder refused, which hid it from the gauge and from admission. A repeated `--interval` is refused by
  // both, as the shared parser refuses any repeated value flag.
  const tails: readonly (readonly string[])[] = [
    ["--json=true", "--json"],
    ["--json", "--json=true"],
    ["--wait=x", "--wait"],
    ["--wait", "--wait=x"],
    ["--interval", "5", "--json=1", "--json"],
    ["--interval=99", "--interval", "5"],
    ["--interval=5=6"],
    ["--interval", "--"],
  ];

  it.each(tails)("accepts exactly when the parser does: %j", (...tail) => {
    const row: ProcessRow = { argv: ["node /wt/x/src/cli/index.ts claude watch", ...tail].join(" "), pid: 1, ppid: 0 };
    expect(decodeClaudeWatch({ row }) !== undefined).toBe(parseClaudeWatchArgs({ rest: tail }).isOk());
  });
});

describe("decodeClaudeWatch agrees with the parser on WHETHER a watch is queued, not only whether it runs", () => {
  // `waiting` once read `tokens.includes("--wait")`, so a `--wait` consumed as an interval value marked a
  // running writer as queued. That shape now needs a second `--interval`, which both refuse, so it sits in the
  // parser-agreement tables above rather than here.
  const tails: readonly (readonly string[])[] = [
    ["--wait"],
    ["--wait=x", "--wait"],
    ["--interval", "5", "--wait"],
    ["--json"],
  ];

  it.each(tails)("reads --wait exactly as the parser does: %j", (...tail) => {
    const row: ProcessRow = { argv: ["node /wt/x/src/cli/index.ts claude watch", ...tail].join(" "), pid: 1, ppid: 0 };
    expect(decodeClaudeWatch({ row })!.waiting).toBe(unwrap(parseClaudeWatchArgs({ rest: tail })).wait);
  });
});

describe("decodeClaudeWatch judges --once and --dry-run by the parser's reading", () => {
  // A `--once` consumed as an overwritten `--interval` value was a STANDING loop the old whole-argv
  // scan refused. Overwriting it needs a second `--interval`, which both now refuse, so that shape sits in the
  // parser-agreement tables; these are the switch readings a running watch can still carry.
  it.each([
    [["--interval", "5"], true],
    [["--once"], false],
    [["--dry-run"], false],
    [["--once=1", "--once"], false],
    [["--interval", "5", "--once"], false],
  ] as const)("%j is a standing watch: %s", (tail, standing) => {
    const row: ProcessRow = { argv: ["node /wt/x/src/cli/index.ts claude watch", ...tail].join(" "), pid: 1, ppid: 0 };
    const parsed = unwrap(parseClaudeWatchArgs({ rest: tail }));
    expect(decodeClaudeWatch({ row }) !== undefined).toBe(standing);
    expect(!parsed.once && !parsed.dryRun).toBe(standing);
  });
});

describe("decodeClaudeWatch agrees with the REAL parser on EVERY short tail — exhaustively", () => {
  // The decoder has drifted from the parser one hand-picked shape at a time (`1e0`, an unknown
  // flag, a trailing `--`, a repeated flag, a consumed `--wait`/`--once`/`--`). This enumerates every tail of
  // up to four tokens over an alphabet mixing flags, values, terminators and junk, and requires the decoder
  // to accept exactly the tails the parser accepts as a STANDING loop, with the same `--wait` reading.
  const ALPHABET = [
    "--interval",
    "5",
    "--",
    "--wait",
    "--json",
    "--json=x",
    "--once",
    "--dry-run",
    "--interval=7",
    "x",
  ];
  const tails: string[][] = [[]];
  for (let length = 1; length <= 4; length += 1) {
    for (const prefix of tails.filter((tail) => tail.length === length - 1)) {
      for (const token of ALPHABET) {
        tails.push([...prefix, token]);
      }
    }
  }

  it("finds no tail on which the two disagree", () => {
    const disagreements = tails.filter((tail) => {
      const row: ProcessRow = {
        argv: ["node /wt/x/src/cli/index.ts claude watch", ...tail].join(" "),
        pid: 1,
        ppid: 0,
      };
      const decoded = decodeClaudeWatch({ row });
      const parsed = parseClaudeWatchArgs({ rest: tail });
      const standing = parsed.isOk() && !parsed.value.once && !parsed.value.dryRun;
      const waitingAgrees = decoded === undefined || (parsed.isOk() && decoded.waiting === parsed.value.wait);
      return (decoded !== undefined) !== standing || !waitingAgrees;
    });
    expect(tails.length).toBe(11_111);
    expect(disagreements.map((tail) => tail.join(" "))).toStrictEqual([]);
  });
});

/*
 * `decodeClaudeWatch` over one row — read the way the loop was started, refusing every tail the verb's strict
 * parser refuses, holding the interval bounds `acceptedWatchInterval` applies on both sides, and splitting the argv
 * exactly at the spaces `ps` prints. It was split out when the process-snapshot suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { CLAUDE_WATCH_FLAG_NAMES, parseClaudeWatchArgs } from "../../../../../cli/commands/claude/watchArgs.js";
import {
  acceptedWatchInterval,
  decodeClaudeWatch,
  MAX_WATCH_INTERVAL_MINUTES,
  MIN_WATCH_INTERVAL_MINUTES,
  type ProcessRow,
  STANDING_WATCH_FLAGS,
} from "../../../../../live/standing/processes.js";

describe("decodeClaudeWatch — one row, read the way it was started", () => {
  const CWD = "/wt/keep-alive";
  const row = ({ args }: { args: string }): ProcessRow => ({
    argv: `node ${CWD}/bin/../src/cli/index.ts claude watch${args}`,
    pid: 4242,
    ppid: 100,
  });

  it("decodes the pid, parent, checkout and whether it is queued", () => {
    expect(decodeClaudeWatch({ row: row({ args: " --interval 5" }) })).toStrictEqual({
      cwd: CWD,
      pid: 4242,
      ppid: 100,
      waiting: false,
    });
    expect(decodeClaudeWatch({ row: row({ args: " --wait" }) })?.waiting).toBe(true);
  });

  it("does not read a path containing wait as the flag", () => {
    const path: ProcessRow = { argv: "node /wt/--wait/src/cli/index.ts claude watch", pid: 1, ppid: 0 };
    expect(decodeClaudeWatch({ row: path })?.waiting).toBe(false);
  });

  // `claude watch --waiting` read `live` for the second it took to load, though the strict parser
  // refuses it before anything runs. Every tail the parser refuses is a process that keeps nothing alive.
  it.each([" --waiting", " --not-a-flag", " 120", " --json=true", " --interval 5 extra", " -- x"])(
    "refuses a tail the verb's strict parser refuses:%s",
    (args) => {
      expect(decodeClaudeWatch({ row: row({ args }) })).toBe(undefined);
    },
  );

  it("mirrors exactly the flags the verb's parser accepts", () => {
    expect([...STANDING_WATCH_FLAGS].toSorted()).toStrictEqual([...CLAUDE_WATCH_FLAG_NAMES].toSorted());
  });

  it.each(["--dry-run", "--once", "--help", "-h"])("refuses %s, which is not a standing session", (flag) => {
    expect(decodeClaudeWatch({ row: row({ args: ` ${flag}` }) })).toBe(undefined);
  });

  it("refuses another verb, and another verb whose free text embeds the entrypoint and `claude watch`", () => {
    expect(decodeClaudeWatch({ row: { argv: `node ${CWD}/src/cli/index.ts claude gauge`, pid: 1, ppid: 0 } })).toBe(
      undefined,
    );
    const query = `node ${CWD}/src/cli/index.ts facts why does ${CWD}/src/cli/index.ts claude watch stall`;
    expect(decodeClaudeWatch({ row: { argv: query, pid: 1, ppid: 0 } })).toBe(undefined);
  });

  it.each([" --interval 1", " --interval=60"])("accepts%s", (args) => {
    expect(decodeClaudeWatch({ row: row({ args }) })?.pid).toBe(4242);
  });

  // Each exits at parse time rather than looping, so none can be a standing session. A repeated `--interval`
  // is refused whichever value comes last, because the verb's parser refuses it.
  it.each([
    " --interval 99 --interval 5",
    " --interval 0",
    " --interval 61",
    " --interval 1.5",
    " --interval",
    " --interval --wait",
    " --interval= ",
    " --interval 5 --interval 99",
  ])("refuses%s", (args) => {
    expect(decodeClaudeWatch({ row: row({ args }) })).toBe(undefined);
  });

  it("names the interval bounds the verb's parser enforces", () => {
    expect([MIN_WATCH_INTERVAL_MINUTES, MAX_WATCH_INTERVAL_MINUTES]).toStrictEqual([1, 60]);
  });
});

describe("acceptedWatchInterval — the one rule both sides apply", () => {
  it.each([
    ["1", 1],
    ["60", 60],
    ["05", 5],
  ])("accepts %s as %d minutes", (raw, minutes) => {
    expect(acceptedWatchInterval({ raw })).toBe(minutes);
  });

  it.each(["0", "61", "1e0", "0x5", "5.0", "", "-1"])("refuses %s", (raw) => {
    expect(acceptedWatchInterval({ raw })).toBe(undefined);
  });

  it("makes the classifier refuse exactly what the parser refuses", () => {
    const row: ProcessRow = { argv: "node /wt/x/src/cli/index.ts claude watch --interval 1e0", pid: 1, ppid: 0 };
    expect(decodeClaudeWatch({ row })).toBe(undefined);
  });
});

describe("decodeClaudeWatch — argv boundaries, as `ps` actually prints them", () => {
  const ENTRY = "node /wt/x/bin/../src/cli/index.ts claude watch";

  // MEASURED: real `ps -o args=` rows end in padding spaces. Splitting on single spaces without
  // trimming the end would turn that padding into empty arguments and read every running watch NOT running.
  it("accepts a real row's trailing padding", () => {
    expect(decodeClaudeWatch({ row: { argv: `${ENTRY} --interval 5             `, pid: 1, ppid: 0 } })?.pid).toBe(1);
    expect(decodeClaudeWatch({ row: { argv: `${ENTRY}          `, pid: 2, ppid: 0 } })?.pid).toBe(2);
  });

  // `--interval ' 5'` prints as `--interval  5`; collapsing whitespace rebuilt a valid `5` for an
  // invocation the parser refuses, and the gauge read it live.
  it("refuses a doubled space, which is an empty or space-led argument the parser refuses", () => {
    expect(decodeClaudeWatch({ row: { argv: `${ENTRY} --interval  5`, pid: 1, ppid: 0 } })).toBe(undefined);
    expect(decodeClaudeWatch({ row: { argv: `${ENTRY}  --wait`, pid: 1, ppid: 0 } })).toBe(undefined);
  });

  it("agrees with the parser that a space-led interval is refused", () => {
    const tail = ["--interval", " 5"];
    const row: ProcessRow = { argv: [ENTRY, ...tail].join(" "), pid: 1, ppid: 0 };
    expect(decodeClaudeWatch({ row }) !== undefined).toBe(parseClaudeWatchArgs({ rest: tail }).isOk());
  });
});

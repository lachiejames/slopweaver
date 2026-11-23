/*
 * `console batch`: its stdin read as argv arrays, the items it refuses to run, and one line per item carrying that
 * item's own exit code and output — the envelope never inside it.
 */
import { describe, expect, it } from "vitest";

import { logger } from "#lib/logger.js";
import { unwrap } from "#lib/result.js";

import {
  batchRefusal,
  type ConsoleBatchDeps,
  parseConsoleBatchInput,
  runConsoleBatch,
  runConsoleBatchVerb,
} from "../../../../../cli/commands/console/batch.js";
import { CONSOLE_BATCH_VERBS } from "../../../../../cli/commands/console/batchVerbs.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { NOUN_GROUPS } from "../../../../../cli/nounGroups.js";

/**
 * Seams for a batch whose items are run by `run`, its lines kept in `lines`, on a clock that ticks 5 ms a reading.
 *
 * @param run what one item's invocation does, given its full argv
 * @returns the seams, and the lines they collect
 */
function seams({ run }: { run: (argv: readonly string[]) => Promise<number> }): {
  deps: ConsoleBatchDeps;
  lines: string[];
  ran: (readonly string[])[];
} {
  const lines: string[] = [];
  const ran: (readonly string[])[] = [];
  let clock = 0;
  return {
    deps: {
      groups: NOUN_GROUPS,
      nowMs: () => {
        clock += 5;
        return clock;
      },
      runInvocation: (argv) => {
        ran.push(argv);
        return run(argv);
      },
      writeLine: (line) => {
        lines.push(line);
      },
    },
    lines,
    ran,
  };
}

describe("parseConsoleBatchInput", () => {
  it("reads one JSON array of argv arrays", () => {
    const parsed = parseConsoleBatchInput({ text: '[["queue","deferred","--json"],["board","--json"]]' });
    expect(unwrap(parsed)).toEqual([
      ["queue", "deferred", "--json"],
      ["board", "--json"],
    ]);
  });

  it("reads an empty array as a batch of nothing", () => {
    expect(unwrap(parseConsoleBatchInput({ text: "[]" }))).toEqual([]);
  });

  it("names input that is not JSON, not an array, or holds an item that is not a non-empty string array", () => {
    const problems = ["nope", '{"a":1}', "[[]]", '[["queue", 3]]', '["queue"]'].map((text) =>
      parseConsoleBatchInput({ text }).match(
        () => "parsed",
        (errors) => errors.join(" "),
      ),
    );
    expect(problems[0]).toContain("console batch: stdin is not JSON");
    expect(problems.slice(1)).toEqual([
      "console batch: stdin must be one JSON array of argv arrays",
      "console batch: item 0 is not a non-empty array of strings",
      "console batch: item 0 is not a non-empty array of strings",
      "console batch: item 0 is not a non-empty array of strings",
    ]);
  });
});

describe("batchRefusal", () => {
  it("lets a registered read verb run", () => {
    expect(batchRefusal({ argv: ["node", "slopweaver", "queue", "deferred", "--json"], groups: NOUN_GROUPS })).toBe(
      undefined,
    );
  });

  it("refuses an item naming no registered verb, a noun alone included, so no default verb runs a stray word", () => {
    expect([
      batchRefusal({ argv: ["node", "slopweaver", "nope", "verb"], groups: NOUN_GROUPS }),
      batchRefusal({ argv: ["node", "slopweaver", "queue"], groups: NOUN_GROUPS }),
      batchRefusal({ argv: ["node", "slopweaver", "queue", "--json"], groups: NOUN_GROUPS }),
    ]).toEqual([
      "console batch: `nope verb` names no registered verb, so it was not run",
      "console batch: `queue` names no registered verb, so it was not run",
      "console batch: `queue --json` names no registered verb, so it was not run",
    ]);
  });

  it("refuses a batch inside a batch, and a verb that writes outside this machine", () => {
    expect([
      batchRefusal({ argv: ["node", "slopweaver", "console", "batch"], groups: NOUN_GROUPS }),
      batchRefusal({ argv: ["node", "slopweaver", "slack", "post", "--help"], groups: NOUN_GROUPS }),
    ]).toEqual([
      "console batch: a batch never runs another batch",
      "console batch: `slack post --help` writes outside this machine, so it was refused rather than run in a batch",
    ]);
  });

  it("refuses a registered local verb the console does not read, and a listed noun's other verbs", () => {
    expect([
      batchRefusal({ argv: ["node", "slopweaver", "dev", "gate"], groups: NOUN_GROUPS }),
      batchRefusal({ argv: ["node", "slopweaver", "slack", "draft", "record", "--json"], groups: NOUN_GROUPS }),
    ]).toEqual([
      "console batch: `dev gate` is not one of the console's read verbs a batch runs, so it was not run",
      "console batch: `slack draft record --json` is not one of the console's read verbs a batch runs, so it was not run",
    ]);
  });

  it("lets every listed verb run, each one a registered verb that writes nothing outside this machine", () => {
    expect(CONSOLE_BATCH_VERBS.length).toBeGreaterThan(0);
    const refused = CONSOLE_BATCH_VERBS.map((words) =>
      batchRefusal({ argv: ["node", "slopweaver", ...words], groups: NOUN_GROUPS }),
    ).filter((refusal) => refusal !== undefined);
    expect(refused).toEqual([]);
  });
});

describe("runConsoleBatch", () => {
  it("writes one line per item, in order, each with its own exit code, stdout and stderr", async () => {
    const { deps, lines, ran } = seams({
      run: async (argv) => {
        if (argv[3] === "deferred") {
          logger.out({ line: '{"rows":[]}' });
          return 0;
        }
        process.stderr.write("bad flag\n");
        return 2;
      },
    });
    await runConsoleBatch({
      deps,
      items: [
        ["queue", "deferred", "--json"],
        ["queue", "list", "--nope"],
      ],
    });
    expect(ran).toEqual([
      ["node", "slopweaver", "queue", "deferred", "--json"],
      ["node", "slopweaver", "queue", "list", "--nope"],
    ]);
    expect(lines.map((line): unknown => JSON.parse(line))).toEqual([
      { err: "", exitCode: 0, index: 0, out: '{"rows":[]}\n', tookMs: 5 },
      { err: "bad flag\n", exitCode: 2, index: 1, out: "", tookMs: 5 },
    ]);
  });

  it("answers a refused item with a usage line and never runs it", async () => {
    const { deps, lines, ran } = seams({ run: async () => 0 });
    await runConsoleBatch({ deps, items: [["slack", "post", "--help"]] });
    expect(ran).toEqual([]);
    expect(lines.map((line): unknown => JSON.parse(line))).toEqual([
      {
        err: "console batch: `slack post --help` writes outside this machine, so it was refused rather than run in a batch",
        exitCode: EXIT_USAGE,
        index: 0,
        out: "",
        tookMs: 5,
      },
    ]);
  });
});

describe("runConsoleBatchVerb", () => {
  it("runs every item and exits 0 whatever each item exited with", async () => {
    const { deps, lines } = seams({ run: async () => 1 });
    const code = await runConsoleBatchVerb({ deps, readInput: async () => '[["queue","deferred"]]', rest: [] });
    expect([code, lines.length]).toEqual([EXIT_OK, 1]);
  });

  it("refuses arguments and malformed input as usage, and an unreadable stdin as an error, running nothing", async () => {
    const { deps, ran } = seams({ run: async () => 0 });
    const codes = [
      await runConsoleBatchVerb({ deps, readInput: async () => "[]", rest: ["--json"] }),
      await runConsoleBatchVerb({ deps, readInput: async () => "{}", rest: [] }),
      await runConsoleBatchVerb({
        deps,
        readInput: async () => {
          throw new Error("closed");
        },
        rest: [],
      }),
    ];
    expect(codes).toEqual([EXIT_USAGE, EXIT_USAGE, EXIT_ERROR]);
    expect(ran).toEqual([]);
  });
});

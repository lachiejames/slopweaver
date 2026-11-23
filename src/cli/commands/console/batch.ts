/**
 * `slopweaver console batch` — several verbs run in ONE process, one JSON line out per verb as each finishes.
 *
 * Why it exists, MEASURED on the owner's 10-core machine at load 14.7: the console voice's record read
 * (`site/app/api/voice-record/route.ts`) spawned fifteen `bin/slopweaver` children at once, and they cost 20.7 s of
 * CPU between them although most print under 110 bytes — each child paid its own Node boot and module graph, about
 * 1.1 s of CPU in the ESM loader alone for `queue list --json`. The same fifteen verbs run in one process cost 4.95 s
 * of CPU. At load 28 to 66 those fifteen boots were what timed the whole read out. Reproduce: `/usr/bin/time -p
 * slopweaver queue list --json`, then the same argv as one item of a batch, and compare user + sys.
 *
 * Each item runs through `main` (`../../main.ts`), so the owner's standing-ruling gate and the stale-seat path run
 * per verb exactly as for a process of its own, inside {@link runCliInvocation}'s normalisation and pending-effect
 * settle. Its stdout and stderr are collected for it alone (`#lib/outputCollect.js`), then its line is written
 * outside that scope, so the envelope is never part of its own output.
 *
 * Two limits that are this verb's construction, not an oversight. The built-CLI staleness guard runs once, for the
 * process, so a rebuild beginning mid-batch cannot swap the modules already loaded. And nothing bounds one item but
 * the caller's kill of the whole process: an item that hangs holds every item after it, which is why the console
 * groups its reads by measured cost rather than sending all of them in one batch.
 */

import { logger } from "#lib/logger.js";
import { collectOutput } from "#lib/outputCollect.js";
import { readStdin } from "#lib/readStdin.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";

import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { main, runCliInvocation } from "../../main.js";
import { canonicalArgv } from "../../nounAliases.js";
import { NOUN_GROUPS } from "../../nounGroups.js";
import type { NounGroups } from "../../router.js";
import { CONSOLE_BATCH_USAGE } from "./batchUsage.js";
import { CONSOLE_BATCH_VERBS } from "./batchVerbs.js";

/** How much of one item's stderr its line keeps: the closing lines say why it failed; the bound is memory. */
const ITEM_STDERR_KEPT_CHARS = 64 * 1024;

/** The argv a process launched as `slopweaver` carries ahead of the noun, so an item reads as its own invocation. */
const ARGV_HEAD: readonly string[] = ["node", "slopweaver"];

/** One item's line: what it exited with, everything it printed, the tail of what it said on stderr, how long it took. */
export interface ConsoleBatchLine {
  readonly index: number;
  readonly exitCode: number;
  readonly out: string;
  readonly err: string;
  readonly tookMs: number;
}

/** What the batch touches outside itself. */
export interface ConsoleBatchDeps {
  /** The noun registry an item is looked up in. */
  readonly groups: NounGroups;
  /** Runs one full process argv to an exit code — `runCliInvocation` over `main` in production. */
  readonly runInvocation: (argv: readonly string[]) => Promise<number>;
  /** Where each item's line goes. */
  readonly writeLine: (line: string) => void;
  /** A monotonic clock, in milliseconds. */
  readonly nowMs: () => number;
}

/**
 * Read the batch's stdin: one JSON array of argv arrays, each the words after `slopweaver`, none empty.
 *
 * @param text everything stdin carried
 * @returns the items, or why the input is not a batch
 */
export function parseConsoleBatchInput({ text }: { text: string }): Result<readonly (readonly string[])[]> {
  let value: unknown;
  try {
    value = safeJsonParse({ label: "console batch stdin", text });
  } catch (cause: unknown) {
    return err([`console batch: stdin is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`]);
  }
  if (!Array.isArray(value)) {
    return err(["console batch: stdin must be one JSON array of argv arrays"]);
  }
  const items: (readonly string[])[] = [];
  for (const [index, item] of value.entries()) {
    if (!Array.isArray(item) || item.length === 0 || !item.every((word): word is string => typeof word === "string")) {
      return err([`console batch: item ${String(index)} is not a non-empty array of strings`]);
    }
    items.push(item);
  }
  return ok(items);
}

/**
 * Why one item may not run in a batch, or `undefined` when it may. It must name a REGISTERED verb outright — a
 * noun's default verb would let an unknown second word run as that default's argument — whose effect is not
 * external-write, it may not be a batch itself, and it must begin with one of {@link CONSOLE_BATCH_VERBS}: a
 * registered `local-state` verb can still write past the collector, so only a verb witnessed to print the same
 * bytes in a batch as on its own runs in one.
 *
 * @param argv the item's full process argv, its noun already the current name
 * @returns the refusal sentence, or `undefined`
 */
export function batchRefusal({ argv, groups }: { argv: readonly string[]; groups: NounGroups }): string | undefined {
  const noun = argv[2];
  const verb = argv[3];
  const entry = noun === undefined || verb === undefined ? undefined : groups[noun]?.[verb];
  const named = `\`${argv.slice(2).join(" ")}\``;
  if (entry === undefined) {
    return `console batch: ${named} names no registered verb, so it was not run`;
  }
  if (noun === "console" && verb === "batch") {
    return "console batch: a batch never runs another batch";
  }
  if (entry.meta.effect === "external-write") {
    return `console batch: ${named} writes outside this machine, so it was refused rather than run in a batch`;
  }
  const words = argv.slice(2);
  const listed = CONSOLE_BATCH_VERBS.some((prefix) => prefix.every((word, at) => words[at] === word));
  if (!listed) {
    return `console batch: ${named} is not one of the console's read verbs a batch runs, so it was not run`;
  }
  return undefined;
}

/**
 * Run every item in turn, each with its output collected, and write its line as it finishes.
 *
 * @param items the argv after `slopweaver` of each verb, in the order they run
 */
export async function runConsoleBatch({
  deps,
  items,
}: {
  deps: ConsoleBatchDeps;
  items: readonly (readonly string[])[];
}): Promise<void> {
  for (const [index, item] of items.entries()) {
    const startedMs = deps.nowMs();
    const argv = canonicalArgv({ argv: [...ARGV_HEAD, ...item] });
    const refusal = batchRefusal({ argv, groups: deps.groups });
    let line: ConsoleBatchLine;
    if (refusal === undefined) {
      const ran = await collectOutput({
        keepErrChars: ITEM_STDERR_KEPT_CHARS,
        run: () => deps.runInvocation(argv),
      });
      line = { err: ran.err, exitCode: ran.value, index, out: ran.out, tookMs: Math.round(deps.nowMs() - startedMs) };
    } else {
      line = { err: refusal, exitCode: EXIT_USAGE, index, out: "", tookMs: Math.round(deps.nowMs() - startedMs) };
    }
    deps.writeLine(safeJsonStringify({ label: "console batch line", value: line }));
  }
}

/**
 * Run `console batch` against injected seams.
 *
 * @param rest the argv tail after `console batch`
 * @param readInput reads the whole of stdin
 * @returns the process exit code: 0 once every item has its line, whatever each exited with
 */
export async function runConsoleBatchVerb({
  rest,
  deps,
  readInput,
}: {
  rest: readonly string[];
  deps: ConsoleBatchDeps;
  readInput: () => Promise<string>;
}): Promise<number> {
  if (rest.length > 0) {
    logger.error({ msg: `console batch takes no arguments; got ${rest.join(" ")}` });
    logger.error({ msg: CONSOLE_BATCH_USAGE });
    return EXIT_USAGE;
  }
  let text: string;
  try {
    text = await readInput();
  } catch (cause: unknown) {
    logger.error({
      msg: `console batch: stdin could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
    return EXIT_ERROR;
  }
  const items = parseConsoleBatchInput({ text });
  if (items.isErr()) {
    items.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: CONSOLE_BATCH_USAGE });
    return EXIT_USAGE;
  }
  await runConsoleBatch({ deps, items: items.value });
  return EXIT_OK;
}

/** `slopweaver console batch`. */
export const consoleBatchCommand = defineCommand({
  run: (argv) =>
    runConsoleBatchVerb({
      deps: {
        groups: NOUN_GROUPS,
        nowMs: () => performance.now(),
        runInvocation: (full) => runCliInvocation({ argv: full, run: main }),
        writeLine: (line) => {
          logger.out({ line });
        },
      },
      readInput: () => readStdin(),
      rest: argv.slice(4),
    }),
});

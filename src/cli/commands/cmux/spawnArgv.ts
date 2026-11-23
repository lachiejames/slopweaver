/**
 * Every `cmux spawn` refusal that needs the argv alone: flag parsing, the slug, `--model`, an `--effort` level, the
 * worktree flags, `--wait`/`--timeout-seconds` and `--harness`.
 *
 * One leaf, run FIRST, because an omitted `--driver` reads the plan register to choose a host, and that read can fail
 * or be slow. A malformed argv is a usage error whatever the store is doing, so none of these may sit behind it —
 * Codex review r1 (`r1-spawn-order`) and plan p3 each found one that did.
 */
import { logger } from "../../../lib/logger.js";
import { type HarnessName, parseHarnessFlag } from "../../../sessionHarness/harnessChoice.js";
import { parseWaitOptions, type WaitOptions } from "../../../wait/flags.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { cmuxUsage, parseCmuxVerb, stringFlag } from "./core.js";
import { refuseSpawnArgv } from "./spawnPins.js";
import { type SpawnWorktreeOptions, spawnWorktreeOptions } from "./spawnWorktreeOptions.js";

/** What the argv alone settled, once every argv-only refusal has declined. */
export interface SpawnArgv {
  readonly argvPins: { readonly effort: string | undefined; readonly model: string };
  /** `--harness`: where the session opens — a cmux workspace, or a card in the desktop app. */
  readonly harness: HarnessName;
  readonly parsed: ParsedFlags;
  readonly slug: string;
  readonly wait: WaitOptions;
  readonly worktree: SpawnWorktreeOptions;
}

/**
 * Parse a spawn's argv and run every refusal that needs nothing else.
 *
 * @param argv the full process argv
 * @returns what the argv settled, or the exit code to stop on
 */
export function resolveSpawnArgv({ argv }: { argv: readonly string[] }): SpawnArgv | number {
  const parsed = parseCmuxVerb({ argv, verb: "spawn" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const slug = parsed.positionals[0];
  if (slug === undefined) {
    logger.error({ msg: "cmux spawn: a handover slug is required" });
    logger.error({ msg: cmuxUsage({ verb: "spawn" }) });
    return EXIT_USAGE;
  }
  const argvPins = refuseSpawnArgv({ parsed, slug });
  if (typeof argvPins === "number") {
    return argvPins;
  }
  const worktree = spawnWorktreeOptions({ parsed });
  if (typeof worktree === "number") {
    return worktree;
  }
  const wait = parseWaitOptions({ values: parsed.values });
  if (wait.isErr()) {
    logger.error({ msg: `cmux spawn: ${wait.error.join("; ")}` });
    return EXIT_USAGE;
  }
  const harness = parseHarnessFlag({ value: stringFlag({ name: "harness", parsed }) });
  if (harness.isErr()) {
    logger.error({ msg: `cmux spawn: ${harness.error}` });
    logger.error({ msg: cmuxUsage({ verb: "spawn" }) });
    return EXIT_USAGE;
  }
  return { argvPins, harness: harness.value, parsed, slug, wait: wait.value, worktree };
}

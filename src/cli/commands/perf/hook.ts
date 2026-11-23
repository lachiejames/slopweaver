/**
 * `slopweaver perf hook <name>` — the second drill-down: one hook across every seat.
 *
 * The poll gate is the stall of that pass found by hand, which is the question this verb
 * answers without the owner: `slopweaver perf hook poll-gate`. The name is taken with or without the
 * `pretooluse-` prefix, because that is how the shim is spelled in `hooks/hooks.json` and not how anybody
 * says it.
 */
import { logger } from "../../../lib/logger.js";
import { perfHookLines } from "../../../live/perf/render.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parsePerfArgs, perfReading, windowMinutesOf } from "./core.js";

export const PERF_HOOK_USAGE =
  "usage: slopweaver perf hook <name> [--window-minutes <n>] [--json]\n" +
  "  One hook across the fleet: every seat with it live and for how long, whether that crossed the stall\n" +
  "  line, and how many frames of each hook EVENT the window held. <name> takes `poll-gate` or the full\n" +
  "  `pretooluse-poll-gate`. Only the LONGEST live hook per seat is attributable to a script, so a shorter\n" +
  "  one running beside it is counted in that seat's boot total and named by no row.";

/** Where this verb's own flags start in `process.argv`. */
const HOOK_ARG_OFFSET = 4;

/**
 * The full script stem behind a name a caller typed.
 *
 * @param name the name as typed, with or without the shim's own prefix
 * @returns the stem `fleetLoad.hookScriptOf` produces
 */
export function hookScriptStem({ name }: { name: string }): string {
  const trimmed = name.trim().replace(/\.(?:sh|ts)$/u, "");
  if (trimmed.startsWith("pretooluse-") || trimmed.startsWith("posttooluse-")) {
    return trimmed;
  }
  return `pretooluse-${trimmed}`;
}

/**
 * Run `slopweaver perf hook`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runPerfHook(argv: readonly string[]): number {
  const rest = argv.slice(HOOK_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PERF_HOOK_USAGE });
    return EXIT_OK;
  }
  const parsed = parsePerfArgs({ allowPositionals: true, rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: PERF_HOOK_USAGE });
    return EXIT_USAGE;
  }
  const name = parsed.value.positionals[0];
  if (name === undefined) {
    logger.error({ msg: "perf hook: name the hook — `poll-gate`, or the full `pretooluse-poll-gate`" });
    logger.error({ msg: PERF_HOOK_USAGE });
    return EXIT_USAGE;
  }
  let reading;
  try {
    reading = perfReading({ windowMinutes: windowMinutesOf({ values: parsed.value.values }) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error({ msg: `perf hook: the machine or the cmux event log could not be read — ${detail}` });
    return EXIT_ERROR;
  }
  const script = hookScriptStem({ name });
  if (parsed.value.values["json"] === true) {
    logger.out({
      line: JSON.stringify({
        byName: reading.stream.byName,
        live: reading.report.seats.filter((seat) => seat.stallScript === script),
        script,
      }),
    });
    return EXIT_OK;
  }
  for (const line of perfHookLines({ report: reading.report, script, stream: reading.stream })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const perfHookCommand = defineCommand({ run: runPerfHook });

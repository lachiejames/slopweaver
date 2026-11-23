/**
 * `slopweaver machine unused` — how much of each Claude plan, each Codex plan and the machine went unused over
 * the last N days, read off histories this machine already wrote. Effectful shell only: the arithmetic is
 * `../../../capacity/unused.ts`, the reads `../../../capacity/unusedRead.ts`.
 */
import { measureUnusedCapacity } from "../../../capacity/unused.js";
import { readUnusedHistories } from "../../../capacity/unusedRead.js";
import { renderUnusedLines } from "../../../capacity/unusedRender.js";
import { slopweaverHome } from "../../../config.js";
import { type Logger, logger } from "../../../lib/logger.js";
import { type PlanRegisterPort, planRegisterPort } from "../../../plans/port.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";

export const MACHINE_UNUSED_USAGE =
  "usage: slopweaver machine unused [--days <n>] [--home <dir>] [--json]\n" +
  "  How much of each Claude plan's five-hour, weekly and Fable windows, each Codex plan's windows and the\n" +
  "  machine's load hold went unused over the last --days (default 7). A plan window that reset inside the span\n" +
  "  reports 100 minus the highest reading seen in it — an UPPER bound on what it left, since use can rise after\n" +
  "  the last reading — and one still open reports what is unused now. A stretch with no reading is unknown,\n" +
  "  never counted as unused. Reads claude watch's drawdown journal, every registered Codex home's rollout\n" +
  "  logs and the supervisor tick ledger; probes no provider.";

const FLAGS: FlagSpec = { boolean: ["json"], string: ["days", "home"] };

/** The span a bare call measures — the owner's own seven days. */
const DEFAULT_DAYS = 7;

/** `--`-prefixed, for the help-truth ratchet. */
export const MACHINE_UNUSED_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: FLAGS }),
  ...booleanFlagsOf({ spec: FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `machine unused`'s flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after the verb
 * @returns the parsed flags, or the parse errors
 */
export function parseMachineUnusedArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: FLAGS });
}

/** `--days` as a whole number of days, or the reason it is not one. */
function daysOf({ raw }: { raw: unknown }): number | string {
  if (raw === undefined) {
    return DEFAULT_DAYS;
  }
  if (typeof raw !== "string") {
    return "--days must be a whole number of days, at least 1 (got no value)";
  }
  const days = Number(raw);
  if (!Number.isSafeInteger(days) || days < 1) {
    return `--days must be a whole number of days, at least 1 (got ${raw})`;
  }
  return days;
}

/**
 * Run `machine unused` over an injected logger and clock.
 *
 * @param argv the full process argv (the verb tail starts at index 4 — `machine unused <tail>`)
 * @param log the diagnostic and data sinks
 * @param nowIso the span's end
 * @param port where the plan register naming the Codex destinations is read
 * @returns `EXIT_OK`, or `EXIT_USAGE` on a bad flag
 */
export async function runMachineUnusedWithDeps({
  argv,
  log,
  nowIso,
  port,
}: {
  argv: readonly string[];
  log: Pick<Logger, "error" | "out">;
  nowIso: string;
  port: PlanRegisterPort;
}): Promise<number> {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    log.out({ line: MACHINE_UNUSED_USAGE });
    return EXIT_OK;
  }
  const parsed = parseMachineUnusedArgs({ rest });
  if (parsed.isErr()) {
    [...parsed.error, MACHINE_UNUSED_USAGE].forEach((msg) => {
      log.error({ msg });
    });
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  const days = daysOf({ raw: values["days"] });
  if (typeof days === "string") {
    log.error({ msg: days });
    return EXIT_USAGE;
  }
  let home = slopweaverHome();
  if (typeof values["home"] === "string") {
    home = values["home"];
  }
  const fromIso = new Date(Date.parse(nowIso) - days * 24 * 60 * 60 * 1000).toISOString();
  const histories = await readUnusedHistories({ days, home, port });
  const report = measureUnusedCapacity({ ...histories, fromIso, toIso: nowIso });
  if (values["json"] === true) {
    log.out({ line: JSON.stringify(report) });
    return EXIT_OK;
  }
  for (const line of renderUnusedLines({ report })) {
    log.out({ line });
  }
  return EXIT_OK;
}

/**
 * Run the `machine unused` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code — see {@link runMachineUnusedWithDeps}
 */
export async function runMachineUnused(argv: readonly string[]): Promise<number> {
  return runMachineUnusedWithDeps({ argv, log: logger, nowIso: new Date().toISOString(), port: planRegisterPort() });
}

export const machineUnusedCommand = defineCommand({ run: runMachineUnused });

/**
 * `slopweaver monitor list` — the declared monitors, what each reads, and what makes each one stop.
 *
 * Deliberately a DECLARATION read rather than a pass: it opens no ledger and reaches no clock, so it answers
 * instantly and can be quoted in a skill without anyone worrying about what it touched. `monitor check` is
 * the one that looks.
 */
import { MONITORS, type MonitorDefinition } from "../../../monitor/registry.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { LIST_USAGE, parseMonitorListArgs, VERB_ARG_OFFSET } from "./core.js";
import { type MonitorDeps, productionMonitorDeps } from "./deps.js";

/**
 * Run `monitor list` against injected seams.
 *
 * @param rest the argv tail after `monitor list`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runMonitorList({ rest, deps }: { rest: readonly string[]; deps: MonitorDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(LIST_USAGE);
    return EXIT_OK;
  }
  const parsed = parseMonitorListArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(LIST_USAGE);
    return EXIT_USAGE;
  }
  if (parsed.value.values["json"] === true) {
    MONITORS.forEach((monitor) => {
      deps.writeOut(
        JSON.stringify({
          blurb: monitor.blurb,
          delivers: deliveryOf({ monitor }),
          id: monitor.id,
          prefix: monitor.prefix,
          resolves: monitor.resolves,
          source: monitor.source,
        }),
      );
    });
    return EXIT_OK;
  }
  MONITORS.forEach((monitor) => {
    deps.writeOut(`${monitor.id}  ${monitor.blurb}`);
    deps.writeOut(`    reads ${monitor.source}`);
    deps.writeOut(`    clears when ${monitor.resolves}`);
    deps.writeOut(`    delivers ${deliveryOf({ monitor })}`);
  });
  return EXIT_OK;
}

/**
 * How one monitor's card reaches the owner: a note that asks nothing, a card that floats its own note, or a card the
 * push lane announces.
 *
 * @param monitor one declared monitor
 * @returns the delivery, in a few words
 */
function deliveryOf({ monitor }: { monitor: MonitorDefinition }): string {
  if (monitor.notice !== undefined) {
    return "a floating note that asks nothing — on no queue";
  }
  if (monitor.floats === true) {
    return "a card that floats its own note under --fire";
  }
  return "a card, announced by --push";
}

/** `slopweaver monitor list`. */
export const monitorListCommand = defineCommand({
  run: (argv) => runMonitorList({ deps: productionMonitorDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

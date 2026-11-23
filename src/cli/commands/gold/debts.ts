/**
 * `slopweaver gold debts` — read the gold-debt ledger back, oldest debt first.
 *
 * Reads local state and nothing else: no network, no model. The ORDER is the register's own
 * (`../../../goldDebt/query.ts`'s fold) rather than this verb's, so any later surface reading the same
 * register puts the same debt at the top.
 *
 * `--json` emits one object per line rather than one array, and that is the `whole-file-json` rule rather
 * than a style: this register grows for as long as the installation lands pull requests.
 *
 * It prints what gold WOULD be and what is blocking it, and it never judges whether the blocker has passed.
 * The reader does that — see `../../../goldDebt/types.ts` on why no predicate could.
 */
import { goldDebtId } from "../../../goldDebt/pull.js";
import { filterGoldDebts, foldGoldDebts, isOpenDebt } from "../../../goldDebt/query.js";
import { readGoldDebtLedger } from "../../../goldDebt/store.js";
import type { GoldDebt, GoldDebtRow } from "../../../goldDebt/types.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { DEBTS_USAGE, parseGoldDebtsArgs, VERB_ARG_OFFSET } from "./core.js";
import { boolFlag, textFlag } from "./flags.js";

/** Everything `gold debts` touches outside itself, injected so a test drives the whole verb. */
export interface GoldDebtsDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** Which slice of the register a flag combination asks for. `--all` wins, because it is the wider ask. */
function requestedState({ all, settled }: { all: boolean; settled: boolean }): "open" | "settled" | "all" {
  if (all) {
    return "all";
  }
  if (settled) {
    return "settled";
  }
  return "open";
}

/** What a debt is called in the list: its own title when it was recorded, else the URL that always is. */
function debtLabel({ debt }: { debt: GoldDebtRow }): string {
  if (debt.title === undefined) {
    return debt.pullRequest;
  }
  return debt.title;
}

/** The lines one debt prints in the human view. */
function humanLines({ entry }: { entry: GoldDebt }): readonly string[] {
  const { debt } = entry;
  const id = goldDebtId({ pullRequest: debt.pullRequest });
  const named = debtLabel({ debt });
  const head = `${debt.mergedIso}  ${id}  merged ${debt.grade}  ${named}`;
  const body = [`    would be: ${debt.wouldBe}`, `    blocked on: ${debt.blockedOn}`];
  const { settlement } = entry;
  if (settlement === undefined) {
    return [head, ...body];
  }
  return [head, ...body, `    settled ${settlement.settledIso} as ${settlement.verdict}: ${settlement.evidence}`];
}

/**
 * Run `gold debts` against injected seams.
 *
 * @param rest the argv tail after `gold debts`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runGoldDebts({ rest, deps }: { rest: readonly string[]; deps: GoldDebtsDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(DEBTS_USAGE);
    return EXIT_OK;
  }
  const parsed = parseGoldDebtsArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(DEBTS_USAGE);
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  const home = textFlag({ name: "home", values });
  const stored = readGoldDebtLedger(home === undefined ? {} : { home });
  if (stored.isErr()) {
    deps.writeDiagnostic(`gold debts: ${stored.error.message}`);
    return EXIT_ERROR;
  }
  const folded = foldGoldDebts({ records: stored.value });
  if (folded.isErr()) {
    deps.writeDiagnostic(`gold debts: ${folded.error.message}`);
    return EXIT_ERROR;
  }
  const state = requestedState({
    all: boolFlag({ name: "all", values }),
    settled: boolFlag({ name: "settled", values }),
  });
  const debts = filterGoldDebts({
    debts: folded.value,
    repo: textFlag({ name: "repo", values }),
    state,
  });
  if (boolFlag({ name: "json", values })) {
    debts.forEach((entry) => {
      deps.writeOut(JSON.stringify(entry));
    });
    return EXIT_OK;
  }
  if (debts.length === 0) {
    deps.writeOut(`gold debts: no ${state} gold debt matches`);
    return EXIT_OK;
  }
  debts.forEach((entry) => {
    humanLines({ entry }).forEach((line) => {
      deps.writeOut(line);
    });
  });
  const open = debts.filter((entry) => isOpenDebt({ entry })).length;
  deps.writeOut(`${String(open)} of ${String(debts.length)} still open — settle one with \`slopweaver gold settle\``);
  return EXIT_OK;
}

/**
 * The real seams: the two output channels.
 *
 * @returns the production dependencies for {@link runGoldDebts}
 */
export function productionGoldDebtsDeps(): GoldDebtsDeps {
  return {
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver gold debts`. */
export const goldDebtsCommand = defineCommand({
  run: (argv) => runGoldDebts({ deps: productionGoldDebtsDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

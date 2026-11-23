/**
 * `slopweaver gold owe` — record that one merged pull request still owes its gold proof.
 *
 * Writes local state and nothing else: no network, no model. It is run AFTER a landing, never before, and
 * nothing anywhere consults the register it writes to before a merge — the owner's ruling is that merging is
 * not delayed and the debt is remembered instead (`../../../goldDebt/types.ts`).
 */
import { buildGoldDebt } from "../../../goldDebt/row.js";
import { appendGoldDebtRecord } from "../../../goldDebt/store.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { OWE_USAGE, parseGoldOweArgs, VERB_ARG_OFFSET } from "./core.js";
import { boolFlag, textFlag, textFlagOr } from "./flags.js";

/** Everything `gold owe` touches outside itself, injected so a test drives the whole verb. */
export interface GoldOweDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The instant this run happens at, as an ISO-8601 string. Injected so a test is not a clock. */
  readonly now: () => string;
}

/**
 * Run `gold owe` against injected seams.
 *
 * @param rest the argv tail after `gold owe`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runGoldOwe({ rest, deps }: { rest: readonly string[]; deps: GoldOweDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(OWE_USAGE);
    return EXIT_OK;
  }
  const parsed = parseGoldOweArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(OWE_USAGE);
    return EXIT_USAGE;
  }
  const { values, positionals } = parsed.value;
  const [positional] = positionals;
  const pullRequest = namedPullRequest({ positional, values });
  if (pullRequest === undefined) {
    deps.writeDiagnostic("gold owe: name the merged pull request, as its full URL");
    deps.writeDiagnostic(OWE_USAGE);
    return EXIT_USAGE;
  }
  const nowIso = deps.now();
  const built = debtFromFlags({ nowIso, pullRequest, values });
  if (built.isErr()) {
    deps.writeDiagnostic(`gold owe: ${built.error.message}`);
    return EXIT_USAGE;
  }
  const home = textFlag({ name: "home", values });
  const written = appendGoldDebtRecord({
    ...(home === undefined ? {} : { home }),
    nowIso,
    row: built.value,
  });
  if (written.isErr()) {
    deps.writeDiagnostic(`gold owe: ${written.error.message}`);
    return EXIT_ERROR;
  }
  const receipt = written.value;
  if (boolFlag({ name: "json", values })) {
    deps.writeOut(JSON.stringify({ ...receipt, debt: built.value }));
    return EXIT_OK;
  }
  const verb = receipt.appended ? "recorded" : "already held";
  deps.writeOut(`gold owe: ${verb} ${receipt.debtId} at ${built.value.grade} — gold is OWED, not waived`);
  deps.writeOut(`    would be: ${built.value.wouldBe}`);
  deps.writeOut(`    blocked on: ${built.value.blockedOn}`);
  deps.writeOut(`    ledger: ${receipt.path}`);
  return EXIT_OK;
}

/** The pull request the caller named: `--pull-request` when they used the flag, else the one positional. */
function namedPullRequest({
  values,
  positional,
}: {
  values: Readonly<Record<string, unknown>>;
  positional: string | undefined;
}): string | undefined {
  const flagged = textFlag({ name: "pull-request", values });
  if (flagged === undefined) {
    return positional;
  }
  return flagged;
}

/**
 * The parsed flags as a debt row. Every rule lives in `../../../goldDebt/row.ts` rather than here, so this
 * is only the mapping from flag name to field — and `--recorded-iso` defaulting to now, because a debt is
 * routinely recorded later than the merge it names.
 */
function debtFromFlags({
  values,
  pullRequest,
  nowIso,
}: {
  values: Readonly<Record<string, unknown>>;
  pullRequest: string;
  nowIso: string;
}): ReturnType<typeof buildGoldDebt> {
  // A missing required flag becomes the empty string, so the ROW BUILDER names the field rather than this
  // verb re-stating six presence checks the builder already owns.
  return buildGoldDebt({
    blockedOn: textFlagOr({ fallback: "", name: "blocked-on", values }),
    bySession: textFlagOr({ fallback: "", name: "by-session", values }),
    grade: textFlagOr({ fallback: "", name: "grade", values }),
    mergedIso: textFlagOr({ fallback: "", name: "merged-iso", values }),
    pullRequest,
    recordedIso: textFlagOr({ fallback: nowIso, name: "recorded-iso", values }),
    run: textFlag({ name: "run", values }),
    title: textFlag({ name: "title", values }),
    wouldBe: textFlagOr({ fallback: "", name: "would-be", values }),
  });
}

/**
 * The real seams: the two output channels and the clock.
 *
 * @returns the production dependencies for {@link runGoldOwe}
 */
export function productionGoldOweDeps(): GoldOweDeps {
  return {
    now: () => new Date().toISOString(),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver gold owe`. */
export const goldOweCommand = defineCommand({
  run: (argv) => runGoldOwe({ deps: productionGoldOweDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/**
 * `slopweaver gold settle` — close one gold debt, and say openly what the pull request now reads.
 *
 * Writes local state and nothing else: no network, no model, and NO write to the pull request. Composing a
 * re-graded description is judgement rather than mechanism — the Proof cell has to carry the new evidence,
 * and `slopweaver github pr`'s above-the-fold gate still applies — so this verb records the settlement and
 * prints the invocation to run. The `regrade` field is where the session says what it ran and what the
 * merged body now says, which is what makes the post-hoc re-grade OPEN rather than a quiet edit.
 */
import { parsePullRequestUrl } from "../../../goldDebt/pull.js";
import { findGoldDebt, foldGoldDebts } from "../../../goldDebt/query.js";
import { buildGoldDebtSettlement } from "../../../goldDebt/row.js";
import { appendGoldDebtRecord, readGoldDebtLedger } from "../../../goldDebt/store.js";
import type { GoldDebt, GoldDebtAppendReceipt, GoldDebtSettlementRow } from "../../../goldDebt/types.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { parseGoldSettleArgs, SETTLE_USAGE, VERB_ARG_OFFSET } from "./core.js";
import { boolFlag, textFlag, textFlagOr } from "./flags.js";

/** Everything `gold settle` touches outside itself, injected so a test drives the whole verb. */
export interface GoldSettleDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The instant this run happens at, as an ISO-8601 string. Injected so a test is not a clock. */
  readonly now: () => string;
}

/**
 * Run `gold settle` against injected seams.
 *
 * @param rest the argv tail after `gold settle`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runGoldSettle({ rest, deps }: { rest: readonly string[]; deps: GoldSettleDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(SETTLE_USAGE);
    return EXIT_OK;
  }
  const parsed = parseGoldSettleArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(SETTLE_USAGE);
    return EXIT_USAGE;
  }
  const { values, positionals } = parsed.value;
  const [reference] = positionals;
  if (reference === undefined) {
    deps.writeDiagnostic("gold settle: name the debt, by its pull-request URL or its owner/repo#number key");
    deps.writeDiagnostic(SETTLE_USAGE);
    return EXIT_USAGE;
  }
  const home = textFlag({ name: "home", values });
  const found = resolveDebt({ home, reference });
  if (found.isErr()) {
    deps.writeDiagnostic(`gold settle: ${found.error.why}`);
    return found.error.exit;
  }
  const debt = found.value;
  const nowIso = deps.now();
  const built = settlementFromFlags({ nowIso, pullRequest: debt.debt.pullRequest, values });
  if (built.isErr()) {
    deps.writeDiagnostic(`gold settle: ${built.error.message}`);
    return EXIT_USAGE;
  }
  const written = appendGoldDebtRecord({
    ...(home === undefined ? {} : { home }),
    nowIso,
    row: built.value,
  });
  if (written.isErr()) {
    deps.writeDiagnostic(`gold settle: ${written.error.message}`);
    return EXIT_ERROR;
  }
  const receipt = written.value;
  if (boolFlag({ name: "json", values })) {
    deps.writeOut(JSON.stringify({ ...receipt, settlement: built.value }));
    return EXIT_OK;
  }
  receiptLines({ pullRequest: debt.debt.pullRequest, receipt, row: built.value }).forEach((line) => {
    deps.writeOut(line);
  });
  return EXIT_OK;
}

/**
 * The debt a reference names, read from the register. Its failure carries the exit code the verb owes:
 * an unreadable register is a fault, a reference naming no debt is a caller mistake.
 */
function resolveDebt({
  reference,
  home,
}: {
  reference: string;
  home: string | undefined;
}): Result<GoldDebt, { readonly why: string; readonly exit: number }> {
  const stored = readGoldDebtLedger(home === undefined ? {} : { home });
  if (stored.isErr()) {
    return err({ exit: EXIT_ERROR, why: stored.error.message });
  }
  const folded = foldGoldDebts({ records: stored.value });
  if (folded.isErr()) {
    return err({ exit: EXIT_ERROR, why: folded.error.message });
  }
  const found = findGoldDebt({ debts: folded.value, reference });
  if (found === undefined) {
    return err({
      exit: EXIT_USAGE,
      why: `no gold debt in the ledger names ${reference} — run \`slopweaver gold debts\` to see what does`,
    });
  }
  return ok(found);
}

/**
 * The parsed flags as a settlement row. Every rule lives in `../../../goldDebt/row.ts`, so this is the
 * mapping alone — plus the two defaults: `--as gathered` is the ordinary case, and `--settled-iso`
 * defaults to now.
 */
function settlementFromFlags({
  values,
  pullRequest,
  nowIso,
}: {
  values: Readonly<Record<string, unknown>>;
  pullRequest: string;
  nowIso: string;
}): ReturnType<typeof buildGoldDebtSettlement> {
  return buildGoldDebtSettlement({
    bySession: textFlagOr({ fallback: "", name: "by-session", values }),
    evidence: textFlagOr({ fallback: "", name: "evidence", values }),
    proofCommit: textFlag({ name: "proof-commit", values }),
    pullRequest,
    regrade: textFlag({ name: "regrade", values }),
    settledIso: textFlagOr({ fallback: nowIso, name: "settled-iso", values }),
    verdict: textFlagOr({ fallback: "gathered", name: "as", values }),
  });
}

/** Everything the human view prints about one settled debt. */
function receiptLines({
  receipt,
  row,
  pullRequest,
}: {
  receipt: GoldDebtAppendReceipt;
  row: GoldDebtSettlementRow;
  pullRequest: string;
}): readonly string[] {
  const verb = receipt.appended ? "settled" : "already settled";
  return [
    `gold settle: ${verb} ${receipt.debtId} as ${row.verdict}`,
    `    evidence: ${row.evidence}`,
    ...regradeLines({ debt: pullRequest, row }),
    `    ledger: ${receipt.path}`,
  ];
}

/**
 * What to print about the pull request itself: the re-grade a gathered settlement recorded, plus the
 * invocation that edits the description — which this verb deliberately does not run.
 */
function regradeLines({
  debt,
  row,
}: {
  debt: string;
  row: { readonly verdict: string; readonly regrade?: string };
}): readonly string[] {
  if (row.regrade === undefined) {
    return ["    nothing to re-grade — a moot debt pays no proof"];
  }
  const parsed = parsePullRequestUrl({ url: debt });
  const lines = [`    re-graded: ${row.regrade}`];
  if (parsed === undefined) {
    return lines;
  }
  const target = `--repo ${parsed.owner}/${parsed.repo} --number ${String(parsed.number)}`;
  return [
    ...lines,
    "    the description is yours to edit, through the door — the new review, and the evidence as a proven claim:",
    `      slopweaver github pr update ${target} --edit '{"review":{"grade":"<grade>","reviewer":"<who>","why":"<why>"},"appendClaims":[<claim>]}'`,
  ];
}

/**
 * The real seams: the two output channels and the clock.
 *
 * @returns the production dependencies for {@link runGoldSettle}
 */
export function productionGoldSettleDeps(): GoldSettleDeps {
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

/** `slopweaver gold settle`. */
export const goldSettleCommand = defineCommand({
  run: (argv) => runGoldSettle({ deps: productionGoldSettleDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/**
 * `slopweaver autonomy adopt` — make the rows that were hand-appended before this noun existed readable.
 *
 * The board row that commissioned the register said that until the verb existed, sessions acting under
 * graduated autonomy would write rows to `$SLOPWEAVER_HOME/ledgers/autonomy.jsonl` by hand "and you adopt
 * them". This is that adoption, as a typed verb rather than as a one-off script: anything that would have been done in
 * Python is done in TypeScript and exposed through the
 * CLI. It is the repair path for a row the one-time store import refuses (`slopweaver store import-fleet --only
 * autonomy`), and it refuses once the store has imported the register: the store is the ledger from then on.
 *
 * **It writes nothing without `--apply`.** The default is a report, because the thing being changed is the
 * one register whose whole value is that they can trust what it says the fleet did.
 *
 * Each positional is one `<actionId>=<replacement>`, and the VALUE says which field it lands on — see
 * {@link replaceableFieldOf}. That is one form rather than two because the finding this closes asked for it
 * in those words: a row that broke the register carried a placeholder INSTANT, not a bad
 * subject, and a second grammar for the same repair would have been a second thing to remember at the
 * moment the register is already down.
 */
import type { AutonomyFieldReplacement, AutonomyReplaceableField } from "../../../autonomy/adopt.js";
import {
  type AutonomyAdoptionPlan,
  applyAutonomyAdoption,
  planAutonomyAdoption,
} from "../../../autonomy/adoptStore.js";
import { isAutonomyInstant, isCheckableSubject } from "../../../autonomy/fields.js";
import { type AutonomyLedgerPort, autonomyLedgerPort } from "../../../autonomy/port.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

import { ADOPT_USAGE, parseAutonomyAdoptArgs, VERB_ARG_OFFSET } from "./core.js";

/** A flag's value, or undefined when it was not supplied. */
function flag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** Everything `autonomy adopt` touches outside itself, injected so a test drives the whole verb. */
export interface AutonomyAdoptDeps {
  /** The instant the backup is named for, and the one the register's write lock is taken at. */
  readonly now: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The store's autonomy ledger, asked whether it has already imported the register this verb repairs. */
  readonly ledger: AutonomyLedgerPort;
}

/**
 * Why adopting the register file would change nothing anybody reads, or undefined when it still can.
 *
 * Only `AUTONOMY_NOT_IMPORTED` lets a repair go ahead: the file is still the source a pending import will take.
 * A store that answers is the ledger already — it has imported the file, or there was never one to import — so a
 * repair would feed nothing. A store that cannot say is refused too: a repair is never made on a guess about
 * which copy is the authority.
 *
 * @param ledger the store's autonomy ledger
 * @param home the state home the register lives under
 * @returns the refusal line, or undefined when the repair may go ahead
 */
async function storeHoldsRegister({
  ledger,
  home,
}: {
  ledger: AutonomyLedgerPort;
  home: string;
}): Promise<string | undefined> {
  const read = await ledger.readRecords({ home });
  if (read.isOk()) {
    return (
      "the store is already this home's autonomy ledger — it has imported the register, or there " +
      "was none to import — so a repair here would edit a copy nothing reads"
    );
  }
  if (read.error.code === "AUTONOMY_NOT_IMPORTED") {
    return undefined;
  }
  return `could not tell whether the store holds this register: ${read.error.message}`;
}

/**
 * Which field a replacement VALUE names, or undefined when it names neither.
 *
 * The positional carries no field name, and it does not need one: the two value spaces are disjoint by
 * construction rather than by luck. `../../../autonomy/row.ts`'s `ISO_INSTANT` requires
 * `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}`, so every instant carries two colons, while every checkable subject
 * refuses one in that position — a board slug's pattern admits only alphanumerics with `-`/`.` separators,
 * and a URL or a `state:` reference must OPEN with a prefix an instant cannot start with.
 * `unit/autonomy/replacementFields.test.ts` is the witness that they stay disjoint, because the rule lives
 * in two files that can drift apart.
 *
 * Asked in this order for no reason but determinism; either order answers the same on every input.
 *
 * @param replacement the value the caller typed after the `=`
 * @returns the field it repairs, or undefined when the register could read it as neither
 */
function replaceableFieldOf({ replacement }: { replacement: string }): AutonomyReplaceableField | undefined {
  if (isAutonomyInstant({ value: replacement })) {
    return "doneIso";
  }
  if (isCheckableSubject({ subject: replacement })) {
    return "subject";
  }
  return undefined;
}

/**
 * Split an `<actionId>=<replacement>` positional into the substitution it names.
 *
 * @param raw the positional as it was typed
 * @returns the replacement, or undefined when the value carries no `=` or names no repairable field
 */
export function parseFieldReplacement({ raw }: { raw: string }): AutonomyFieldReplacement | undefined {
  const separator = raw.indexOf("=");
  if (separator <= 0 || separator === raw.length - 1) {
    return undefined;
  }
  const replacement = raw.slice(separator + 1);
  const field = replaceableFieldOf({ replacement });
  if (field === undefined) {
    return undefined;
  }
  return { actionId: raw.slice(0, separator), field, replacement };
}

/**
 * Why one positional was refused — the split, or the value naming no field this verb repairs.
 *
 * Two messages rather than one, because they send a reader to different places: a missing `=` is a typing
 * mistake, while a value that classifies as neither is somebody trying to repair a field adoption does not
 * touch, and the fix for that is to name a value the register can actually read.
 *
 * @param raw the positional exactly as it was typed
 * @returns the diagnostic line
 */
export function replacementRefusal({ raw }: { raw: string }): string {
  if (raw.indexOf("=") <= 0 || raw.indexOf("=") === raw.length - 1) {
    return `autonomy adopt: a replacement reads <actionId>=<value>, not "${raw}"`;
  }
  return (
    `autonomy adopt: "${raw}" names no field this verb repairs — the value after the \`=\` must be either a ` +
    "checkable subject (an http(s) URL, a board row slug, or a state: reference) or an ISO-8601 instant " +
    "such as 2026-09-14T01:15:00Z, which is what says whether you are repairing `subject` or `doneIso`"
  );
}

/**
 * The report a plan prints: what the file holds, and every row that would change.
 *
 * @param plan what the adoption pass worked out
 * @returns the lines to print, one header pair then one line per changed row
 */
export function adoptionReportLines({ plan }: { plan: AutonomyAdoptionPlan }): readonly string[] {
  const patched = plan.changes.filter((change) => change.fields.length > 0 || change.compacted);
  const head = [
    `autonomy adopt: ${String(plan.objects)} act(s) across ${String(plan.physicalLines)} physical line(s) in ${plan.path}`,
    `  ${String(patched.length)} row(s) would change; the original would be preserved at ${plan.backupPath}`,
  ];
  const rows = patched.map((change) => {
    const what = [...change.fields, ...(change.compacted ? ["onto one line"] : [])].join(", ");
    const span =
      change.firstLine === change.lastLine
        ? `line ${String(change.firstLine)}`
        : `lines ${String(change.firstLine)}-${String(change.lastLine)}`;
    return `  ${change.actionId}  ${span}  ${what}`;
  });
  return [...head, ...rows];
}

/**
 * The argv phase: help, the flags, and every positional parsed as a replacement — or the exit code that ends the
 * verb before it reads anything.
 */
function adoptArgs({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: AutonomyAdoptDeps;
}):
  | number
  | { readonly values: Readonly<Record<string, unknown>>; readonly replacements: readonly AutonomyFieldReplacement[] } {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(ADOPT_USAGE);
    return EXIT_OK;
  }
  const parsed = parseAutonomyAdoptArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(ADOPT_USAGE);
    return EXIT_USAGE;
  }
  const malformed = parsed.value.positionals.find((raw) => parseFieldReplacement({ raw }) === undefined);
  if (malformed !== undefined) {
    deps.writeDiagnostic(replacementRefusal({ raw: malformed }));
    return EXIT_USAGE;
  }
  const replacements = parsed.value.positionals.flatMap((raw) => {
    const parsedRaw = parseFieldReplacement({ raw });
    return parsedRaw === undefined ? [] : [parsedRaw];
  });
  return { replacements, values: parsed.value.values };
}

/**
 * Run `autonomy adopt` against injected seams.
 *
 * @param rest the argv tail after `autonomy adopt`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runAutonomyAdopt({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: AutonomyAdoptDeps;
}): Promise<number> {
  const args = adoptArgs({ deps, rest });
  if (typeof args === "number") {
    return args;
  }
  const { replacements, values } = args;
  const home = flag({ name: "home", values });
  const stillPending = (): Promise<string | undefined> =>
    storeHoldsRegister({ home: resolveHome({ named: home }), ledger: deps.ledger });
  const held = await stillPending();
  if (held !== undefined) {
    deps.writeDiagnostic(`autonomy adopt: ${held}`);
    return EXIT_ERROR;
  }
  const nowIso = deps.now();
  const planned = planAutonomyAdoption({ nowIso, replacements, ...(home === undefined ? {} : { home }) });
  if (planned.isErr()) {
    deps.writeDiagnostic(`autonomy adopt: ${planned.error.message}`);
    return EXIT_ERROR;
  }
  const { plan, rows } = planned.value;
  const json = values["json"] === true;
  if (values["apply"] !== true) {
    report({
      deps,
      json,
      plan,
      tail: "  nothing was written — pass --apply to install this",
      value: { applied: false, plan },
    });
    return EXIT_OK;
  }
  const applied = await applyAutonomyAdoption({
    nowIso,
    plan,
    rows,
    stillPending,
    ...(home === undefined ? {} : { home }),
  });
  if (applied.isErr()) {
    deps.writeDiagnostic(`autonomy adopt: ${applied.error.message}`);
    return EXIT_ERROR;
  }
  const tail = applied.value.applied
    ? `  applied; the original is preserved at ${plan.backupPath}`
    : "  the register already needed no change, so nothing was written";
  report({ deps, json, plan, tail, value: applied.value });
  return EXIT_OK;
}

/** Print the outcome: one machine-readable document, or the human report and its closing line. */
function report({
  deps,
  json,
  plan,
  tail,
  value,
}: {
  deps: AutonomyAdoptDeps;
  json: boolean;
  plan: AutonomyAdoptionPlan;
  tail: string;
  value: unknown;
}): void {
  if (json) {
    deps.writeOut(JSON.stringify(value));
    return;
  }
  adoptionReportLines({ plan }).forEach((line) => {
    deps.writeOut(line);
  });
  deps.writeOut(tail);
}

/**
 * The real seams: the machine clock and the two output channels.
 *
 * @returns the production dependencies for {@link runAutonomyAdopt}
 */
export function productionAutonomyAdoptDeps(): AutonomyAdoptDeps {
  return {
    ledger: autonomyLedgerPort(),
    now: () => new Date().toISOString(),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver autonomy adopt`. */
export const autonomyAdoptCommand = defineCommand({
  run: (argv) => runAutonomyAdopt({ deps: productionAutonomyAdoptDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

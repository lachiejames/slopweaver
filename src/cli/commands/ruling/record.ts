/**
 * `ruling record`: file one ruling in the owner's words, refusing while a current ruling in the same category stands
 * beside it undisposed, and printing that earlier ruling in full so the recording session reads the two together.
 */
import { err, ok } from "../../../lib/result.js";
import {
  planRulingRecord,
  type RulingProjection,
  type RulingRecord,
  type RulingRecordInput,
} from "../../../ruling/registry.js";
import { appendRulings } from "../../../ruling/store.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { flagValue } from "../../optionParsers.js";
import { RULING_RECORD_USAGE } from "./rulingUsage.js";
import { printRuling, type RulingArgs, type RulingDeps, reportRefusal } from "./shared.js";

/** The record input the flags describe, or the usage problem with them. */
function recordInputOf({ args, deps }: { args: RulingArgs; deps: RulingDeps }): RulingRecordInput | string {
  const category = flagValue({ name: "category", parsed: args.parsed });
  const words = flagValue({ name: "words", parsed: args.parsed });
  const decidedOn = flagValue({ name: "decided-on", parsed: args.parsed });
  if (category === null || words === null || decidedOn === null) {
    return `--category, --words and --decided-on are each required\n${RULING_RECORD_USAGE}`;
  }
  const anchor = flagValue({ name: "anchor", parsed: args.parsed });
  const context = flagValue({ name: "context", parsed: args.parsed });
  return {
    alongside: args.parsed.flags.has("alongside"),
    ...(anchor === null ? {} : { anchor }),
    category,
    ...(context === null ? {} : { context }),
    decidedOn,
    id: deps.newId(),
    newCategory: args.parsed.flags.has("new-category"),
    origin: { kind: "record" },
    recordedIso: deps.nowIso(),
    replaces: args.replaces,
    words,
  };
}

/** Whether a current ruling in the input's category is neither replaced by it nor covered by `--alongside`. */
function standsUndisposed({ input, projection }: { input: RulingRecordInput; projection: RulingProjection }): boolean {
  return (
    !input.alongside &&
    projection.current.some((each) => each.category === input.category && !input.replaces.includes(each.id))
  );
}

/** The refusal's body: the new words, then every current ruling in the category they would stand beside. */
function printUndisposed({
  input,
  projection,
  deps,
}: {
  input: RulingRecordInput;
  projection: RulingProjection;
  deps: RulingDeps;
}): void {
  deps.logger.error({ msg: `ruling: the new ruling, for ${input.category}:` });
  for (const line of input.words.split("\n")) {
    deps.logger.error({ msg: `    ${line}` });
  }
  deps.logger.error({ msg: "ruling: beside these current rulings in the same category — read each against it:" });
  for (const row of projection.current.filter((each) => each.category === input.category)) {
    const marker = input.replaces.includes(row.id) ? " (replaced by this one)" : "";
    deps.logger.error({ msg: `  ${row.id} · decided ${row.decidedOn}${marker}` });
    for (const line of row.words.split("\n")) {
      deps.logger.error({ msg: `    ${line}` });
    }
  }
}

/** What a filed ruling prints: its id, what it replaced, and what it stands alongside. */
function printFiled({
  record,
  beside,
  projection,
  deps,
}: {
  record: RulingRecord;
  beside: readonly RulingRecord[];
  projection: RulingProjection;
  deps: RulingDeps;
}): void {
  deps.logger.out({ line: `ruling: filed ${record.id} in ${record.category}` });
  for (const replaced of record.replaces) {
    deps.logger.out({ line: `  replaces ${replaced}` });
  }
  const standing = beside.filter((row) => !record.replaces.includes(row.id));
  if (standing.length > 0) {
    deps.logger.out({ line: `  stands alongside ${String(standing.length)} current ruling(s) in ${record.category}:` });
    for (const row of standing) {
      printRuling({ deps, projection, record: row });
    }
  }
}

/**
 * `ruling record`.
 *
 * @param file the register's path
 * @param home the state home whose operation lock the append takes
 * @param args the parsed flags
 * @returns the exit code
 */
export function runRecord({
  file,
  home,
  args,
  deps,
}: {
  file: string;
  home: string;
  args: RulingArgs;
  deps: RulingDeps;
}): number {
  const input = recordInputOf({ args, deps });
  if (typeof input === "string") {
    deps.logger.error({ msg: input });
    return EXIT_USAGE;
  }
  let beside: readonly RulingRecord[] = [];
  const appended = appendRulings({
    file,
    home,
    nowIso: input.recordedIso,
    plan: ({ projection }) => {
      const planned = planRulingRecord({ input, projection });
      if (planned.isErr()) {
        // Any refusal, not only UNDISPOSED: a stale --replaces must not hide an earlier ruling left undisposed.
        if (standsUndisposed({ input, projection })) {
          printUndisposed({ deps, input, projection });
        }
        return err(planned.error);
      }
      beside = planned.value.beside;
      return ok([planned.value.record]);
    },
  });
  if (appended.isErr()) {
    return reportRefusal({ deps, error: appended.error });
  }
  const record = appended.value.appended[0]!;
  if (args.parsed.flags.has("json")) {
    deps.logger.out({ line: JSON.stringify({ beside: beside.map((row) => row.id), record }) });
    return EXIT_OK;
  }
  printFiled({ beside, deps, projection: appended.value.projection, record });
  return EXIT_OK;
}

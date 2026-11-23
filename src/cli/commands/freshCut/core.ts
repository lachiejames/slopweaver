/**
 * `fresh-cut`'s pure halves: each verb's flag grammar, and the lines a run prints. The shell (`./run.ts`) reads
 * the clock, the network and git; nothing here does.
 */
import { freshCutRecordSchema } from "../../../freshCut/core.js";
import {
  REVIEWED_RESIDUE_CLASS,
  REVIEWED_RESIDUE_JUDGEMENTS,
  type ReviewedResidueJudgement,
  reviewedResidueEntrySchema,
} from "../../../freshCut/reviewedResidue.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValue, parseFlagTail, requiredFlagValue } from "../../optionParsers.js";

/**
 * Each verb's own flags, as its usage line advertises them. `helpTruth.test.ts` holds each verb's usage to its
 * row here, through that verb's parser below.
 */
export const FRESH_CUT_FLAG_NAMES = {
  produce: ["--commit", "--out", "--source", "--home", "--json"],
  verify: ["--record", "--source", "--home", "--json"],
  accept: ["--record", "--path", "--line", "--class", "--as", "--source", "--home", "--json"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** What `fresh-cut produce` was asked to do. */
export interface ProduceOptions {
  readonly commit: string;
  readonly out: string;
  readonly source: string | null;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** What `fresh-cut verify` was asked to do. */
export interface VerifyOptions {
  readonly recordId: string;
  readonly source: string | null;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** What `fresh-cut accept` was asked to do. */
export interface AcceptOptions {
  readonly recordId: string;
  readonly path: string;
  readonly line: number;
  readonly judgement: ReviewedResidueJudgement;
  readonly source: string | null;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** The five flags `fresh-cut accept` requires, by flag name. */
type AcceptRequiredFlag = "as" | "class" | "line" | "path" | "record";

/**
 * Read every required accept flag, collecting each missing one rather than stopping at the first.
 *
 * @param parsed the parsed flag tail
 * @returns each required flag's raw value, or every missing-flag refusal
 */
function requiredAcceptValues({
  parsed,
}: {
  parsed: Parameters<typeof requiredFlagValue>[0]["parsed"];
}): Result<Readonly<Record<AcceptRequiredFlag, string>>> {
  const record = requiredFlagValue({
    missing: "--record is required: the record id `fresh-cut produce` printed",
    name: "record",
    parsed,
  });
  const path = requiredFlagValue({
    missing: "--path is required: the file's path as the verify report names it",
    name: "path",
    parsed,
  });
  const line = requiredFlagValue({
    missing: "--line is required: the 1-based line as the verify report names it",
    name: "line",
    parsed,
  });
  const className = requiredFlagValue({
    missing: `--class is required, and only ${REVIEWED_RESIDUE_CLASS} is accepted`,
    name: "class",
    parsed,
  });
  const judgement = requiredFlagValue({
    missing: `--as is required: one of ${REVIEWED_RESIDUE_JUDGEMENTS.join(", ")}`,
    name: "as",
    parsed,
  });
  if (record.isErr() || path.isErr() || line.isErr() || className.isErr() || judgement.isErr()) {
    return err([record, path, line, className, judgement].flatMap((value) => (value.isErr() ? value.error : [])));
  }
  return ok({ as: judgement.value, class: className.value, line: line.value, path: path.value, record: record.value });
}

/**
 * Check the required values' shapes: a UUID record, a positive line, the one accepted class and a known judgement.
 *
 * @param values each required flag's raw value
 * @returns the judgement, or every shape refusal
 */
function checkedAcceptJudgement({
  values,
}: {
  values: Readonly<Record<AcceptRequiredFlag, string>>;
}): Result<ReviewedResidueJudgement> {
  const errors: string[] = [];
  if (!freshCutRecordSchema.shape.recordId.safeParse(values.record).success) {
    errors.push("--record must be the UUID `fresh-cut produce` printed");
  }
  if (!/^[1-9][0-9]*$/.test(values.line)) {
    errors.push("--line must be a positive whole number");
  }
  if (values.class !== REVIEWED_RESIDUE_CLASS) {
    errors.push(
      `--class ${values.class} is refused: only ${REVIEWED_RESIDUE_CLASS} findings may be accepted; every other class waits on the owner`,
    );
  }
  const judged = reviewedResidueEntrySchema.shape.judgement.safeParse(values.as);
  if (!judged.success) {
    errors.push(`--as must be one of ${REVIEWED_RESIDUE_JUDGEMENTS.join(", ")}`);
  }
  if (errors.length > 0 || !judged.success) {
    return err(errors);
  }
  return ok(judged.data);
}

/**
 * Parse `fresh-cut accept`'s flags. `--class` must be `owner-address`: the list holds no other class, so a topic,
 * health, money or organisation finding is refused here, before anything is read.
 *
 * @param rest the argv after the verb
 * @returns the options, or every refusal
 */
export function parseAcceptOptions({ rest }: { rest: readonly string[] }): Result<AcceptOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json"], value: ["record", "path", "line", "class", "as", "source", "home"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const values = requiredAcceptValues({ parsed: parsed.value });
  if (values.isErr()) {
    return err(values.error);
  }
  const judgement = checkedAcceptJudgement({ values: values.value });
  if (judgement.isErr()) {
    return err(judgement.error);
  }
  return ok({
    // Unset is undefined, exactly what resolveHome reads as this install's state home.
    home: parsed.value.values["home"],
    json: parsed.value.flags.has("json"),
    judgement: judgement.value,
    line: Number(values.value.line),
    path: values.value.path,
    recordId: values.value.record,
    source: flagValue({ name: "source", parsed: parsed.value }),
  });
}

/**
 * Pure: the lines `fresh-cut accept` prints. The entry's id, class and judgement and the list's path only — never
 * the file's path or line, which the terminal transcript would keep.
 *
 * @param entryId the appended entry's id
 * @param judgement the reader's judgement
 * @param listPath the reviewed-residue file the entry was appended to
 * @returns the lines, without trailing newlines
 */
export function acceptLines({
  entryId,
  judgement,
  listPath,
}: {
  entryId: string;
  judgement: ReviewedResidueJudgement;
  listPath: string;
}): readonly string[] {
  return [
    `fresh-cut accept: entry ${entryId} — ${REVIEWED_RESIDUE_CLASS}, ${judgement}`,
    `fresh-cut accept: appended to ${listPath}`,
  ];
}

/**
 * Parse `fresh-cut produce`'s flags, refusing an unknown flag, a missing `--commit` or `--out`, and a relative
 * `--out` before anything is read.
 *
 * @param rest the argv after the verb
 * @returns the options, or every refusal
 */
export function parseProduceOptions({ rest }: { rest: readonly string[] }): Result<ProduceOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["commit", "out", "source", "home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const commit = requiredFlagValue({
    missing: "--commit is required: the full or abbreviated hexadecimal id of a commit on main",
    name: "commit",
    parsed: parsed.value,
  });
  const out = requiredFlagValue({
    missing: "--out is required: an absolute path for the new repository, outside every checkout",
    name: "out",
    parsed: parsed.value,
  });
  const errors = [...(commit.isErr() ? commit.error : []), ...(out.isErr() ? out.error : [])];
  if (out.isOk() && !out.value.startsWith("/")) {
    errors.push("--out must be an absolute path");
  }
  if (commit.isErr() || out.isErr() || errors.length > 0) {
    return err(errors);
  }
  return ok({
    commit: commit.value,
    // Unset is undefined, exactly what resolveHome reads as this install's state home.
    home: parsed.value.values["home"],
    json: parsed.value.flags.has("json"),
    out: out.value,
    source: flagValue({ name: "source", parsed: parsed.value }),
  });
}

/**
 * Parse `fresh-cut verify`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the options, or every refusal
 */
export function parseVerifyOptions({ rest }: { rest: readonly string[] }): Result<VerifyOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["record", "source", "home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const recordId = requiredFlagValue({
    missing: "--record is required: the record id `fresh-cut produce` printed",
    name: "record",
    parsed: parsed.value,
  });
  if (recordId.isErr()) {
    return err(recordId.error);
  }
  // The id becomes a directory name under the home, so anything but a UUID is refused before it names a path.
  if (!freshCutRecordSchema.shape.recordId.safeParse(recordId.value).success) {
    return err(["--record must be the UUID `fresh-cut produce` printed"]);
  }
  return ok({
    // Unset is undefined, exactly what resolveHome reads as this install's state home.
    home: parsed.value.values["home"],
    json: parsed.value.flags.has("json"),
    recordId: recordId.value,
    source: flagValue({ name: "source", parsed: parsed.value }),
  });
}

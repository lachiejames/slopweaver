/**
 * `fresh-cut`'s pure halves: each verb's flag grammar, and the lines a run prints. The shell (`./run.ts`) reads
 * the clock, the network and git; nothing here does.
 */
import {
  isOwnerAnchoredClass,
  type OwnerAnchoredClass,
  REVIEWED_RESIDUE_CLASS,
} from "../../../freshCut/anchoredAcceptance.js";
import { freshCutRecordSchema } from "../../../freshCut/core.js";
import {
  isCanonicalTurnPointer,
  ownerAddressResidueEntrySchema,
  REVIEWED_RESIDUE_JUDGEMENTS,
  type ReviewedResidueDecision,
  type ReviewedResidueEntry,
} from "../../../freshCut/reviewedResidue.js";
import { PRIVATE_TERM_CLASSES, type PrivateTermClass } from "../../../hygiene/privateTerms.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValue, parseFlagTail, requiredFlagValue } from "../../optionParsers.js";

/**
 * Each verb's own flags, as its usage line advertises them. `helpTruth.test.ts` holds each verb's usage to its
 * row here, through that verb's parser below.
 */
export const FRESH_CUT_FLAG_NAMES = {
  produce: ["--commit", "--out", "--source", "--home", "--json"],
  verify: ["--record", "--source", "--home", "--json"],
  accept: ["--record", "--path", "--line", "--class", "--as", "--anchor", "--source", "--home", "--json"],
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
  readonly decision: ReviewedResidueDecision;
  readonly source: string | null;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** The four flags every `fresh-cut accept` requires, by flag name; `--as` or `--anchor` follows from the class. */
type AcceptRequiredFlag = "class" | "line" | "path" | "record";

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
    missing: `--class is required: one of ${PRIVATE_TERM_CLASSES.join(", ")}`,
    name: "class",
    parsed,
  });
  if (record.isErr() || path.isErr() || line.isErr() || className.isErr()) {
    return err([record, path, line, className].flatMap((value) => (value.isErr() ? value.error : [])));
  }
  return ok({ class: className.value, line: line.value, path: path.value, record: record.value });
}

/**
 * Pure: whether a raw `--class` value is a private-term class.
 *
 * @param value the raw value
 * @returns true for a member of the class list
 */
function isPrivateTermClass(value: string): value is PrivateTermClass {
  return (PRIVATE_TERM_CLASSES as readonly string[]).includes(value);
}

/**
 * Pure: the decision one class's track requires. An owner-address finding takes `--as` and refuses `--anchor`; every
 * other class takes a canonical `--anchor` to the owner's own turn and refuses `--as`, since no reader's judgement
 * can accept a word only the owner rules on.
 *
 * @param className the checked class
 * @param as the raw `--as`, or null when unset
 * @param anchor the raw `--anchor`, or null when unset
 * @returns the decision, or every refusal
 */
function checkedAcceptDecision({
  className,
  as,
  anchor,
}: {
  className: PrivateTermClass;
  as: string | null;
  anchor: string | null;
}): Result<ReviewedResidueDecision> {
  if (!isOwnerAnchoredClass(className)) {
    return checkedJudgedDecision({ anchor, as, className });
  }
  return checkedAnchoredDecision({ anchor, as, className });
}

/**
 * Pure: the owner-address track's decision — a judgement from `--as`, and no `--anchor`.
 *
 * @param className the owner-address class
 * @param as the raw `--as`, or null when unset
 * @param anchor the raw `--anchor`, or null when unset
 * @returns the decision, or every refusal
 */
function checkedJudgedDecision({
  className,
  as,
  anchor,
}: {
  className: typeof REVIEWED_RESIDUE_CLASS;
  as: string | null;
  anchor: string | null;
}): Result<ReviewedResidueDecision> {
  const errors: string[] = [];
  if (anchor !== null) {
    errors.push(`--anchor is refused for ${REVIEWED_RESIDUE_CLASS}: a reading session judges that class with --as`);
  }
  const judged = ownerAddressResidueEntrySchema.shape.judgement.safeParse(as);
  if (!judged.success) {
    errors.push(
      as === null
        ? `--as is required for ${REVIEWED_RESIDUE_CLASS}: one of ${REVIEWED_RESIDUE_JUDGEMENTS.join(", ")}`
        : `--as must be one of ${REVIEWED_RESIDUE_JUDGEMENTS.join(", ")}`,
    );
  }
  if (errors.length > 0 || !judged.success) {
    return err(errors);
  }
  return ok({ className, judgement: judged.data });
}

/**
 * Pure: an anchored class's decision — a canonical `--anchor`, and no `--as`.
 *
 * @param className the anchored class
 * @param as the raw `--as`, or null when unset
 * @param anchor the raw `--anchor`, or null when unset
 * @returns the decision, or every refusal
 */
function checkedAnchoredDecision({
  className,
  as,
  anchor,
}: {
  className: OwnerAnchoredClass;
  as: string | null;
  anchor: string | null;
}): Result<ReviewedResidueDecision> {
  const errors: string[] = [];
  if (as !== null) {
    errors.push(`--as is refused for ${className}: only the owner's anchor accepts that class`);
  }
  if (anchor === null) {
    errors.push(
      `--anchor is required for ${className}: transcript:<session>#<turn>, the owner's own turn ruling on it`,
    );
  } else if (!isCanonicalTurnPointer({ value: anchor })) {
    errors.push("--anchor must be a transcript:<session>#<turn> pointer, both halves lower-case UUIDs");
  }
  if (errors.length > 0 || anchor === null) {
    return err(errors);
  }
  return ok({ className, ownerAnchor: anchor });
}

/**
 * Check the required values' shapes and the class's track: a UUID record, a positive line, a known class, and
 * either `--as` (owner-address) or `--anchor` (any other class).
 *
 * @param values each required flag's raw value
 * @param as the raw `--as`, or null when unset
 * @param anchor the raw `--anchor`, or null when unset
 * @returns the decision, or every shape refusal
 */
function checkedAccept({
  values,
  as,
  anchor,
}: {
  values: Readonly<Record<AcceptRequiredFlag, string>>;
  as: string | null;
  anchor: string | null;
}): Result<ReviewedResidueDecision> {
  const errors: string[] = [];
  if (!freshCutRecordSchema.shape.recordId.safeParse(values.record).success) {
    errors.push("--record must be the UUID `fresh-cut produce` printed");
  }
  if (!/^[1-9][0-9]*$/.test(values.line)) {
    errors.push("--line must be a positive whole number");
  }
  if (!isPrivateTermClass(values.class)) {
    errors.push(`--class ${values.class} is refused: it must be one of ${PRIVATE_TERM_CLASSES.join(", ")}`);
    return err(errors);
  }
  const decision = checkedAcceptDecision({ anchor, as, className: values.class });
  if (decision.isErr() || errors.length > 0) {
    return err([...errors, ...(decision.isErr() ? decision.error : [])]);
  }
  return ok(decision.value);
}

/**
 * Parse `fresh-cut accept`'s flags. An `owner-address` finding is accepted on a reader's `--as`; every other class
 * only on `--anchor`, the owner's own turn, so a topic, health, money or organisation finding with no anchor is
 * refused here, before anything is read.
 *
 * @param rest the argv after the verb
 * @returns the options, or every refusal
 */
export function parseAcceptOptions({ rest }: { rest: readonly string[] }): Result<AcceptOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json"], value: ["record", "path", "line", "class", "as", "anchor", "source", "home"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const values = requiredAcceptValues({ parsed: parsed.value });
  if (values.isErr()) {
    return err(values.error);
  }
  const decision = checkedAccept({
    anchor: flagValue({ name: "anchor", parsed: parsed.value }),
    as: flagValue({ name: "as", parsed: parsed.value }),
    values: values.value,
  });
  if (decision.isErr()) {
    return err(decision.error);
  }
  return ok({
    decision: decision.value,
    // Unset is undefined, exactly what resolveHome reads as this install's state home.
    home: parsed.value.values["home"],
    json: parsed.value.flags.has("json"),
    line: Number(values.value.line),
    path: values.value.path,
    recordId: values.value.record,
    source: flagValue({ name: "source", parsed: parsed.value }),
  });
}

/**
 * Pure: the lines `fresh-cut accept` prints. The entry's id, its class, and the reader's judgement or that it rests
 * on an owner anchor, then the list's path — never the file's path or line, which the terminal transcript would keep,
 * and never the anchor, which the owner-only list already holds.
 *
 * @param entry the appended entry
 * @param listPath the reviewed-residue file the entry was appended to
 * @returns the lines, without trailing newlines
 */
export function acceptLines({ entry, listPath }: { entry: ReviewedResidueEntry; listPath: string }): readonly string[] {
  const basis = entry.schemaVersion === 1 ? entry.judgement : "accepted on an owner anchor";
  return [
    `fresh-cut accept: entry ${entry.entryId} — ${entry.className}, ${basis}`,
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

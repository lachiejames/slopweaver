/**
 * The PURE core of `slopweaver reflect grade`: its usage line, its one flag spec, and its argv parsing. The
 * row it writes is `reflect/grades.ts`; the fs shell is `gradeRun.ts`.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { SEEN_GRADES, type SeenGrade } from "../../../reflect/seen.js";
import { parseFlags } from "../../parseFlags.js";

/**
 * The one flag spec the verb parses with, exported so `helpTruth.test.ts` probes the REAL list rather than
 * a copy of it.
 *
 * @internal
 */
export const REFLECT_GRADE_FLAG_SPEC = {
  boolean: ["json"],
  value: ["why", "closed-by", "home"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/**
 * The validated invocation for `reflect grade`.
 *
 * @internal
 */
export interface ReflectGradeOptions {
  /** The finding's id, exactly as `reflect brief` prints it in square brackets. */
  readonly id: string;
  readonly grade: SeenGrade;
  /** The owner's reason, when given. Never required: one word is the feature. */
  readonly why?: string;
  /** What closed the underlying problem — a pull request, a commit, a board slug. */
  readonly closedBy?: string;
  readonly home?: string;
  readonly json: boolean;
}

/** Whether a positional is one of the three grade words. */
function isGradeWord(value: string): value is SeenGrade {
  return SEEN_GRADES.some((grade) => grade === value);
}

/** A string flag's trimmed value, or `undefined` when it was absent or blank. */
function textValue({ value }: { value: string | boolean | undefined }): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

/**
 * Parse `reflect grade`'s argv tail: exactly two positionals, the id then the word, plus optional flags.
 *
 * @param rest the argv tail (after `slopweaver reflect grade`)
 * @returns the validated options, or every rejection
 */
export function parseReflectGradeOptions({ rest }: { rest: readonly string[] }): Result<ReflectGradeOptions> {
  const parsed = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: REFLECT_GRADE_FLAG_SPEC.boolean, string: REFLECT_GRADE_FLAG_SPEC.value },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { positionals, values } = parsed.value;
  const [id, word, ...extra] = positionals;
  const problems: string[] = [];
  if (id === undefined || id.trim().length === 0) {
    problems.push("a finding id is required — `slopweaver reflect brief` prints each one in [brackets]");
  }
  if (word === undefined || !isGradeWord(word)) {
    problems.push(`the grade is one word: ${SEEN_GRADES.join(", ")}`);
  }
  if (extra.length > 0) {
    problems.push("one finding and one word at a time — quote a --why that has spaces in it");
  }
  if (problems.length > 0 || id === undefined || word === undefined || !isGradeWord(word)) {
    return err(problems);
  }
  const why = textValue({ value: values["why"] });
  const closedBy = textValue({ value: values["closed-by"] });
  const home = textValue({ value: values["home"] });
  return ok({
    grade: word,
    id: id.trim(),
    json: values["json"] === true,
    ...(why !== undefined ? { why } : {}),
    ...(closedBy !== undefined ? { closedBy } : {}),
    ...(home !== undefined ? { home } : {}),
  });
}

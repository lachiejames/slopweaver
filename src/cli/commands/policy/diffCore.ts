/**
 * The pure half of `slopweaver policy diff` — its option grammar and the report it prints.
 *
 * `./diffRun.ts` is the shell that reads the record, the two sides of every document and the atlas, and writes
 * what `../../../policy/diff/render.ts` produced.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { DocDiffIssue } from "../../../policy/diff/issues.js";
import type { DocDiffModel } from "../../../policy/diff/model.js";
import { type FlagTailSpec, flagValueOr, parseFlagTail, requiredFlagValue } from "../../optionParsers.js";

/** The usage `policy diff` prints. */
export const POLICY_DIFF_USAGE =
  "usage: slopweaver policy diff --record <record.json> --out <dir> [--json] [--home <dir>]";

/** Every flag `diff` knows. */
export const POLICY_DIFF_FLAGS: FlagTailSpec = { boolean: ["json"], value: ["home", "out", "record"] };

/** The three files one run writes into `--out`. */
export const POLICY_DIFF_OUTPUTS = { owner: "owner.html", team: "team.html", teamPost: "team-post.txt" } as const;

/** What `policy diff` was asked to do. */
export interface PolicyDiffOptions {
  readonly record: string;
  readonly out: string;
  readonly home: string;
  readonly json: boolean;
}

/**
 * Parse `policy diff`'s flags.
 *
 * @param rest the verb tail
 * @param defaultHome the resolved `$SLOPWEAVER_HOME` to use when `--home` is absent
 * @returns the options, or every reason they were refused
 */
export function parsePolicyDiff({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<PolicyDiffOptions> {
  const parsed = parseFlagTail({ rest, spec: POLICY_DIFF_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const record = requiredFlagValue({
    missing: "--record <path> is required: the diff record naming each document's two sides and every reason",
    name: "record",
    parsed: parsed.value,
  });
  const out = requiredFlagValue({
    missing: "--out <dir> is required: where the owner page, the team page and the team post are written",
    name: "out",
    parsed: parsed.value,
  });
  if (record.isErr() || out.isErr()) {
    return err([...(record.isErr() ? record.error : []), ...(out.isErr() ? out.error : [])]);
  }
  return ok({
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: parsed.value.flags.has("json"),
    out: out.value,
    record: record.value,
  });
}

/**
 * Every issue as one line, its code first, so a refusal says all of what is wrong with the record at once.
 *
 * @param issues what the build refused
 * @returns one line per issue
 */
export function issueLines({ issues }: { issues: readonly DocDiffIssue[] }): readonly string[] {
  return issues.map((issue) => `  ${issue.code}: ${issue.message}`);
}

/**
 * The human report a successful run prints: the counts per document, then the commands that publish it.
 *
 * @param model the built diff
 * @param out the directory the files were written into
 * @returns the report lines
 */
export function diffHumanLines({ model, out }: { model: DocDiffModel; out: string }): readonly string[] {
  const documents = model.documents.map(
    (diff) =>
      `  ${diff.document.id}: ${String(diff.counts.material)} material, ` +
      `${String(diff.counts.formatting)} formatting only, ${String(diff.counts.same)} unchanged`,
  );
  return [
    `policy diff: ${String(model.documents.length)} documents, every material line explained`,
    ...documents,
    `wrote ${out}/${POLICY_DIFF_OUTPUTS.owner}, ${POLICY_DIFF_OUTPUTS.team}, ${POLICY_DIFF_OUTPUTS.teamPost}`,
    `review: slopweaver page review-prepare <slug> --page ${out}/${POLICY_DIFF_OUTPUTS.owner} --inputs <what it answers to>`,
    `publish: slopweaver page publish <slug> --page ${out}/${POLICY_DIFF_OUTPUTS.owner} --review <id>`,
  ];
}

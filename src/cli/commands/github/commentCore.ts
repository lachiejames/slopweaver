/**
 * Pure parser, form validator and door request for `slopweaver github comment`.
 *
 * One flag spec across both sub-verbs, matching `./threadCore.ts`'s reasoning: `create` and `edit` address
 * the same kind of object with the same `--form`, and differ only in whether the destination is a fresh
 * `--number` or an existing `--comment-id`. The parsed result is a UNION rather than one shape with both
 * optional, so a caller can never construct a create request carrying a comment id or vice versa.
 */
import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { renderCommentBody } from "../../../outbound/github/commentRender.js";
import { githubCommentArtifactSchema } from "../../../outbound/github/commentSchema.js";
import type { GithubCommentArtifact } from "../../../outbound/github/commentTypes.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { type GithubVerbError, GithubVerbErrors, githubVerbErrorLines } from "./errors.js";

const SUB_VERBS = ["create", "edit"] as const;

/**
 * Which comment sub-verb an invocation named.
 *
 * @internal
 */
export type GithubCommentSubVerb = (typeof SUB_VERBS)[number];

const GITHUB_COMMENT_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["repo", "number", "comment-id", "form", "home"],
};

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_COMMENT_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_COMMENT_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_COMMENT_FLAGS }),
].map((name) => `--${name}`);

/** What every sub-verb shares. */
interface GithubCommentAddress {
  readonly owner: string;
  readonly repo: string;
  readonly formSource: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** `create` — a fresh comment on an issue or pull request. */
interface GithubCommentCreateArgs extends GithubCommentAddress {
  readonly subVerb: "create";
  readonly number: number;
}

/** `edit` — replace a comment already posted. */
interface GithubCommentEditArgs extends GithubCommentAddress {
  readonly subVerb: "edit";
  readonly commentId: number;
}

/** The resolved comment operation. */
export type GithubCommentArgs = GithubCommentCreateArgs | GithubCommentEditArgs;

/** A narrowing guard for the fixed set of recognised sub-verbs. */
function isSubVerb(value: string | undefined): value is GithubCommentSubVerb {
  return value !== undefined && (SUB_VERBS as readonly string[]).includes(value);
}

/** The flag values every sub-verb's own rules are checked against. */
type CommentValues = Readonly<Record<string, string | boolean | undefined>>;

/** A positive whole number, or the named problem. */
function positiveInt({
  value,
  flag,
}: {
  value: string | boolean | undefined;
  flag: string;
}): Result<number, GithubVerbError> {
  const n = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(n) && n > 0
    ? ok(n)
    : err(GithubVerbErrors.notPositiveWholeNumber({ flag, got: String(value) }));
}

/** `--form` is required by every sub-verb, and `--number`/`--comment-id` belong to exactly one each. */
function crossFieldProblems({
  subVerb,
  values,
}: {
  subVerb: GithubCommentSubVerb;
  values: CommentValues;
}): readonly string[] {
  const formValue = values["form"];
  return [
    typeof formValue === "string" && formValue.length > 0 ? "" : "--form <json|-> is required",
    subVerb === "create" && values["comment-id"] !== undefined
      ? "--comment-id is not a `create` flag; `create` addresses --number"
      : "",
    subVerb === "edit" && values["number"] !== undefined
      ? "--number is not an `edit` flag; `edit` addresses --comment-id"
      : "",
  ].filter((problem) => problem.length > 0);
}

/** The fields every sub-verb shares, read from the parsed flags. */
function addressFrom({ values }: { values: CommentValues }): Omit<GithubCommentAddress, "owner" | "repo"> {
  const formValue = values["form"];
  return {
    dryRun: values["dry-run"] === true,
    formSource: typeof formValue === "string" ? formValue : "",
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    json: values["json"] === true,
  };
}

/**
 * Parse the comment operation before resolving a credential.
 *
 * @param argv the verb's own argument tail, after `github comment`
 * @returns the resolved sub-verb, address and form source, or every usage problem
 */
export function parseGithubCommentArgs({
  argv,
}: {
  argv: readonly string[];
}): Result<GithubCommentArgs, GithubVerbError> {
  const subVerb = argv[0];
  if (!isSubVerb(subVerb)) {
    return err(GithubVerbErrors.usage({ command: "comment", shape: `<${SUB_VERBS.join("|")}>` }));
  }
  const parsed = parseFlags({ allowPositionals: false, args: argv.slice(1), spec: GITHUB_COMMENT_FLAGS });
  if (parsed.isErr()) {
    return err(GithubVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const repoValue = values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  const shared = [
    ...(repo === undefined ? ["--repo owner/name is required"] : []),
    ...crossFieldProblems({ subVerb, values }),
  ];
  const address = addressFrom({ values });
  if (subVerb === "create") {
    const number = positiveInt({ flag: "--number", value: values["number"] });
    const errors = [...shared, ...(number.isErr() ? githubVerbErrorLines({ error: number.error }) : [])];
    return errors.length > 0 || repo === undefined || number.isErr()
      ? err(GithubVerbErrors.argumentsRefused({ reasons: errors }))
      : ok({ ...address, number: number.value, owner: repo.owner, repo: repo.repo, subVerb });
  }
  const commentId = positiveInt({ flag: "--comment-id", value: values["comment-id"] });
  const errors = [...shared, ...(commentId.isErr() ? githubVerbErrorLines({ error: commentId.error }) : [])];
  return errors.length > 0 || repo === undefined || commentId.isErr()
    ? err(GithubVerbErrors.argumentsRefused({ reasons: errors }))
    : ok({ ...address, commentId: commentId.value, owner: repo.owner, repo: repo.repo, subVerb });
}

/**
 * Validate a filled form.
 *
 * @param raw the JSON text of the form
 * @returns the typed artifact, or one line per rejection naming its path
 */
export function parseGithubCommentForm({ raw }: { raw: string }): Result<GithubCommentArtifact, GithubVerbError> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error: unknown) {
    return err(GithubVerbErrors.formNotJson({ cause: error }));
  }
  const parsed = githubCommentArtifactSchema.safeParse(json);
  return parsed.success
    ? ok(parsed.data)
    : err(
        GithubVerbErrors.formInvalid({
          form: "--form",
          reasons: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
        }),
      );
}

/**
 * The dry-run preview: the exact bytes that would be sent, plus the destination.
 *
 * @param args the parsed invocation
 * @param artifact the validated comment
 * @returns the operator-facing lines
 */
export function commentDryRunLines({
  args,
  artifact,
}: {
  args: GithubCommentArgs;
  artifact: GithubCommentArtifact;
}): readonly string[] {
  const body = renderCommentBody({ artifact });
  const dest =
    args.subVerb === "create"
      ? `${args.owner}/${args.repo}#${String(args.number)}`
      : `${args.owner}/${args.repo} comment ${String(args.commentId)}`;
  return [
    `would ${args.subVerb}: ${dest}`,
    `body bytes: ${String(Buffer.byteLength(body, "utf8"))}`,
    "--- comment ---",
    body,
    "--- end ---",
  ];
}

/**
 * The external-write door request for one comment operation.
 *
 * `createsWorkItem` is FALSE, the same judgement `../../linear/commentCore.ts`'s comment write makes: a
 * comment lands on an issue or pull request that already exists, so it puts nothing new on anyone's queue.
 *
 * @param args the parsed sub-verb and address
 * @param home the Slopweaver state home whose door records the write
 * @returns the exact external-write request admitted by the door
 */
export function commentDoorRequestFor({ args, home }: { args: GithubCommentArgs; home: string }): DoorRequest {
  const id =
    args.subVerb === "create"
      ? `${args.owner}/${args.repo}#${String(args.number)}`
      : `${args.owner}/${args.repo} comment ${String(args.commentId)}`;
  return {
    action: { kind: "verb", noun: "github", verb: `comment ${args.subVerb}` },
    artifact: { id },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

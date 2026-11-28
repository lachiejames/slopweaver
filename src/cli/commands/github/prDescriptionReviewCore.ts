/**
 * Pure half of `slopweaver github pr review-prepare` and `github pr review-record`: their arguments, the image
 * list an author hands `review-prepare`, and the commands it prints for the fresh reviewer.
 *
 * The domain is `../../../outbound/github/descriptionReview.ts`; the shell is `./prDescriptionReviewRun.ts`.
 * Every failure is the domain's own typed union, so a usage problem and a refused packet are told apart by
 * `code` rather than by reading a sentence.
 */
import { err, ok, type Result } from "#lib/result.js";
import { shellCommandLine } from "#lib/shellCommandLine.js";

import {
  type DescriptionReviewError,
  DescriptionReviewErrors,
} from "../../../outbound/github/descriptionReviewErrors.js";
import {
  DESCRIPTION_REVIEW_PROPERTY,
  DESCRIPTION_REVIEW_PROPERTY_ID,
  type DescriptionImage,
  type DescriptionReviewPreparation,
} from "../../../outbound/github/descriptionReviewTypes.js";
import { detectSupervisorSession, type SupervisorSession } from "../../../supervisor/session.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/** `review-prepare`'s value flags, named once so the spec and the advertised list cannot disagree. */
const PREPARE_STRING_FLAGS: readonly string[] = [
  "repo",
  "base",
  "base-ref",
  "head",
  "branch",
  "cwd",
  "title",
  "body-file",
  "comments",
  "number",
  "images",
  "evidence",
  "home",
];

/** `review-record`'s value flags. */
const RECORD_STRING_FLAGS: readonly string[] = ["review", "home"];

/** `review-prepare`'s switches. */
const PREPARE_BOOLEAN_FLAGS: readonly string[] = ["new", "json"];

const PREPARE_SPEC: FlagSpec = { boolean: PREPARE_BOOLEAN_FLAGS, string: PREPARE_STRING_FLAGS };
const RECORD_SPEC: FlagSpec = { boolean: ["json"], string: RECORD_STRING_FLAGS };

/** Every flag `review-prepare` accepts, for the help-truth ratchet. */
export const GITHUB_PR_REVIEW_PREPARE_FLAG_NAMES: readonly string[] = [
  ...PREPARE_STRING_FLAGS,
  ...PREPARE_BOOLEAN_FLAGS,
].map((name) => `--${name}`);

/** Every flag `review-record` accepts, for the help-truth ratchet. */
export const GITHUB_PR_REVIEW_RECORD_FLAG_NAMES: readonly string[] = [...RECORD_STRING_FLAGS, "json"].map(
  (name) => `--${name}`,
);

/** `review-prepare`'s resolved request. */
export interface GithubPrReviewPrepareArgs {
  readonly repository: string;
  readonly baseBranch: string;
  /** The git ref the merge base is taken against; `origin/<base>` unless named. */
  readonly baseRef: string;
  /** The commit described; `HEAD` unless named. */
  readonly headRef: string;
  /**
   * The pull request's head branch, exactly, which a fleet finding's row is matched on; undefined when not named,
   * so no fleet-finding record is looked for. The write verb's printed command always names it.
   */
  readonly branch: string | undefined;
  /** The checkout to read the change set from, or undefined for the working directory. */
  readonly cwd: string | undefined;
  readonly title: string;
  readonly bodyFile: string;
  /** The file holding the inline comments the write posts, exactly as GitHub receives them; `[]` for none. */
  readonly commentsFile: string;
  /** Which pull request the description is for: one not yet opened, or an open one whose comments are read. */
  readonly pullRequest: DescriptionPullRequest;
  readonly imagesFile: string | undefined;
  readonly evidenceFiles: readonly string[];
  readonly json: boolean;
  readonly home: string | undefined;
}

/** The pull request a description is written for. */
export type DescriptionPullRequest = { readonly kind: "new" } | { readonly kind: "existing"; readonly number: number };

/** `review-record`'s resolved request. */
export interface GithubPrReviewRecordArgs {
  readonly reviewId: string;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** One image entry an author lists for `review-prepare`: what the body shows, and the local file holding it. */
export interface DescriptionImageInput {
  readonly image: DescriptionImage;
  readonly file: string;
}

/** A string flag's value when it was given, else undefined. */
function stringValue({
  values,
  name,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** Which pull request `--new` or `--number` names; a problem is pushed when neither or both is given. */
function pullRequestOf({
  isNew,
  numberText,
  problems,
}: {
  isNew: boolean;
  numberText: string | undefined;
  problems: string[];
}): DescriptionPullRequest {
  if (isNew === (numberText !== undefined)) {
    problems.push("name exactly one of --new (a pull request not yet opened) or --number <n> (an open one)");
    return { kind: "new" };
  }
  if (numberText === undefined) {
    return { kind: "new" };
  }
  if (/^[1-9][0-9]*$/.test(numberText)) {
    return { kind: "existing", number: Number(numberText) };
  }
  problems.push(`--number must be a positive integer; got "${numberText}"`);
  return { kind: "new" };
}

/**
 * Parse `github pr review-prepare` before reading anything.
 *
 * @param rest argv after `github pr review-prepare`
 * @returns the request, or every usage problem
 */
export function parseGithubPrReviewPrepareArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GithubPrReviewPrepareArgs, DescriptionReviewError> {
  const parsed = parseFlags({ args: rest, spec: PREPARE_SPEC });
  if (parsed.isErr()) {
    return err(DescriptionReviewErrors.usage({ problems: parsed.error }));
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const required = ({ name }: { name: string }): string => {
    const value = stringValue({ name, values });
    if (value === undefined || value.trim() === "") {
      problems.push(`--${name} is required`);
      return "";
    }
    return value;
  };
  const repository = required({ name: "repo" });
  const baseBranch = required({ name: "base" });
  const title = required({ name: "title" });
  const bodyFile = required({ name: "body-file" });
  const commentsFile = required({ name: "comments" });
  const pullRequest = pullRequestOf({
    isNew: values["new"] === true,
    numberText: stringValue({ name: "number", values }),
    problems,
  });
  if (repository !== "" && !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    problems.push(`--repo must be owner/name; got "${repository}"`);
  }
  if (problems.length > 0) {
    return err(DescriptionReviewErrors.usage({ problems }));
  }
  const baseRef = stringValue({ name: "base-ref", values });
  const headRef = stringValue({ name: "head", values });
  const evidence = stringValue({ name: "evidence", values });
  return ok({
    baseBranch,
    baseRef: typeof baseRef === "string" ? baseRef : `origin/${baseBranch}`,
    bodyFile,
    branch: stringValue({ name: "branch", values }),
    commentsFile,
    cwd: stringValue({ name: "cwd", values }),
    evidenceFiles: evidence === undefined ? [] : evidence.split(",").filter((path) => path !== ""),
    headRef: typeof headRef === "string" ? headRef : "HEAD",
    home: stringValue({ name: "home", values }),
    imagesFile: stringValue({ name: "images", values }),
    json: values["json"] === true,
    pullRequest,
    repository,
    title,
  });
}

/**
 * Parse `github pr review-record` before reading anything.
 *
 * @param rest argv after `github pr review-record`
 * @returns the request, or every usage problem
 */
export function parseGithubPrReviewRecordArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GithubPrReviewRecordArgs, DescriptionReviewError> {
  const parsed = parseFlags({ args: rest, spec: RECORD_SPEC });
  if (parsed.isErr()) {
    return err(DescriptionReviewErrors.usage({ problems: parsed.error }));
  }
  const { values } = parsed.value;
  const reviewId = stringValue({ name: "review", values });
  if (reviewId === undefined || reviewId.trim() === "") {
    return err(
      DescriptionReviewErrors.usage({
        problems: ["--review is required: the Codex artifact or Claude fallback receipt id"],
      }),
    );
  }
  return ok({ home: stringValue({ name: "home", values }), json: values["json"] === true, reviewId });
}

/**
 * The visible session this process runs in, or null when the environment names none or two.
 *
 * @param env the environment to read — `process.env` in production
 * @returns the session, or null
 */
export function visibleSessionOf({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): SupervisorSession | null {
  const detected = detectSupervisorSession({ env });
  if (detected.kind !== "active") {
    return null;
  }
  return detected.session;
}

/** How long a description review may run: a description is small, so a briefing's bound rather than a code review's. */
const REVIEW_BOUND_SECONDS = 600;

/** Headroom over the measured diff, so `--max-diff-bytes` never refuses the exact diff it was computed from. */
export const DIFF_HEADROOM_BYTES = 4096;

/**
 * The commands that take a prepared packet through its fresh review to a receipt, each one line a caller pastes.
 *
 * @param preparation what was committed
 * @param repoRoot the packet repository
 * @param home the state home every command must name, so the review and the record read the same one
 * @param maxDiffBytes the bound the review's diff must sit under
 * @returns the Codex review, the Claude fallback prepare and record, and the receipt record, in the order they run
 */
export function descriptionReviewCommands({
  preparation,
  repoRoot,
  home,
  maxDiffBytes,
}: {
  preparation: DescriptionReviewPreparation;
  repoRoot: string;
  home: string;
  maxDiffBytes: number;
}): {
  readonly review: string;
  readonly fallbackPrepare: string;
  readonly fallbackRecord: string;
  readonly record: string;
} {
  const property = ["--property-id", DESCRIPTION_REVIEW_PROPERTY_ID, "--property", DESCRIPTION_REVIEW_PROPERTY];
  const bound = ["--base", preparation.baseSha, "--max-diff-bytes", String(maxDiffBytes)];
  const where = ["--repo", repoRoot, "--home", home];
  // Each fixed head is literal words with no space inside one, so splitting it is exact.
  const words = ({ text }: { text: string }): string[] => text.split(" ");
  return {
    fallbackPrepare: shellCommandLine({
      command: [
        ...words({ text: "slopweaver codex review-fallback prepare --pass r1" }),
        ...property,
        ...bound,
        ...where,
      ],
    }),
    fallbackRecord: shellCommandLine({
      command: [
        ...words({
          text: "slopweaver codex review-fallback record --request <request-id> --answer-file <answer.json>",
        }),
        ...where,
      ],
    }),
    record: shellCommandLine({
      command: [
        ...words({ text: "slopweaver github pr review-record --review <artifact-or-receipt-id> --home" }),
        home,
      ],
    }),
    review: shellCommandLine({
      command: [
        ...words({ text: "slopweaver codex review --pass r1" }),
        ...property,
        ...bound,
        "--bound-seconds",
        String(REVIEW_BOUND_SECONDS),
        ...where,
      ],
    }),
  };
}

/**
 * What a successful preparation prints: the packet, then every command in the order it runs.
 *
 * @returns the lines
 */
export function preparedPacketLines({
  preparation,
  repoRoot,
  commands,
}: {
  preparation: DescriptionReviewPreparation;
  repoRoot: string;
  commands: ReturnType<typeof descriptionReviewCommands>;
}): readonly string[] {
  return [
    repoRoot,
    `  packet ${preparation.manifestSha256} (preparation ${preparation.preparationId})`,
    `  base ${preparation.baseSha} holds only .gitattributes and the images; head ${preparation.headSha} adds every text file, the rules, the change set, the evidence and the description`,
    "  a FRESH reviewer takes the pass, never the session that wrote the description. Codex:",
    `    ${commands.review}`,
    "  Codex capped or unregistered? A separate visible Claude session prepares, reviews and records instead:",
    `    ${commands.fallbackPrepare}`,
    `    ${commands.fallbackRecord}`,
    "  then the reviewer's verdict becomes the receipt the write verb reads (for the fallback, run by the reviewing session):",
    `    ${commands.record}`,
    "  This lane is separate from the code's two review passes: one pass per distinct description and image set.",
  ];
}

/**
 * `slopweaver github reviewer list|pick|read|backfill` — the invocation: its flags and the parse that checks
 * every field a pick writes before anything is read. The typed refusals are `./reviewerErrors.ts`; the list
 * document, its rendering and the pick row are `./reviewerCore.ts`; files are the run module's.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type FlagSpec, parseFlags } from "../../parseFlags.js";

import { GithubReviewerErrors, type ReviewerUsageError } from "./reviewerErrors.js";

const LIST_FLAGS: FlagSpec = { boolean: ["json"], string: ["home"] };
const PICK_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["repo", "number", "reviewer", "verdict", "feedback", "by-session", "home"],
};
const READ_FLAGS: FlagSpec = {
  boolean: ["json", "ask", "non-ask"],
  string: ["repo", "number", "message", "to", "why", "quote", "by-session", "home"],
};

const BACKFILL_FLAGS: FlagSpec = { boolean: ["json", "apply"], string: ["repo", "author", "home"] };

/** `--`-prefixed flags, sorted, for the help-truth ratchet. */
function names({ spec: { string: strings = [], boolean: booleans = [] } }: { spec: FlagSpec }): readonly string[] {
  return [...strings, ...booleans].map((name) => `--${name}`).toSorted();
}

/** Every flag any sub-verb accepts, with the `--` callers type, sorted — for the help-truth ratchet. */
export const GITHUB_REVIEWER_FLAG_NAMES: readonly string[] = [
  ...new Set([
    ...names({ spec: LIST_FLAGS }),
    ...names({ spec: PICK_FLAGS }),
    ...names({ spec: READ_FLAGS }),
    ...names({ spec: BACKFILL_FLAGS }),
  ]),
].toSorted();

/** A parsed `list`. */
export interface GithubReviewerListArgs {
  readonly verb: "list";
  readonly json: boolean;
  readonly home: string | undefined;
}

/** A parsed `pick`, every required field present and checked. */
export interface GithubReviewerPickArgs {
  readonly verb: "pick";
  readonly repo: string;
  readonly number: number;
  readonly reviewer: string;
  readonly verdict: "approve" | "decline";
  readonly feedback: string | undefined;
  readonly bySession: string;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** A parsed `read`: one message's reading about one pull request, every field present and checked. */
export interface GithubReviewerReadArgs {
  readonly verb: "read";
  readonly repo: string;
  readonly number: number;
  readonly permalink: string;
  readonly verdict: "ask" | "non-ask";
  /** Who it asked — people or groups; empty exactly on a non-ask. */
  readonly recipients: readonly string[];
  readonly why: string | undefined;
  readonly quote: string;
  readonly bySession: string;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** A parsed `backfill`: whose pull requests, in which repository, and whether to write. */
export interface GithubReviewerBackfillArgs {
  readonly verb: "backfill";
  /** `owner/name`. */
  readonly repo: string;
  /** The GitHub login whose pull requests' asks are backfilled. */
  readonly author: string;
  /** Write the rows; without it the verb only reports what it would write. */
  readonly apply: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** Any sub-verb, parsed. */
export type GithubReviewerArgs =
  GithubReviewerListArgs | GithubReviewerPickArgs | GithubReviewerReadArgs | GithubReviewerBackfillArgs;

/**
 * A string flag's value, or `undefined` when absent or blank.
 *
 * @returns the trimmed value
 */
function text({
  values,
  key,
}: {
  values: Readonly<Record<string, string | boolean>>;
  key: string;
}): string | undefined {
  const value = values[key];
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  return value.trim();
}

/**
 * Parse `pick`'s flags into a checked invocation.
 *
 * @returns the invocation, or every problem found
 */
function pickArgsOf({ rest }: { rest: readonly string[] }): Result<GithubReviewerPickArgs, ReviewerUsageError> {
  const parsed = parseFlags({ args: rest, spec: PICK_FLAGS });
  if (parsed.isErr()) {
    return err(GithubReviewerErrors.usage({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const repo = text({ key: "repo", values });
  const numberText = text({ key: "number", values });
  const reviewer = text({ key: "reviewer", values });
  const verdict = text({ key: "verdict", values });
  const feedback = text({ key: "feedback", values });
  const bySession = text({ key: "by-session", values });
  const number = numberText === undefined ? Number.NaN : Number(numberText);
  if (repo === undefined) {
    problems.push("--repo <name> is required");
  }
  if (!Number.isInteger(number) || number <= 0) {
    problems.push("--number <n> must be a pull request number");
  }
  if (reviewer === undefined || !/^[UW][A-Z0-9]+$/.test(reviewer)) {
    problems.push("--reviewer must be a Slack member id (U… or W…) — a user group is never a reviewer");
  }
  if (verdict !== "approve" && verdict !== "decline") {
    problems.push("--verdict must be approve or decline");
  }
  if (verdict === "decline" && feedback === undefined) {
    problems.push("a decline needs --feedback saying why, so the suggestion can learn from it");
  }
  if (bySession === undefined) {
    problems.push("--by-session <who> is required");
  }
  if (
    problems.length > 0 ||
    repo === undefined ||
    reviewer === undefined ||
    bySession === undefined ||
    (verdict !== "approve" && verdict !== "decline")
  ) {
    return err(GithubReviewerErrors.usage({ reasons: problems }));
  }
  return ok({
    bySession,
    feedback,
    home: text({ key: "home", values }),
    json: values["json"] === true,
    number,
    repo,
    reviewer,
    verb: "pick",
    verdict,
  });
}

/**
 * `--to`'s comma-separated Slack ids, trimmed, blanks dropped.
 *
 * @returns the ids in order
 */
function idsOf({ raw }: { raw: string | undefined }): readonly string[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
}

/** `read`'s flags as read off argv, before any is checked. */
interface ReadFields {
  readonly repo: string | undefined;
  readonly number: number;
  readonly permalink: string | undefined;
  readonly why: string | undefined;
  readonly bySession: string | undefined;
  readonly quote: string | undefined;
  readonly recipients: readonly string[];
  readonly asked: boolean;
  readonly notAsked: boolean;
}

/**
 * Every problem with `read`'s flags, in the order a reader fixes them.
 *
 * @returns the problems, empty when the invocation is whole
 */
function readProblems({ fields }: { fields: ReadFields }): readonly string[] {
  const { asked, notAsked, recipients, permalink } = fields;
  const checks: readonly (readonly [boolean, string])[] = [
    [fields.repo === undefined, "--repo <name> is required"],
    [!Number.isInteger(fields.number) || fields.number <= 0, "--number <n> must be a pull request number"],
    [
      permalink === undefined || !/^https:\/\/[^/]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d+/.test(permalink),
      "--message must be a Slack message permalink",
    ],
    [asked === notAsked, "pass exactly one of --ask or --non-ask"],
    [asked && recipients.length === 0, "--ask needs --to <id,...> naming who it asked (U…, W… or a S… user group)"],
    [recipients.some((id) => !/^[UWS][A-Z0-9]+$/.test(id)), "--to takes Slack ids only: U…, W… or S…"],
    [
      notAsked && (fields.why === undefined || recipients.length > 0),
      "--non-ask needs --why and names nobody with --to",
    ],
    [fields.quote === undefined, "--quote <line> is required: the exact line of the message the reading rests on"],
    [fields.bySession === undefined, "--by-session <who> is required"],
  ];
  return checks.filter(([failed]) => failed).map(([, problem]) => problem);
}

/**
 * Parse `read`'s flags into a checked invocation. The quote is kept verbatim — its whitespace is part of
 * what is compared against the message.
 *
 * @returns the invocation, or every problem found
 */
function readArgsOf({ rest }: { rest: readonly string[] }): Result<GithubReviewerReadArgs, ReviewerUsageError> {
  const parsed = parseFlags({ args: rest, spec: READ_FLAGS });
  if (parsed.isErr()) {
    return err(GithubReviewerErrors.usage({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const rawQuote = values["quote"];
  const numberText = text({ key: "number", values });
  const fields: ReadFields = {
    asked: values["ask"] === true,
    bySession: text({ key: "by-session", values }),
    notAsked: values["non-ask"] === true,
    number: numberText === undefined ? Number.NaN : Number(numberText),
    permalink: text({ key: "message", values }),
    quote: typeof rawQuote === "string" && rawQuote.trim() !== "" ? rawQuote : undefined,
    recipients: idsOf({ raw: text({ key: "to", values }) }),
    repo: text({ key: "repo", values }),
    why: text({ key: "why", values }),
  };
  const problems = readProblems({ fields });
  const { repo, permalink, quote, bySession } = fields;
  if (
    problems.length > 0 ||
    repo === undefined ||
    permalink === undefined ||
    quote === undefined ||
    bySession === undefined
  ) {
    return err(GithubReviewerErrors.usage({ reasons: problems }));
  }
  return ok({
    bySession,
    home: text({ key: "home", values }),
    json: values["json"] === true,
    number: fields.number,
    permalink,
    quote,
    recipients: fields.recipients,
    repo,
    verb: "read",
    verdict: fields.asked ? "ask" : "non-ask",
    why: fields.why,
  });
}

/**
 * Parse `backfill`'s flags. `--repo` and `--author` are both required: which pull requests are the owner's is the
 * caller's to say, never a default.
 *
 * @returns the invocation, or every problem found
 */
function backfillArgsOf({ rest }: { rest: readonly string[] }): Result<GithubReviewerBackfillArgs, ReviewerUsageError> {
  const parsed = parseFlags({ args: rest, spec: BACKFILL_FLAGS });
  if (parsed.isErr()) {
    return err(GithubReviewerErrors.usage({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const repo = text({ key: "repo", values });
  const author = text({ key: "author", values });
  const problems: string[] = [];
  if (repo === undefined || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    problems.push("--repo <owner/name> is required");
  }
  if (author === undefined) {
    problems.push("--author <login> is required: whose pull requests' asks to backfill");
  }
  if (problems.length > 0 || repo === undefined || author === undefined) {
    return err(GithubReviewerErrors.usage({ reasons: problems }));
  }
  return ok({
    apply: values["apply"] === true,
    author,
    home: text({ key: "home", values }),
    json: values["json"] === true,
    repo,
    verb: "backfill",
  });
}

/**
 * Parse `github reviewer <list|pick|read|backfill> …`.
 *
 * @param rest the argv after `github reviewer`
 * @returns the invocation, or the problems that refuse it
 */
export function parseGithubReviewerArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GithubReviewerArgs, ReviewerUsageError> {
  const [verb, ...tail] = rest;
  if (verb === "list") {
    const parsed = parseFlags({ args: tail, spec: LIST_FLAGS });
    if (parsed.isErr()) {
      return err(GithubReviewerErrors.usage({ reasons: parsed.error }));
    }
    return ok({
      home: text({ key: "home", values: parsed.value.values }),
      json: parsed.value.values["json"] === true,
      verb,
    });
  }
  if (verb === "pick") {
    return pickArgsOf({ rest: tail });
  }
  if (verb === "read") {
    return readArgsOf({ rest: tail });
  }
  if (verb === "backfill") {
    return backfillArgsOf({ rest: tail });
  }
  let got = "nothing";
  if (verb !== undefined) {
    got = verb;
  }
  const problem = `github reviewer: expected list, pick, read or backfill, got ${got}`;
  return err(GithubReviewerErrors.usage({ reasons: [problem] }));
}

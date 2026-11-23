/**
 * `slopweaver github bottleneck` — the pure argument handling and the defaults the audit runs on.
 *
 * Two defaults here are the whole point of the verb rather than conveniences, and both are the OPPOSITE of
 * `./landingCore.ts`'s. Drafts are INCLUDED, because a draft nobody undrafts is the commonest bottleneck this
 * fleet has and excluding them is what made it invisible. And there is no write flag at all: the audit reads
 * and groups, and every act it might suggest belongs to a verb that already owns it.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { commaListFlag, positiveIntFlag } from "../../optionParsers.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";
import { DEFAULT_LIMIT } from "./bottleneckUsage.js";

const BOTTLENECK_STRING_FLAGS = ["repo", "author", "limit", "home"] as const;
const BOTTLENECK_BOOLEAN_FLAGS = ["json", "exclude-drafts", "slack-live"] as const;

/** The flags this verb accepts, in the shape `parseFlags` wants. */
const GITHUB_BOTTLENECK_FLAGS: FlagSpec = {
  boolean: [...BOTTLENECK_BOOLEAN_FLAGS],
  string: [...BOTTLENECK_STRING_FLAGS],
};

/**
 * Every accepted flag, WITH the `--`, for the help-truth ratchet.
 *
 * Built from the two lists above rather than read back off {@link GITHUB_BOTTLENECK_FLAGS}, whose fields are
 * both optional on `FlagSpec`: reading them back needed a `?? []` that says "or no flags at all" about a
 * literal three lines up, which is exactly the substitution `no-silent-fallback` exists to refuse.
 */
export const GITHUB_BOTTLENECK_FLAG_NAMES: readonly string[] = [
  ...BOTTLENECK_STRING_FLAGS,
  ...BOTTLENECK_BOOLEAN_FLAGS,
].map((name) => `--${name}`);

/** A parsed, side-effect-free bottleneck invocation. */
export interface GithubBottleneckArgs {
  /** The repositories to read. Empty when none was typed, which the shell resolves to its own default. */
  readonly repos: readonly string[];
  readonly author: string | undefined;
  /**
   * Whether to leave drafts OUT, which this verb does not do by default.
   *
   * Inverted against `github landing`'s `--include-drafts` on purpose: a flag whose default hides the
   * biggest bar in the histogram is a flag nobody remembers to pass.
   */
  readonly excludeDrafts: boolean;
  readonly limit: number;
  readonly json: boolean;
  /** Whether to run the LIVE Slack search as well as the corpus scan. Off, as everywhere else. */
  readonly slackLive: boolean;
  readonly home: string | undefined;
}

/**
 * Parse one `github bottleneck` invocation before any credential, git remote or network is touched.
 *
 * @param rest the argv tail after `github bottleneck`
 * @returns the resolved options, or every usage problem found
 */
export function parseGithubBottleneckArgs({ rest }: { rest: readonly string[] }): Result<GithubBottleneckArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_BOTTLENECK_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const limit = positiveIntFlag({ fallback: DEFAULT_LIMIT, name: "limit", problems, values });
  const repos = commaListFlag({ fallback: [], name: "repo", values });
  if (repos.some((slug) => !slug.includes("/"))) {
    problems.push("--repo takes one or more comma-separated owner/name slugs");
  }
  if (problems.length > 0) {
    return err(problems);
  }
  const author = values["author"];
  const home = values["home"];
  return ok({
    author: typeof author === "string" ? author : undefined,
    excludeDrafts: values["exclude-drafts"] === true,
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    limit,
    repos,
    slackLive: values["slack-live"] === true,
  });
}

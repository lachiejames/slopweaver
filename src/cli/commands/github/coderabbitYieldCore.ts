/**
 * `slopweaver github coderabbit-yield` — the pure argument handling and the window; the usage lives in `./coderabbitYieldUsage.ts`.
 *
 * `--repo` is REQUIRED rather than defaulting to the checkout's `origin`, because the question is asked of
 * two repositories at once and a silent default to one of them would answer half of it. Every value that
 * reaches a search string is validated here, before any credential is read: a login or slug carrying a space
 * or a qualifier would widen the search to somebody else's pull requests, and nothing downstream could tell.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { commaListFlag, positiveIntFlag } from "../../optionParsers.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { DEFAULT_DAYS, YIELD_BOOLEAN_FLAGS, YIELD_STRING_FLAGS } from "./coderabbitYieldUsage.js";

const DAY_MS = 86_400_000;

const GITHUB_CODERABBIT_YIELD_FLAGS: FlagSpec = {
  boolean: [...YIELD_BOOLEAN_FLAGS],
  string: [...YIELD_STRING_FLAGS],
};

/** A parsed, side-effect-free invocation. */
export interface GithubCoderabbitYieldArgs {
  readonly repos: readonly string[];
  /** Undefined when none was typed; the shell then asks GitHub whose token it holds. */
  readonly author: string | undefined;
  readonly days: number;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Parse one invocation before any credential or network is touched.
 *
 * @param rest the argv tail after `github coderabbit-yield`
 * @returns the options, or every usage problem found
 */
export function parseGithubCoderabbitYieldArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GithubCoderabbitYieldArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_CODERABBIT_YIELD_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const days = positiveIntFlag({ fallback: DEFAULT_DAYS, name: "days", problems, values });
  // GitHub slugs are case-insensitive, so A/B and a/b are one repository and one aggregate row.
  const repos = [...new Set(commaListFlag({ fallback: [], name: "repo", values }).map((slug) => slug.toLowerCase()))];
  if (repos.length === 0) {
    problems.push("--repo is required: name every repository to measure, comma-separated");
  }
  if (repos.some((slug) => !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(slug))) {
    problems.push("--repo takes owner/name slugs only — no spaces or search qualifiers");
  }
  const author = values["author"];
  if (typeof author === "string" && !/^[A-Za-z0-9-]+(\[bot\])?$/u.test(author)) {
    problems.push("--author takes one GitHub login — no spaces or search qualifiers");
  }
  if (problems.length > 0) {
    return err(problems);
  }
  const home = values["home"];
  return ok({
    author: typeof author === "string" ? author : undefined,
    days,
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    repos,
  });
}

/**
 * The creation window a read covers: `days` back from `now`, to the second.
 *
 * @param now the instant the read starts
 * @param days how many days back
 * @returns both ends as ISO instants
 */
export function yieldWindow({ now, days }: { now: Date; days: number }): { sinceIso: string; untilIso: string } {
  const untilMs = Math.floor(now.getTime() / 1000) * 1000;
  return {
    sinceIso: new Date(untilMs - days * DAY_MS).toISOString(),
    untilIso: new Date(untilMs).toISOString(),
  };
}

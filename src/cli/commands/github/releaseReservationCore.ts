/** Pure parsing for `slopweaver github pr release-reservation`. */
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";

/** Every flag this verb accepts, named ONCE so the spec and the advertised list cannot disagree. */
const FLAG_STEMS: readonly string[] = ["repo", "base", "head", "home"];

/** The parse spec, built from the one stem list so it cannot drift from the advertised names. */
const RELEASE_RESERVATION_FLAGS: FlagSpec = { boolean: [], string: FLAG_STEMS };

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_PR_RELEASE_RESERVATION_FLAG_NAMES: readonly string[] = FLAG_STEMS.map((name) => `--${name}`);

/** The resolved release request — a branch locus, and where the ledger lives. */
export interface GithubPrReleaseReservationArgs {
  readonly owner: string;
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly home: string | undefined;
}

/**
 * Parse the release request before touching the ledger or the network.
 *
 * All three address flags are required and none is defaulted: the locus is the whole key, and a guessed base
 * would address a different reservation from the one the caller means.
 *
 * @param rest argv after `github pr release-reservation`
 * @returns the resolved locus address, or every usage problem
 */
export function parseGithubPrReleaseReservationArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GithubPrReleaseReservationArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: RELEASE_RESERVATION_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const errors: string[] = [];
  const repoValue = parsed.value.values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  if (repo === undefined) {
    errors.push("--repo owner/name is required");
  }
  const baseValue = parsed.value.values["base"];
  const base = typeof baseValue === "string" ? baseValue : "";
  if (base === "") {
    errors.push("--base <ref> is required");
  }
  const headValue = parsed.value.values["head"];
  const head = typeof headValue === "string" ? headValue : "";
  if (head === "") {
    errors.push("--head <ref> is required");
  }
  if (errors.length > 0 || repo === undefined) {
    return err(errors);
  }
  const home = parsed.value.values["home"];
  return ok({
    base,
    head,
    home: typeof home === "string" ? home : undefined,
    owner: repo.owner,
    repo: repo.repo,
  });
}

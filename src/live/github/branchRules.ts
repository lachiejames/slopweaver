/**
 * The ruleset half of the required-contexts read: REST's rules-for-a-branch payload shaped into the status-check
 * contexts it requires. Split from `./mergeQueue.ts`, which unions it with classic branch protection in
 * `makeGithubMergeQueueReads`.
 */
import { optStr } from "../../corpus/slack/shape.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { RequiredCheckContexts } from "./branchProtection.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";

/**
 * The status-check contexts ONE effective branch rule requires, empty for every rule that requires none.
 *
 * @param rule one entry of REST's rules-for-a-branch array, unvalidated
 * @returns its contexts, in the order GitHub returned them
 */
function contextsOfRule({ rule }: { rule: unknown }): readonly string[] {
  if (!isRecord(rule) || rule["type"] !== "required_status_checks") {
    return [];
  }
  const parameters = rule["parameters"];
  const required = isRecord(parameters) ? parameters["required_status_checks"] : undefined;
  if (!Array.isArray(required)) {
    return [];
  }
  return required
    .map((entry) => (isRecord(entry) ? optStr({ value: entry["context"] }) : undefined))
    .filter((context): context is string => context !== undefined);
}

/**
 * How many rules one rules-for-a-branch read asks GitHub for — its maximum page. REST pages at 30 by default, so
 * an unpaged read silently dropped every rule past the thirtieth, and a required check declared there read as
 * advisory (a Codex review, r1-01d). A page that comes back FULL may still be hiding one, so it is refused.
 */
export const RULES_PAGE = 100;

/**
 * Shape the effective branch rules into the set of REQUIRED status-check contexts.
 *
 * Reads REST's rules-for-a-branch payload, which is a flat array of the rules in force however they were
 * configured — a ruleset and classic branch protection both land here, which is the whole reason this is a
 * REST read rather than a GraphQL one. Every `required_status_checks` rule contributes its contexts; the
 * result is deduped and sorted so two orderings of the same configuration compare equal.
 *
 * A payload with no such rule is a STATE rather than a fault, exactly as a missing queue is: it answers an
 * empty list, and the guard above decides what that means.
 *
 * @param data the raw REST response
 * @param branch the branch the rules were asked for, carried into the shaped value
 * @param identity the `owner/name` slug, named in a malformed-payload error
 * @returns the required contexts, or the typed read failure
 */
export function parseRequiredCheckContexts({
  data,
  branch,
  identity,
}: {
  data: unknown;
  branch: string;
  identity: string;
}): Result<RequiredCheckContexts, GithubLiveError> {
  const payload = isRecord(data) ? data["data"] : undefined;
  const list = Array.isArray(payload) ? payload : undefined;
  if (list === undefined) {
    return err(
      GithubLiveErrors.readFailed({
        message: `GitHub returned no rules array for ${identity} on ${branch}`,
      }),
    );
  }
  if (list.length >= RULES_PAGE) {
    return err(
      GithubLiveErrors.readFailed({
        message: `GitHub returned a full page of ${String(RULES_PAGE)} rules for ${identity} on ${branch}, so a required check may be on a page this read did not fetch`,
      }),
    );
  }
  const contexts = new Set(list.flatMap((rule) => contextsOfRule({ rule })));
  // A ruleset states its own code-owner requirement under a DIFFERENT rule type this parser does not read,
  // so the ruleset half contributes `undefined` and the classic half is what can answer it. Unioning them
  // below keeps `undefined` only when NEITHER source said.
  return ok({ branch, contexts: [...contexts].toSorted(), requiresCodeOwnerReviews: undefined });
}

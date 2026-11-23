/**
 * Pure parser, plan and door request for `slopweaver github pr retarget`.
 *
 * Retargeting a pull request's base branch is the one step of building a native GitHub stack that no
 * governed verb covered until this one: `github stack adopt` deliberately never retargets a base (see its
 * own module doc), and `github pr update` has no `base` field on its edit form because changing a base or
 * head is a different pull request, not a description edit. This verb is that missing door, scoped as
 * narrowly as `pr request-review` is — its own parser and door request, dispatched from `run.ts` before
 * `parseGithubPrArgs` ever sees the argv tail.
 */

import type { DoorRequest } from "../../../admit/types.js";
import type { WrittenPr } from "../../../corpus/github/write.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import type { Freshness } from "./updateCore.js";

const GITHUB_PR_RETARGET_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json", "adopt"],
  string: ["repo", "number", "base", "home"],
};

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_PR_RETARGET_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_PR_RETARGET_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_PR_RETARGET_FLAGS }),
].map((name) => `--${name}`);

/** The resolved retarget request. */
export interface GithubPrRetargetArgs {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly base: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  /**
   * Retarget onto a base that is another OPEN pull request's head branch, and register the native stack
   * membership in the same invocation. Without it that retarget is REFUSED, because the state it would leave
   * behind — a chain GitHub does not know is a stack — is the class this door exists to make impossible.
   */
  readonly adopt: boolean;
  readonly home: string | undefined;
}

/**
 * Parse the retarget request before resolving a credential.
 *
 * @param rest argv after `github pr retarget`
 * @returns the resolved address and new base, or every usage problem
 */
export function parseGithubPrRetargetArgs({ rest }: { rest: readonly string[] }): Result<GithubPrRetargetArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_PR_RETARGET_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const errors: string[] = [];
  const repoValue = parsed.value.values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  if (repo === undefined) {
    errors.push("--repo owner/name is required");
  }
  const numberValue = parsed.value.values["number"];
  const number = typeof numberValue === "string" ? Number(numberValue) : Number.NaN;
  if (!Number.isInteger(number) || number <= 0) {
    errors.push("--number must be a positive whole number");
  }
  const baseValue = parsed.value.values["base"];
  const base = typeof baseValue === "string" ? baseValue.trim() : "";
  if (base.length === 0) {
    errors.push("--base <ref> is required");
  }
  if (errors.length > 0 || repo === undefined) {
    return err(errors);
  }
  const home = parsed.value.values["home"];
  return ok({
    adopt: parsed.value.values["adopt"] === true,
    base,
    dryRun: parsed.value.values["dry-run"] === true,
    home: typeof home === "string" ? home : undefined,
    json: parsed.value.values["json"] === true,
    number,
    owner: repo.owner,
    repo: repo.repo,
  });
}

/** Whether a retarget may proceed, given the pull request GitHub reports today. */
type RetargetDecision =
  | { readonly kind: "proceed" }
  | { readonly kind: "noop"; readonly reason: string }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Decide whether the requested base may be sent, from the live pull request alone — before authorisation,
 * the door, or any write.
 *
 * Order matters: a base equal to the pull request's own head is nonsensical regardless of what the live
 * base already is, so it is checked first. A base that already matches the live one is reported as a no-op
 * rather than refused, matching `github ready`'s "already ready" and `pr request-review`'s "already
 * requested" — a caller re-running the same retarget should see success, not an error. Native stack
 * membership is checked last, and refused with no override: GitHub's own stacks API requires each entry's
 * base to already match the entry below it, so retargeting a stacked pull request directly — outside the
 * stack tooling that keeps that invariant — would orphan its membership rather than move it.
 *
 * @param pr the pull request as GitHub reports it now
 * @param requestedBase the base branch the caller asked to retarget onto
 * @returns the decision, with a reason naming why when it does not proceed
 */
export function retargetDecisionFor({ pr, requestedBase }: { pr: WrittenPr; requestedBase: string }): RetargetDecision {
  if (requestedBase === pr.head.ref) {
    return {
      kind: "refused",
      reason:
        `the requested base (${requestedBase}) is #${String(pr.number)}'s own head branch — a pull request ` +
        "cannot target itself",
    };
  }
  if (requestedBase === pr.baseRef) {
    return { kind: "noop", reason: `#${String(pr.number)} already targets ${requestedBase}` };
  }
  if (pr.stack !== undefined) {
    return {
      kind: "refused",
      reason:
        `#${String(pr.number)} is entry ${String(pr.stack.position)}/${String(pr.stack.size)} of native stack ` +
        `#${String(pr.stack.number)} — retargeting it directly would orphan that stack membership. Remove it ` +
        "from the stack first (stack remove --pr) or adjust the stack itself (stack push/sync/adopt) rather " +
        "than retargeting this pull request alone",
    };
  }
  return { kind: "proceed" };
}

/**
 * Re-check, inside the door, that nothing this write's decisions depended on has moved.
 *
 * Narrower than `./updateCore.ts`'s `updateFreshnessFor` — this write never touches the body or title, so
 * only what could invalidate the foreign-author check, the no-op/orphan decision and the address itself is
 * compared: the number, the author, the open/closed state, the live base (another actor could have already
 * retargeted it), and the head commit — the same reason `pr update` compares it: a gold proof anchor is
 * checked by CI against the real head SHA, and a force-push inside this window would leave that anchor
 * looking valid here and reading red in CI.
 *
 * @param previewed the pull request as read when the decision was made
 * @param current the pull request as read again inside the door
 * @returns whether the write may proceed, with the field that moved when it may not
 */
export function retargetFreshnessFor({ previewed, current }: { previewed: WrittenPr; current: WrittenPr }): Freshness {
  const moved: readonly { readonly what: string; readonly same: boolean }[] = [
    { same: previewed.number === current.number, what: "the pull-request number" },
    { same: previewed.authorId === current.authorId, what: "the author" },
    { same: previewed.state.toLowerCase() === current.state.toLowerCase(), what: "the open/closed state" },
    { same: previewed.baseRef === current.baseRef, what: "the base branch" },
    { same: previewed.head.sha === current.head.sha, what: "the head commit" },
  ];
  const changed = moved.find((entry) => !entry.same);
  if (changed === undefined) {
    return { fresh: true };
  }
  return {
    fresh: false,
    reason: `${changed.what} changed between reading this pull request and writing to it, so nothing was sent. Re-run to work from the current state`,
  };
}

/**
 * The external-write door request for one exact pull-request retarget.
 *
 * @param args the parsed repository, number and requested base
 * @param home the Slopweaver state home whose door records the write
 * @returns the exact external-write request admitted by the door
 */
export function retargetDoorRequest({ args, home }: { args: GithubPrRetargetArgs; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "pr retarget" },
    artifact: { base: args.base, id: `${args.owner}/${args.repo}#${String(args.number)}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

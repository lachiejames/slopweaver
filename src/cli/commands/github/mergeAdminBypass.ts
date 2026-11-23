/**
 * The BYPASS half of `github merge --admin`'s preflight: whether the administrator bypass exists on the base at all,
 * read from the base's classic protection and the viewer's permission. Split from `./mergeAdminCore.ts`, which
 * composes it with the review and required-context halves; pure, like that module.
 *
 * Classic protection has three answers here (`../../../corpus/github/protectionRead.ts`): a protected base, whose
 * `enforce_admins` decides whether a bypass exists; an unprotected one (GitHub's 404); and one the repository's plan
 * cannot protect at all (GitHub's plan-gated 403). The last two need no bypass, and each says so in its own words.
 */
import { planCannotProtectNote } from "../../../corpus/github/protectionRead.js";
import type { BranchProtection } from "../../../corpus/github/write.js";

/** One half of the preflight's verdict — what it printed, and what it refused. */
export interface PreflightHalf {
  readonly notes: readonly string[];
  readonly refusals: readonly string[];
}

/**
 * Whether the administrator bypass is available at all — the protection's own shape, and the permission it
 * needs.
 *
 * The permission is only required when there is actually a gate to bypass. On an unprotected base, or one its plan
 * cannot protect, the merge is ordinary, so demanding admin would refuse work nothing was stopping.
 *
 * @param baseRef the branch being merged into
 * @param isAdmin whether the authenticated viewer holds admin permission
 * @param protection the base branch's classic protection state
 * @param repo the `owner/name` slug, named so a wrong-repository invocation is obvious
 * @param ruleGoverned whether a review rule stands, which is what makes an `unprotected` answer misleading
 * @returns the half's notes and refusals
 */
export function bypassOutcome({
  baseRef,
  isAdmin,
  protection,
  repo,
  ruleGoverned,
}: {
  baseRef: string;
  isAdmin: boolean;
  protection: BranchProtection;
  repo: string;
  ruleGoverned: boolean;
}): PreflightHalf {
  if (protection.kind === "unprotected") {
    return {
      notes: ruleGoverned
        ? []
        : [`${baseRef} carries no branch protection, so this merge needs no bypass — --admin changes nothing here.`],
      refusals: [],
    };
  }
  if (protection.kind === "plan-unavailable") {
    return {
      notes: [
        `${planCannotProtectNote({ branch: baseRef })}: this merge needs no bypass — --admin changes nothing here.`,
      ],
      refusals: [],
    };
  }
  const permission = isAdmin
    ? []
    : [
        `--admin needs ADMIN permission on ${repo}, and the configured token does not hold it. Push or maintain ` +
          "is not enough: bypassing branch protection is admin-only. Ask the owner to merge, or to grant admin.",
      ];
  if (protection.enforceAdmins) {
    return {
      notes: [],
      refusals: [
        `branch protection on ${baseRef} has enforce_admins=true, so an administrator has NO bypass to use. ` +
          "This merge needs an approving review that satisfies the protection, or the protection changed — " +
          "neither is something --admin can do.",
        ...permission,
      ],
    };
  }
  return {
    notes: [
      `${baseRef} is protected with enforce_admins=false — the administrator bypass is the merge path this ` +
        "configuration leaves open, and this invocation is taking it deliberately.",
    ],
    refusals: permission,
  };
}

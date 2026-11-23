/**
 * The shape a pull-request title must take on a repository whose shape is known. Pure.
 *
 * A title is a conventional commit. The kind of change comes first, then on a ticketed repository the Linear ticket in round
 * brackets, a colon, and the outcome the pull request is after — `dx(ABC-840): …`, never a square-bracket ticket
 * as the first thing a reader sees. On slopweaver the same readability holds but a Linear id would make no sense,
 * so its scope, when there is one, names an area.
 *
 * Which repositories are ticketed is the install's own convention, so it is `profile.json`'s
 * `github.titleShapes`, never this file's. This build's own repository is the one shape the code owns, found by
 * the organisation's derived self repository rather than by name.
 *
 * Whether the words after the colon name an outcome rather than a mechanism is a judgement no pattern can make,
 * so the reference carries that half; this file holds the half a pattern can.
 */

import type { RepositoryTitleShape } from "../../profileProviders.js";

/** The conventional-commit kinds a title may open with, `dx` included because the owner names it. */
const KINDS = ["build", "chore", "ci", "docs", "dx", "feat", "fix", "perf", "refactor", "revert", "style", "test"];

/** One Linear ticket id: `ABC-840`. */
const TICKET = "[A-Z][A-Z0-9]*-\\d+";

/** `kind(TICKET[, TICKET]): outcome`, an optional `!` for a breaking change. */
const TICKETED = new RegExp(`^(?:${KINDS.join("|")})\\(${TICKET}(?:, ${TICKET})*\\)!?: \\S`, "u");

/** `kind: outcome` or `kind(area): outcome`, the area lowercase so a ticket id cannot pass as one. */
const AREA_ONLY = new RegExp(`^(?:${KINDS.join("|")})(?:\\([a-z][a-z0-9 /-]*\\))?!?: \\S`, "u");

/**
 * A Linear ticket id anywhere in a title, which a repository with no tickets refuses. The identifiers a title
 * legitimately names in the same shape (an advisory, a hash or encoding, a standard) are not tickets.
 */
const TICKET_ANYWHERE = new RegExp(`\\b(?!(?:CVE|GHSA|SHA|UTF|ISO|RFC|TLS|ES)-)${TICKET}\\b`, "u");

/** The rule one repository's titles follow. */
interface TitleRule {
  readonly pattern: RegExp;
  /** Whether the repository's titles carry Linear tickets; one that does not refuses a ticket id anywhere. */
  readonly ticketed: boolean;
  readonly shape: string;
  readonly example: string;
}

/** A ticketed repository's rule: the install names which repositories take it. */
const TICKETED_RULE: TitleRule = {
  example: "dx(ABC-840): show the integration suite's logs when a test fails",
  pattern: TICKETED,
  shape: "kind(TICKET): outcome, the Linear ticket in round brackets, several as (ABC-1071, XYZ-7327)",
  ticketed: true,
};

/** This build's own repository's rule, which the code owns. */
const SELF_RULE: TitleRule = {
  example: "feat(pr-body): the risk badge says why it is low",
  pattern: AREA_ONLY,
  shape: "kind: outcome or kind(area): outcome, with no Linear ticket anywhere in it",
  ticketed: false,
};

/** Every shape an install may name, as the rule it selects. */
const RULE_OF_SHAPE: Readonly<Record<RepositoryTitleShape, TitleRule>> = { ticketed: TICKETED_RULE };

/** Which repositories' titles are judged, and how: this build's own, and the ones the install names. */
export interface TitleShapePolicy {
  /** This build's own `owner/repo`, lowercased, as the organisation derives it. */
  readonly selfRepository: string;
  /** The install's own repositories' shapes, keyed lowercase `owner/repo` (`profile.json` `github.titleShapes`). */
  readonly repositoryShapes: Readonly<Record<string, RepositoryTitleShape>>;
}

/**
 * The rule a repository's titles follow under a policy, or undefined when they are not judged. A shape the install
 * names wins, its own repository included: the self rule is the default where it says nothing.
 */
function ruleFor({ policy, slug }: { policy: TitleShapePolicy; slug: string }): TitleRule | undefined {
  const shape = policy.repositoryShapes[slug];
  if (shape !== undefined) {
    return RULE_OF_SHAPE[shape];
  }
  if (slug === policy.selfRepository.toLowerCase()) {
    return SELF_RULE;
  }
  return undefined;
}

/**
 * Why a title is refused on a repository, or undefined when it has the shape (or the repository has no rule).
 *
 * @param title the title about to be written
 * @param owner the repository owner
 * @param repo the repository name
 * @param policy which repositories are judged, and by which shape
 * @returns the refusal naming the shape and an example, or undefined
 */
export function titleShapeRefusal({
  title,
  owner,
  repo,
  policy,
}: {
  title: string;
  owner: string;
  repo: string;
  policy: TitleShapePolicy;
}): string | undefined {
  const rule = ruleFor({ policy, slug: `${owner}/${repo}`.toLowerCase() });
  if (rule === undefined || (rule.pattern.test(title) && (rule.ticketed || !TICKET_ANYWHERE.test(title)))) {
    return undefined;
  }
  return (
    `the title "${title}" is not a conventional commit in this repository's shape: ${rule.shape}. ` +
    `The kind is one of ${KINDS.join(", ")}, and the words after the colon say the outcome the change is after, ` +
    `e.g. "${rule.example}"`
  );
}

/**
 * The refusal a write meets: the shape is judged only when the title is being SET — a create, or an update that
 * changes it. An update that leaves an older title alone (a body re-render, a Renovate body rewrite) is not held
 * hostage to a title nobody is touching.
 *
 * @param title the title the write sends
 * @param liveTitle the title live on GitHub, undefined on a create
 * @param owner the repository owner
 * @param repo the repository name
 * @param policy which repositories are judged, and by which shape
 * @returns the refusal, or undefined
 */
export function titleWriteRefusal({
  title,
  liveTitle,
  owner,
  repo,
  policy,
}: {
  title: string;
  liveTitle: string | undefined;
  owner: string;
  repo: string;
  policy: TitleShapePolicy;
}): string | undefined {
  if (liveTitle === title) {
    return undefined;
  }
  return titleShapeRefusal({ owner, policy, repo, title });
}

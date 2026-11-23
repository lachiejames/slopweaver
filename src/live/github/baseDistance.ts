/**
 * How far a pull request's head is from its base — the one fact `slopweaver github landing` needed that
 * nothing already fetched could answer.
 *
 * A boot row must carry "mergeable state and whether the branch is behind its
 * base". Mergeability GitHub already publishes on the fleet node; distance it does not.
 *
 * ## Which side is which, and why it is asked this way round
 *
 * GitHub's `Ref.compare(headRef:)` treats the ref it is called ON as the BASE. So the query asks the BASE
 * branch to compare itself against the HEAD, and reads `behindBy` as the commits the base has that the head
 * does not — which is exactly "the branch is behind its base". Verified against a known-identical pair
 * (`ref("main").compare(headRef: <main's own head>)` answering `aheadBy 0, behindBy 0, IDENTICAL`) before
 * anything was built on it.
 *
 * It cannot ride inside the fleet's own `PR_NODE_SELECTION`: `compare` takes an argument, and a GraphQL
 * argument holds a literal or an operation variable, never the result of the sibling `headRefName` field.
 * One alias per pull request in one request is the shape that remains, and `./aliasedFleetRead.ts` carries
 * its cost measurement and its split-on-failure rule.
 *
 * ## It is read by BRANCH, so it describes the branch's current tip
 *
 * `compare` takes ref NAMES, so the answer is about whatever the head branch points at when the request is
 * made — not necessarily the `headOid` the fleet read judged, if the branch moved between the two. That is
 * deliberate rather than overlooked, and it is safe only because the distance GATES NOTHING: no landing test
 * reads it, no verdict is refused for it, and the one verdict that cites it says "it is N commit(s) behind
 * <base>" about the branch or says the distance was not read. A Codex review asked for it to be pinned to a
 * commit the way `./mergeableRecheck.ts` is; pinning matters there because mergeability DECIDES a test, and
 * here it would buy a stale number over a current one.
 *
 * ## Distance is CONTEXT, never a seventh landing test
 *
 * MEASURED over a few dozen open pull requests: one pull request read `press` at **hundreds behind** while
 * another read `press` at **0 behind**, because a merge queue tests the branch merged with the current base
 * and rebases it. So a row prints the distance and a dispatch verdict may cite it; nothing here holds a pull
 * request back for being behind. Reproduce with `slopweaver github landing --repo acme/acme-admin
 * --author <login> --json` and compare each row's `baseDistance` against its `action`.
 */

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type AliasedAnswer, aliasedFleetRead } from "./aliasedFleetRead.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadGraphql } from "./read.js";

/** The pull request one comparison names, in the three fields the query needs. *
 * @internal the shape {@link BaseDistanceRead} accepts; every caller passes a `PrLiveState`.
 */
export interface BaseDistanceSubject {
  readonly repoSlug: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  /**
   * The repository the head branch lives in, so a FORK's head is not resolved in the base repository.
   *
   * `compare(headRef:)` resolves a bare branch name inside the repository it is called on, so a fork pull
   * request would be compared against whatever branch of that name the BASE repository happens to hold — an
   * unrelated one, or none. GitHub accepts a cross-repository head as `owner:branch`, so the ref is qualified
   * exactly when the head lives in a DIFFERENT repository from the base — a same-repository head stays bare,
   * which is what it has always been and what the whole fleet is. A Codex review found the hole. The empty
   * string also leaves it bare, which is the only thing available when GitHub reported no head repository.
   */
  readonly headRepoSlug: string;
}

/** One answered comparison, in GitHub's own terms. *
 * @internal read through {@link BaseDistance}, which is what a consumer holds.
 */
export interface BaseDistanceReading {
  /** Commits the head has that the base does not. */
  readonly aheadBy: number;
  /** Commits the BASE has that the head does not — "how far behind its base the branch is". */
  readonly behindBy: number;
  /**
   * GitHub's own `ComparisonStatus` token — `AHEAD`, `BEHIND`, `DIVERGED` or `IDENTICAL`.
   *
   * Left as the string GitHub wrote rather than narrowed to a union: the vocabulary belongs to GitHub, and a
   * token this repository has not seen must reach a reader as itself rather than be mapped onto a neighbour.
   */
  readonly status: string;
}

/**
 * How far one head is from its base, or why that was not read.
 *
 * The `unread` arm is not a failure of the run: a base branch deleted since the pull request opened, a head
 * in a fork GitHub will not resolve, or one bad alias in a request are all ordinary, and none of them may
 * become a synthesised `behindBy: 0`, which would read as "up to date".
 */
export type BaseDistance = AliasedAnswer<BaseDistanceReading>;

/** What a pull request reads as before any comparison has been asked for. */
export const DISTANCE_NOT_REQUESTED: BaseDistance = {
  kind: "unread",
  why: "this run asked for no base comparison — only `github landing` does",
};

/** Read the distance for every subject given, in as few requests as the fleet allows. */
export type BaseDistanceRead = (args: { subjects: readonly BaseDistanceSubject[] }) => Promise<readonly BaseDistance[]>;

/**
 * The alias that compares one pull request's base against its head.
 *
 * @param subject the pull request
 * @param index its position, which names the alias and every variable it declares
 * @returns the selection, its variable declarations and their values
 */
function aliasFor({ subject, index }: { subject: BaseDistanceSubject; index: number }): {
  declarations: readonly string[];
  selection: string;
  variables: Readonly<Record<string, unknown>>;
} {
  const [owner = "", repo = ""] = subject.repoSlug.split("/");
  const n = String(index);
  const [headOwner = ""] = subject.headRepoSlug.split("/");
  const head =
    headOwner === "" || subject.headRepoSlug === subject.repoSlug
      ? subject.headRefName
      : `${headOwner}:${subject.headRefName}`;
  return {
    declarations: [`$o${n}: String!`, `$r${n}: String!`, `$b${n}: String!`, `$h${n}: String!`],
    selection:
      `p${n}: repository(owner: $o${n}, name: $r${n}) ` +
      `{ ref(qualifiedName: $b${n}) { compare(headRef: $h${n}) { aheadBy behindBy status } } }`,
    variables: {
      [`b${n}`]: subject.baseRefName,
      [`h${n}`]: head,
      [`o${n}`]: owner,
      [`r${n}`]: repo,
    },
  };
}

/**
 * The comparison one alias came back with, or an error naming what was missing.
 *
 * A null repository, a null ref and a null comparison are all real answers GitHub gives — a base branch that
 * has been deleted, a head in a fork it cannot resolve — and every one of them answers `err` so the caller
 * writes `unread`. None of them may become a synthesised `behindBy: 0`, which would read as "up to date".
 *
 * @param data the whole response document
 * @param index the alias's position
 * @returns the reading
 */
function comparisonAt({ data, index }: { data: unknown; index: number }): Result<BaseDistanceReading, GithubLiveError> {
  const root = isRecord(data) ? data[`p${String(index)}`] : undefined;
  const ref = isRecord(root) ? root["ref"] : undefined;
  const compare = isRecord(ref) ? ref["compare"] : undefined;
  const aheadBy = isRecord(compare) ? compare["aheadBy"] : undefined;
  const behindBy = isRecord(compare) ? compare["behindBy"] : undefined;
  const status = isRecord(compare) ? compare["status"] : undefined;
  if (typeof aheadBy !== "number" || typeof behindBy !== "number" || typeof status !== "string") {
    return err(
      GithubLiveErrors.readFailed({
        cause: undefined,
        message:
          "GitHub answered no comparison for this pull request — its base ref, its head ref or the " +
          "comparison itself came back null",
      }),
    );
  }
  return ok({ aheadBy, behindBy, status });
}

/**
 * Build a distance read bound to one GraphQL seam.
 *
 * @param graphql the credential-aware GraphQL reader
 * @returns the read, which never fails as a whole — an unanswerable pull request answers `unread`
 */
export function makeBaseDistanceRead({ graphql }: { graphql: GithubReadGraphql }): BaseDistanceRead {
  return async ({ subjects }) =>
    aliasedFleetRead<BaseDistanceSubject, BaseDistanceReading>({
      items: subjects,
      read: async ({ items }) => {
        const aliases = items.map((subject, index) => aliasFor({ index, subject }));
        const declarations = aliases.flatMap((alias) => alias.declarations);
        const variables: Record<string, unknown> = {};
        for (const alias of aliases) {
          for (const [name, value] of Object.entries(alias.variables)) {
            variables[name] = value;
          }
        }
        const query = `query SlopweaverBaseDistance(${declarations.join(", ")}) {\n${aliases
          .map((alias) => alias.selection)
          .join("\n")}\n}`;
        const response = await graphql({ query, variables });
        if (response.isErr()) {
          return err(response.error);
        }
        return ok(
          items.map((_, index): AliasedAnswer<BaseDistanceReading> => {
            const reading = comparisonAt({ data: response.value, index });
            return reading.isOk()
              ? { kind: "read", value: reading.value }
              : { kind: "unread", why: reading.error.message };
          }),
        );
      },
    });
}

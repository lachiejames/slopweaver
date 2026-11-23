/**
 * Ask GitHub again for the pull requests whose mergeability it had not computed yet.
 *
 * ## Why this exists at all
 *
 * `PullRequest.mergeable` is three-valued — `MERGEABLE`, `CONFLICTING`, `UNKNOWN` — and GitHub computes it
 * LAZILY: a query for a pull request GitHub has not computed answers `UNKNOWN` and starts the job, which
 * makes a FIRST read the one most likely to get it. If
 * `../../cli/commands/github/reviewStateReport.ts` collapsed everything that was not `CONFLICTING` into
 * `conflicted: false`, so that third answer read as a green all the way through to a landing row's
 * `mergeable` test.
 *
 * MEASURED that day on the owner's own fleet: the first read of the session answered `UNKNOWN` on **16 of
 * 31**, a later read answered it on none, and the `CONFLICTING` count rose from 5 to 8 across the two — so
 * three of the owner's open pull requests were printed as mergeable in a landing run whose very next read called
 * them conflicting. Reproduce by reading `PrLiveState.mergeable` twice over the same fleet query and
 * tallying it.
 *
 * ## Why ONE re-read, and no sleep
 *
 * MEASURED the same day over twenty pull requests nobody had queried, so the answer was genuinely cold
 * (`is:pr is:open -author:<owner> repo:acme/acme-admin`): the cold read answered `UNKNOWN` on **15 of 20**,
 * and a single aliased re-read of just those fifteen, **871 ms** later, resolved **every one**. Two further
 * rounds changed nothing. So one extra round trip is the whole mechanism, a wait would buy nothing, and
 * anything still `UNKNOWN` after it is honestly unknown rather than un-asked. Reproduce with
 * `slopweaver github review-state --repo acme/acme-admin --json | jq '[.pullRequests[].conflict.mergeable] | group_by(.) | map({(.[0]): length}) | add'`
 * over pull requests nobody has queried, run twice, and compare the two `UNKNOWN` counts.
 *
 * Without this the fix to the test would make the boot read useless on exactly the run it exists for: a cold
 * fleet would turn every otherwise-pressable row into `unknown`.
 */

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type AliasedAnswer, aliasedFleetRead } from "./aliasedFleetRead.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadGraphql } from "./read.js";

/** The pull request one re-read names, in the two fields the query needs. *
 * @internal the shape {@link MergeableRecheck} accepts; every caller passes a `PrLiveState`.
 */
export interface MergeableSubject {
  readonly repoSlug: string;
  readonly number: number;
  /**
   * The head the FLEET read saw, so an answer about a different head is refused rather than grafted on.
   *
   * A re-read names a pull request by number, and a pull request's head can move between the two requests.
   * Without this the re-read would write the NEW head's mergeability onto the OLD head's checks, threads and
   * truncation flags — a Codex review found that combination passing all six landing tests over a head whose
   * CI was red. The re-read carries `headRefOid` back and {@link MergeableAnswer} says which head it is about.
   */
  readonly headOid: string;
}

/**
 * GitHub's mergeability for one pull request, with the head it was true of.
 *
 * @internal read through {@link MergeableRecheck}; the run layer compares its `headOid` and takes the token.
 */
export interface MergeableAnswer {
  readonly mergeable: string;
  /** The head GitHub reported alongside it. Never empty — an answer with no head is refused as `unread`. */
  readonly headOid: string;
}

/** Re-read `mergeable` for every subject given, in as few requests as the fleet allows. */
export type MergeableRecheck = (args: {
  subjects: readonly MergeableSubject[];
}) => Promise<readonly AliasedAnswer<MergeableAnswer>[]>;

/**
 * The alias that asks one pull request for its mergeability.
 *
 * @param subject the pull request
 * @param index its position, which names the alias and every variable it declares
 * @returns the selection, its variable declarations and their values
 */
function aliasFor({ subject, index }: { subject: MergeableSubject; index: number }): {
  declarations: readonly string[];
  selection: string;
  variables: Readonly<Record<string, unknown>>;
} {
  const [owner = "", repo = ""] = subject.repoSlug.split("/");
  return {
    declarations: [`$o${String(index)}: String!`, `$r${String(index)}: String!`, `$n${String(index)}: Int!`],
    selection:
      `p${String(index)}: repository(owner: $o${String(index)}, name: $r${String(index)}) ` +
      `{ pullRequest(number: $n${String(index)}) { mergeable headRefOid } }`,
    variables: { [`n${String(index)}`]: subject.number, [`o${String(index)}`]: owner, [`r${String(index)}`]: repo },
  };
}

/**
 * The token one alias came back with, or an error naming what was missing.
 *
 * An absent repository, an absent pull request or a missing field all answer `err`, so the caller writes
 * `unread` rather than inventing a mergeability GitHub did not state.
 *
 * @param data the whole response document
 * @param index the alias's position
 * @returns GitHub's own `mergeable` token and the head it was true of
 */
function tokenAt({ data, index }: { data: unknown; index: number }): Result<MergeableAnswer, GithubLiveError> {
  const root = isRecord(data) ? data[`p${String(index)}`] : undefined;
  const pullRequest = isRecord(root) ? root["pullRequest"] : undefined;
  const mergeable = isRecord(pullRequest) ? pullRequest["mergeable"] : undefined;
  const headOid = isRecord(pullRequest) ? pullRequest["headRefOid"] : undefined;
  if (typeof mergeable !== "string" || mergeable === "") {
    return err(
      GithubLiveErrors.readFailed({
        cause: undefined,
        message: "the re-read carried no `mergeable` for this pull request",
      }),
    );
  }
  // An answer with no head cannot be PINNED, and an unpinnable answer is worse than none: an earlier draft
  // read a missing head as the empty string and let the caller treat that as "compatible with whatever we
  // judged", which is exactly the graft the head field exists to stop. A Codex review found it, and the test
  // written alongside it had blessed the permissive payload as expected.
  if (typeof headOid !== "string" || headOid === "") {
    return err(
      GithubLiveErrors.readFailed({
        cause: undefined,
        message: "the re-read carried no head for this pull request, so its mergeability cannot be pinned to one",
      }),
    );
  }
  return ok({ headOid, mergeable });
}

/**
 * Build a re-read bound to one GraphQL seam.
 *
 * @param graphql the credential-aware GraphQL reader
 * @returns the re-read, which never fails as a whole — an unanswerable pull request answers `unread`
 */
export function makeMergeableRecheck({ graphql }: { graphql: GithubReadGraphql }): MergeableRecheck {
  return async ({ subjects }) =>
    aliasedFleetRead<MergeableSubject, MergeableAnswer>({
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
        const query = `query SlopweaverMergeableRecheck(${declarations.join(", ")}) {\n${aliases
          .map((alias) => alias.selection)
          .join("\n")}\n}`;
        const response = await graphql({ query, variables });
        if (response.isErr()) {
          return err(response.error);
        }
        return ok(
          items.map((_, index): AliasedAnswer<MergeableAnswer> => {
            const token = tokenAt({ data: response.value, index });
            return token.isOk() ? { kind: "read", value: token.value } : { kind: "unread", why: token.error.message };
          }),
        );
      },
    });
}

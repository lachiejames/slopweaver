/**
 * Releases, reduced to the one question the close half asks of them: has this repository shipped since a
 * ticket's work finished?
 *
 * ## Why a Merged ticket is not automatically a close
 *
 * A ticket that sits in Merged but still counts as open work is likely waiting on the job that automatically
 * moves tickets from Merged to Done in Linear, which only runs around release time. So most of these are
 * handled automatically without intervention, though sometimes they are not.
 *
 * So a ticket that merged an hour ago and sits in `Merged` is not waiting on the owner, it is waiting on a job.
 * Proposing a close on it is the already-done friction class: measured across the owner's own twelve reviewed
 * rows, five were dismissed with reason `already-done`, and the design memo puts the same failure at
 * 41% for the tool this replaces. A ticket that has sat through a release and is STILL in `Merged` is the
 * opposite: the job has run and missed it, which is exactly the case worth the owner's attention.
 *
 * MEASURED on the real corpus, over the 119 tickets standing in `Merged`
 * (`slopweaver cycle reconcile --json`, and the corpus scan in this module's own test): 25 had seen no
 * release since, so this rule holds them back, and 94 had seen one or more and still show. Roughly one in
 * five of the rows this class would have produced were a job's work rather than the owner's.
 *
 * Pure: the caller supplies the instants.
 */

/** A repository's release instants, ascending, keyed by `owner/name`. */
export type ReleaseInstants = ReadonlyMap<string, readonly string[]>;

/** What a repository's release history can tell us about one ticket. */
export type ReleaseVerdict = "shipped-since" | "none-since" | "no-release-history";

/**
 * Whether the repositories a ticket's work touched have shipped since that work finished.
 *
 * `no-release-history` is deliberately distinct from `none-since`, and the caller must not collapse them.
 * A repository nobody publishes releases for can never satisfy this rule, so treating its silence as
 * "not shipped yet" would hide every one of its tickets forever — the failure this repository already
 * names elsewhere as absence never meaning done. Only `none-since` is evidence that a release is genuinely
 * still pending.
 *
 * @param repos the repositories the ticket's own attached pull requests live in
 * @param releases every repository's release instants
 * @param sinceIso the instant the ticket's work finished, which releases must be later than
 * @returns which of the three states this ticket is in
 */
export function releaseVerdict({
  repos,
  releases,
  sinceIso,
}: {
  repos: readonly string[];
  releases: ReleaseInstants;
  sinceIso: string;
}): ReleaseVerdict {
  const known = repos.map((repo) => releaseHistoryOf({ releases, repo })).filter((instants) => instants.length > 0);
  if (known.length === 0) {
    return "no-release-history";
  }
  const shipped = known.some((instants) => instants.some((instant) => instant > sinceIso));
  return shipped ? "shipped-since" : "none-since";
}

/**
 * One repository's release instants. The release scan keys a repository only on its first release, so one
 * absent from the map has published none the corpus holds — an empty history, never a failed read.
 */
function releaseHistoryOf({ releases, repo }: { releases: ReleaseInstants; repo: string }): readonly string[] {
  const instants = releases.get(repo);
  if (instants === undefined) {
    return [];
  }
  return instants;
}

/**
 * The newest release instant across a set of repositories, for saying how current the evidence is.
 *
 * @param repos the repositories to consider
 * @param releases every repository's release instants
 * @returns the latest instant seen, or undefined when none of them has any release at all
 */
export function newestReleaseAcross({
  repos,
  releases,
}: {
  repos: readonly string[];
  releases: ReleaseInstants;
}): string | undefined {
  const instants = repos.flatMap((repo) => [...releaseHistoryOf({ releases, repo })]);
  return instants.length === 0 ? undefined : instants.reduce((a, b) => (a > b ? a : b));
}

/**
 * The repositories a ticket's own work trail points at.
 *
 * @param urls every attachment URL on the ticket, pull request or not
 * @returns `owner/name` for each GitHub pull-request URL, deduped, in first-seen order
 */
export function reposOfAttachments({ urls }: { urls: readonly string[] }): readonly string[] {
  const repos = new Set<string>();
  for (const url of urls) {
    const matched = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+$/.exec(url);
    if (matched !== null) {
      repos.add(matched[1]!);
    }
  }
  return [...repos];
}

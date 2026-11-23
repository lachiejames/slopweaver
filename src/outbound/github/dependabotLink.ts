/**
 * The ONE construction of a Dependabot alert citation, so no caller ever writes the path by hand.
 *
 * ## The defect this exists to make unrepresentable
 *
 * An alert number and a pull-request number are both small integers in the same repository, and the two
 * paths differ by one segment. Writing the alert number with a hash as prose is worse than writing nothing: `../linkify/bareRefs.ts`
 * resolves a bare `#N` and builds `https://github.com/<owner>/<repo>/issues/<N>` for it, so the reference
 * that was meant to cite an advisory silently becomes a link to an unrelated issue or pull request — a valid
 * link node no later gate inspects. MEASURED against the real exported functions: the text
 * `"Closes Dependabot alert"` followed by a hash and a number scans to a `githubRef` and resolves to
 * an `issues` URL for that number. Nothing is wrong at the wire; the reader simply follows it to the
 * wrong object.
 *
 * So the number never becomes prose. A caller supplies the alert NUMBER, and {@link dependabotAlertLink}
 * returns a finished `link` run whose URL this module owns. The wrong path is not "discouraged" — there is
 * no code path that produces it.
 *
 * `../../corpus/github/dependabot.ts` also carries GitHub's own `htmlUrl` for every alert it reads, and that
 * is the better citation when an alert has actually been read. This module is for the case where only the
 * number is in hand — composing a pull-request body from alert numbers a human or a form supplied.
 */
import type { Inline } from "./types.js";

/** The path segment that distinguishes an alert from an issue or a pull request of the same number. */
const ALERT_PATH = "security/dependabot";

/**
 * Whether a URL addresses a Dependabot alert rather than an issue or pull request of the same number.
 *
 * Exported so a schema can REFUSE a hand-supplied citation that points at the wrong object, rather than
 * trusting that whoever wrote it knew the difference.
 *
 * @param url the URL to test
 * @returns true when the URL's path names GitHub's own Dependabot alert view
 */
export function isDependabotAlertUrl({ url }: { url: string }): boolean {
  return url.includes(`/${ALERT_PATH}/`);
}

/**
 * The citation URL for one Dependabot alert.
 *
 * @param owner the repository owner
 * @param repo the repository name
 * @param number the alert's own number, as `github vuln list` prints it — never a pull-request number
 * @returns GitHub's own page for that alert
 */
export function dependabotAlertUrl({ owner, repo, number }: { owner: string; repo: string; number: number }): string {
  return `https://github.com/${owner}/${repo}/${ALERT_PATH}/${String(number)}`;
}

/**
 * One alert number as a finished link run for a pull-request body.
 *
 * The label is `#<n>` because that is what a reader recognises; it is safe HERE and unsafe as prose,
 * precisely because this run is already a link and so is never re-scanned for bare references.
 *
 * @param owner the repository owner
 * @param repo the repository name
 * @param number the alert's own number
 * @returns the link run citing that alert
 */
export function dependabotAlertLink({ owner, repo, number }: { owner: string; repo: string; number: number }): Inline {
  return { kind: "link", text: `#${String(number)}`, url: dependabotAlertUrl({ number, owner, repo }) };
}

/**
 * Every alert number as link runs, comma-separated, for one cell of a pull-request body.
 *
 * @param owner the repository owner
 * @param repo the repository name
 * @param numbers the alert numbers this pull request closes, in the order they should read
 * @returns the runs, with `, ` separators between them — an empty list yields no runs at all
 */
export function dependabotAlertLinks({
  owner,
  repo,
  numbers,
}: {
  owner: string;
  repo: string;
  numbers: readonly number[];
}): readonly Inline[] {
  return numbers.flatMap((number, index) => {
    const link = dependabotAlertLink({ number, owner, repo });
    return index === 0 ? [link] : [{ kind: "text", text: ", " }, link];
  });
}

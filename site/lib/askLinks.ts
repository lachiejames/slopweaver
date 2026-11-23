/**
 * How a pull request reads as a label, and where its diff lives — for the record line naming a pull request the
 * ask's question never does, and the diff link on every pull request's hover card.
 *
 * A module rather than a helper inside `../components/console/CitationChip.tsx` for one mechanical reason: the
 * unit lane (`config/vitest/unit.ts`) collects `site/__tests__/unit/**` and does not transform `.tsx`, so
 * a rule living in a component is a rule no test can reach. `./queueCard.ts` is the same split for the
 * same reason — the component decides where a derived string sits, and the derivation is tested here.
 *
 * Imports nothing. Pure: a URL in, a label out.
 */

/** A GitHub pull-request URL, as `slopweaver handover list --json` publishes one. */
const PULL_REQUEST = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/([0-9]+)/;

/**
 * How a pull-request URL reads on the card: `owner/repo#number`, never the whole URL.
 *
 * A URL this does not recognise is shown WHOLE rather than shortened by guess — a record line draws what
 * the verb published, and a label invented for an unfamiliar shape would be the console composing one
 * (`AGENTS.md` rule 2).
 *
 * @param url the published link
 * @returns the label
 */
export function prLabel({ url }: { url: string }): string {
  const match = PULL_REQUEST.exec(url);
  if (match === null) {
    return url;
  }
  return `${match[1]}/${match[2]}#${match[3]}`;
}

/**
 * Where a pull request's DIFF lives, for the link beside its label.
 *
 * A card links to the pull request's diff: the conversation tab answers what was
 * said about a change, the files tab answers what the change IS, and a card asking the owner to judge work is judged
 * on the second. A URL this does not recognise as a pull request has no diff to name, so it gets none rather
 * than a guessed suffix.
 *
 * @param url the published link
 * @returns the pull request's `/files` address, or `undefined` when the URL is not a pull request
 */
export function prDiffUrl({ url }: { url: string }): string | undefined {
  const match = PULL_REQUEST.exec(url);
  if (match === null) {
    return undefined;
  }
  return `${match[0]}/files`;
}

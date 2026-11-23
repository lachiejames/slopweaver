/**
 * How a number, a repository word, a Linear key or a Slack link resolves to one address against what the row carries
 * — split out of `./inlineCitations.ts`, whose reference reader resolves with these.
 */

import { citedAddress } from "./citationDisplay";
import { ISSUE_BASE, ISSUE_URL, LINEAR_ADDRESS, LINEAR_URL, PR_BASE, PR_URL } from "./inlineCitationsPatterns";
import type { CardReferences, InlineSegment, Resolvable } from "./inlineCitationsReferences";
import { bareFits, hashedFits, labelAgrees, withoutLeadingZeros } from "./referenceSpellings";

/**
 * The one carried address for a number standing alone, when the number reads as one of its repository's pull
 * requests ({@link bareFits}); `undefined` when no one address claims it or it does not fit.
 *
 * @param url the one carried address claiming the number, when exactly one does
 * @returns the address, or `undefined`
 */
export function carriedBareUrl({
  number,
  url,
  attested,
}: {
  number: string;
  url: string | undefined;
  attested: ReadonlyMap<string, number>;
}): string | undefined {
  const repo = url === undefined ? null : PR_BASE.exec(url);
  if (repo === null) {
    return undefined;
  }
  if (!bareFits({ attested, number, repo: `${repo[1]}/${repo[2]}` })) {
    return undefined;
  }
  return url;
}

/**
 * The address for a number the row's sentences name with no address: the home repository's when the number fits
 * it, else the ONE repository the row's own words name (`CardReferences.named`) that it fits, else — when the row
 * has a home and names no other repository at all — the ONE other attested repository a board row checks out
 * (`CardReferences.checkouts`) that it fits, never a placeholder another row's prose quoted. A bare `#<number>` on a card whose checkout is slopweaver,
 * attested to four digits, and whose evidence says `acme/acme-admin` is acme-admin's; `16406 open` on a
 * slopweaver ask that never spells acme-admin is acme-admin's, because no other repository on the board runs to
 * five digits. Two repositories it fits, at either step, is a guess between them,
 * so words.
 *
 * @param number the digits as written
 * @param hashed whether a `#` came before them, which {@link hashedFits} reads rather than {@link bareFits}
 * @param spelledPull whether a PR word named them, so one digit is enough
 * @param references what the row knows beyond its addresses
 * @returns the address, or `undefined`
 */
export function numberUrl({
  number,
  hashed,
  spelledPull = false,
  references,
}: {
  number: string;
  hashed: boolean;
  spelledPull?: boolean;
  references: CardReferences;
}): string | undefined {
  const { attested, checkouts, home, named } = references;
  const fits = ({ repo, unattested }: { repo: string; unattested: boolean }): boolean => {
    if (hashed) {
      return hashedFits({ attested, number, repo, spelledPull, unattested });
    }
    return bareFits({ attested, number, repo });
  };
  if (home !== undefined && fits({ repo: home, unattested: true })) {
    return `https://github.com/${home}/pull/${number}`;
  }
  const foreign = named.filter((repo) => repo.toLowerCase() !== home?.toLowerCase());
  let others = foreign.filter((repo) => fits({ repo, unattested: false }));
  if (home !== undefined && foreign.length === 0) {
    // A checkout nothing attests fits nothing, so this is every attested checkout the number fits.
    others = [...checkouts].filter((repo) => repo !== home.toLowerCase() && fits({ repo, unattested: false }));
  }
  if (others.length !== 1) {
    return undefined;
  }
  return `https://github.com/${others[0]}/pull/${number}`;
}

/**
 * Whether the words before a number name the row's home repository — `acme-admin`, or `acme/acme-admin` with
 * its owner — compared without case.
 *
 * @param word the words before the number
 * @param home the row's repository, `owner/repo`
 * @returns whether they name it
 */
export function namesHome({ word, home }: { word: string; home: string | undefined }): boolean {
  if (home === undefined) {
    return false;
  }
  const written = word.toLowerCase().split("/");
  const [owner = "", repo = ""] = home.toLowerCase().split("/");
  if (repo !== written.at(-1)) {
    return false;
  }
  return written.length === 1 || owner === written[0];
}

/**
 * The address of pull request `number` in the ONE attested repository other than home that `word` names —
 * `acme-admin 1234` on a slopweaver-backed card — when the number could be one of its own ({@link hashedFits}), so the
 * explicitly named repository links where the bare `#<number>` already did. `slopweaver
 * 17564` beside a slopweaver attested to four digits does not fit, and stays words.
 *
 * @param word the words before the number
 * @param number the digits as written
 * @param lookups what a bare reference resolves against
 * @returns the address, or `undefined`
 */
export function namedRepositoryUrl({
  word,
  number,
  lookups,
}: {
  word: string;
  number: string;
  lookups: Resolvable;
}): string | undefined {
  const { references } = lookups;
  const repos = [...references.attested.keys()].filter(
    (repo) => repo !== references.home?.toLowerCase() && namesHome({ home: repo, word }),
  );
  const repo = repos.length === 1 ? repos.at(0) : undefined;
  const fits = repo !== undefined && hashedFits({ attested: references.attested, number, repo, unattested: false });
  return fits ? `https://github.com/${repo}/pull/${number}` : undefined;
}

/**
 * A Linear key's address off the install's workspace, when its team is one the install knows.
 *
 * @param key the key as written — `QQQQ-134`
 * @param references what the row knows beyond its addresses
 * @returns the address, or `undefined`
 */
export function linearKeyUrl({ key, references }: { key: string; references: CardReferences }): string | undefined {
  const { linearWorkspace } = references;
  const [team = ""] = key.split("-");
  if (linearWorkspace === undefined || !references.linearTeamKeys.includes(team)) {
    return undefined;
  }
  return `https://linear.app/${linearWorkspace}/issue/${key}`;
}

/**
 * The pull request an address names, without its tab or fragment.
 *
 * @param url a pull-request address, possibly with a tab or fragment
 * @returns the pull request's own address, or `undefined` when the URL is not one
 */
export function prBase({ url }: { url: string }): string | undefined {
  const match = PR_BASE.exec(url);
  if (match === null) {
    return undefined;
  }
  return match[0];
}

/**
 * Keep the values exactly ONE address claims, because `#N` beside two repositories' N is a guess either way.
 *
 * @param pairs each key beside the address it came from
 * @returns key to address, unambiguous keys only
 */
function unambiguous({ pairs }: { pairs: readonly (readonly [string, string])[] }): ReadonlyMap<string, string> {
  // Compared without case, first spelling kept: GitHub and Linear both serve one object under any case, so
  // `…/Acme/acme-admin/pull/N` beside `…/acme/acme-admin/pull/N` is one address, not two.
  const seen = new Map<string, Map<string, string>>();
  for (const [key, address] of pairs) {
    let addresses = seen.get(key);
    if (addresses === undefined) {
      addresses = new Map<string, string>();
      seen.set(key, addresses);
    }
    if (!addresses.has(address.toLowerCase())) {
      addresses.set(address.toLowerCase(), address);
    }
  }
  const out = new Map<string, string>();
  for (const [key, addresses] of seen) {
    if (addresses.size !== 1) {
      continue;
    }
    for (const only of addresses.values()) {
      out.set(key, only);
    }
  }
  return out;
}

/**
 * Every pull-request, issue and Linear address a sentence spells out — what a part of it read on its own (a link's
 * label, a spelling before an address) still resolves against, so `[#N](…)` beside `…/pull/N` links.
 *
 * @returns the addresses, in the order of the three patterns
 */
export function addressesIn({ text }: { text: string }): readonly string[] {
  return [
    ...[...text.matchAll(PR_URL)].map((match) => match[0]),
    ...[...text.matchAll(LINEAR_URL)].map((match) => match[0]),
    ...[...text.matchAll(ISSUE_URL)].map((match) => match[0]),
  ];
}

/**
 * What a bare reference in `text` can resolve against: the addresses the text names itself and the ones the row
 * carries beyond it.
 *
 * @param known the addresses the row carries beyond this text
 * @param references what the row knows beyond its addresses
 * @returns the lookups
 */
export function resolvable({
  text,
  known,
  references,
}: {
  text: string;
  known: readonly string[];
  references: CardReferences;
}): Resolvable {
  const urls = [...addressesIn({ text }), ...known];
  const prPairs: (readonly [string, string])[] = [];
  const issuePairs: (readonly [string, string])[] = [];
  const keyPairs: (readonly [string, string])[] = [];
  for (const url of urls) {
    const pull = PR_BASE.exec(url);
    if (pull !== null) {
      // The number is what follows the match's last slash, so no capture group is indexed.
      prPairs.push([withoutLeadingZeros({ spelled: pull[0].slice(pull[0].lastIndexOf("/") + 1) }), pull[0]]);
      continue;
    }
    const issue = ISSUE_BASE.exec(url);
    if (issue !== null) {
      issuePairs.push([withoutLeadingZeros({ spelled: issue[0].slice(issue[0].lastIndexOf("/") + 1) }), issue[0]]);
      continue;
    }
    const linear = new RegExp(`^${LINEAR_ADDRESS}`, "u").exec(url);
    const key = linear?.groups?.["lKey"]?.toUpperCase();
    if (linear !== null && key !== undefined) {
      // The issue without its title slug, which Linear copies with or without — so both spellings of one issue
      // agree rather than read as two addresses disputing the key.
      // Compared without case: Linear also serves `/issue/exa-2` for `EXA-2`.
      const path = `/issue/${key}`;
      const at = linear[0].toUpperCase().indexOf(path.toUpperCase());
      keyPairs.push([withoutLeadingZeros({ spelled: key }), linear[0].slice(0, at + path.length)]);
    }
  }
  return {
    bases: [...unambiguous({ pairs: prPairs.map(([, base]) => [base.toLowerCase(), base] as const) }).values()],
    issues: [...unambiguous({ pairs: issuePairs.map(([, base]) => [base.toLowerCase(), base] as const) }).values()],
    claimed: new Set([...prPairs, ...issuePairs, ...keyPairs].map(([claim]) => claim)),
    keys: unambiguous({ pairs: keyPairs }),
    numbers: unambiguous({ pairs: [...prPairs, ...issuePairs] }),
    pulls: unambiguous({ pairs: prPairs }),
    pullClaimed: new Set(prPairs.map(([claim]) => claim)),
    references,
  };
}

/**
 * Every address a written `[owner/]repo N` names: the row's addresses for exactly that repository and number,
 * compared without case because GitHub's are case-insensitive.
 *
 * @param word the words before the number — `acme-admin`, or `acme/acme-admin`
 * @param number the number, its leading zeros already dropped
 * @param bases every pull-request address the row carries, or every issue address
 * @returns the matching addresses, in the order carried
 */
export function repoMatches({
  word,
  number,
  bases,
}: {
  word: string;
  number: string;
  bases: readonly string[];
}): string[] {
  const written = word.toLowerCase().split("/");
  return bases.filter((base) => {
    const [, owner = "", repo = "", n = ""] = (PR_BASE.exec(base) ?? ISSUE_BASE.exec(base))!;
    if (withoutLeadingZeros({ spelled: n }) !== number || repo.toLowerCase() !== written.at(-1)) {
      return false;
    }
    return written.length === 1 || owner.toLowerCase() === written[0];
  });
}

/**
 * The one address a written `[owner/]repo N` names, when the row carries exactly one for it.
 *
 * @param word the words before the number — `acme-admin`, or `acme/acme-admin`
 * @param number the number as written
 * @param bases every pull-request address the row carries, or every issue address
 * @returns the address, or `undefined` when none or more than one matches
 */
export function repoNumbered({
  word,
  number,
  bases,
}: {
  word: string;
  number: string;
  bases: readonly string[];
}): string | undefined {
  const matches = repoMatches({ bases, number, word });
  if (matches.length !== 1) {
    return undefined;
  }
  return matches[0];
}

/**
 * Slack's `<URL|label>` as one chip under its own label when the address is a pull request or a Linear issue — a
 * bare `<URL>` takes the label the address alone would — `"words"` when the label names a different pull request
 * or ticket, which {@link resolveInline} draws as the label then the address's own chip
 * ({@link markupApart}). Any other site's `<URL|label>` is one chip under its label unless that label names a pull
 * request or ticket, which is `"words"` the same way, and a bare `<URL>` of one is a chip named by where it points.
 *
 * @param url the address inside the brackets
 * @param label what follows its `|`, when anything does
 * @param teamKeys the install's Linear teams, which decide whether a label's `PR-41` is a ticket
 * @param carriedKeys the Linear keys the row's addresses name, upper-cased
 * @returns the segment, `"words"`, or `undefined`
 */
export function slackMarkup({
  url,
  label,
  teamKeys,
  carriedKeys,
}: {
  url: string;
  label: string | undefined;
  teamKeys: readonly string[];
  carriedKeys: ReadonlySet<string>;
}): InlineSegment | "words" | undefined {
  const pull = PR_BASE.exec(url);
  const issue = new RegExp(`^${LINEAR_ADDRESS}$`, "u").exec(url)?.groups?.["lKey"]?.toUpperCase();
  let own: string | undefined;
  if (pull !== null) {
    own = `#${pull[3]}`;
  } else if (issue !== undefined) {
    own = issue;
  }
  if (own === undefined) {
    // Another site's link is one chip under its own words — the Slack thread a card replies in, the Vanta control
    // it names — and a bare one is named by where it points, since every integration is cited. A label naming a
    // pull request or ticket is never that chip's label, which would read as #N: it is "words", drawn beside the
    // address's own chip.
    if (label === undefined) {
      return { kind: "cite", label: citedAddress({ url }).place, url };
    }
    if (!labelAgrees({ carriedKeys, label, own: "", teamKeys })) {
      return "words";
    }
    return { kind: "cite", label, url };
  }
  if (label === undefined) {
    return { kind: "cite", label: own, url };
  }
  if (!labelAgrees({ carriedKeys, label, own, teamKeys })) {
    return "words";
  }
  return { kind: "cite", label, url };
}

/**
 * A Slack or Markdown link's label and its address's own chip, for a link kept as words because the two name
 * different targets.
 *
 * @param groups the match's named capture groups
 * @param references whose Linear team keys {@link slackMarkup} reads
 * @returns the label and the chip the address alone draws, or `undefined` when the match is no such link
 */
export function markupApart({
  groups,
  references,
}: {
  groups: Readonly<Record<string, string | undefined>>;
  references: CardReferences;
}): { label: string; address: Extract<InlineSegment, { kind: "cite" }> } | undefined {
  const { mUrl, mLabel, dUrl, dLabel } = groups;
  const url = [mUrl, dUrl].find((value) => value !== undefined);
  const label = [mLabel, dLabel].find((value) => value !== undefined);
  if (url === undefined || label === undefined) {
    return undefined;
  }
  const address = slackMarkup({
    carriedKeys: new Set(),
    label: undefined,
    teamKeys: references.linearTeamKeys,
    url,
  });
  if (address === undefined || address === "words" || address.kind !== "cite") {
    return undefined;
  }
  return { address, label };
}

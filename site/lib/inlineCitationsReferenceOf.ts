/**
 * The one reference a match over the alternatives names, and the repository predicates only it reads — split out of
 * `./inlineCitations.ts`.
 */

import { citedAddress } from "./citationDisplay";
import { ADDRESS_TRAILING, PR_BASE } from "./inlineCitationsPatterns";
import type { InlineSegment, Resolvable } from "./inlineCitationsReferences";
import {
  carriedBareUrl,
  linearKeyUrl,
  namedRepositoryUrl,
  namesHome,
  numberUrl,
  repoMatches,
  repoNumbered,
  slackMarkup,
} from "./inlineCitationsResolve";
import { localPageSlugOf } from "./localPageHref";
import { citedRecord } from "./recordCitation";
import { hashedFits, spelledCanonically } from "./referenceSpellings";

/**
 * Whether the words before a `PR N` or `#N` name a repository the row's pull requests name — `slopweaver`, or
 * `lachiejames/slopweaver` with its owner — compared without case. Only the row's own repositories are
 * recognised: a word's shape says nothing (`follow-up` and `acme-admin` look alike), so a repository the row
 * carries no address for is not one here, and its `#N` resolves as a bare number would.
 */
function isKnownRepo({ word, bases }: { word: string; bases: readonly string[] }): boolean {
  const written = word.toLowerCase().split("/");
  return bases.some((base) => {
    const [, owner = "", repo = ""] = PR_BASE.exec(base)!;
    if (repo.toLowerCase() !== written.at(-1)) {
      return false;
    }
    return written.length === 1 || owner.toLowerCase() === written[0];
  });
}

/**
 * Whether the words before a number name a repository OTHER than the row's home that the row or the queue knows —
 * one the row carries an address in, or one any row attests a number for.
 *
 * @param word the words before the number
 * @param lookups what a bare reference resolves against
 * @returns whether they name one
 */
function namesOtherRepository({ word, lookups }: { word: string; lookups: Resolvable }): boolean {
  const { references } = lookups;
  if (references.home === undefined || namesHome({ home: references.home, word })) {
    return false;
  }
  if (isKnownRepo({ bases: lookups.bases, word })) {
    return true;
  }
  return [...references.attested.keys()].some((repo) => namesHome({ home: repo, word }));
}

/**
 * The one reference a regular-expression match over {@link ALTERNATIVES} names; `"words"` when the whole match
 * must stay as written; `undefined` when it names nothing and the text inside it is still to be searched.
 *
 * WORDS, whole: one of the row's repositories then `PR N` or `#N` with a number that repository has no pull request
 * for, because the bare number inside it would otherwise link another repository's pull request (`slopweaver #N`
 * beside only acme-admin's N). NOTHING: a `#N` beside an address for a DIFFERENT number, which is never folded into
 * it — that would hide which of the two the sentence meant — so the address is still its own chip and the `#N` is read
 * alone; a bare `#N`, `repo N` or key no address resolves; and a repository the row does not name, whose `#N` is then
 * read on its own.
 *
 * @param groups the match's named capture groups
 * @param written the whole match, the label a spelling that is not rewritten keeps
 * @param lookups what a bare reference resolves against
 * @returns the segment, `"words"`, or `undefined`
 */
export function referenceOf({
  groups,
  written,
  lookups,
}: {
  groups: Readonly<Record<string, string | undefined>>;
  written: string;
  lookups: Resolvable;
}): InlineSegment | "words" | undefined {
  const {
    mUrl,
    mLabel,
    dUrl,
    dLabel,
    vN,
    bN,
    bUrl,
    bUrlN,
    sN,
    sUrl,
    sUrlN,
    uUrl,
    uN,
    lUrl,
    fUrl,
    xUrl,
    wSlug,
    cN,
    cL,
    lKey,
    iOwner,
    iRepo,
    iN,
    oPr,
    oOwner,
    oRepo,
    oN,
    pPr,
    pWord,
    pRepo,
    pN,
    qN,
    gN,
    hN,
    rWord,
    rN,
    kKey,
    kLower,
    nN,
  } = spelledCanonically({ groups });
  const { references } = lookups;
  // A label naming a key the row's addresses carry names that ticket, as it would anywhere else.
  const carriedKeys = new Set([...lookups.keys.keys()].map((key) => key.toUpperCase()));
  const teamKeys = references.linearTeamKeys;
  if (mUrl !== undefined) {
    return slackMarkup({ carriedKeys, label: mLabel, teamKeys, url: mUrl });
  }
  if (dUrl !== undefined) {
    return slackMarkup({ carriedKeys, label: dLabel, teamKeys, url: dUrl });
  }
  if (bUrl !== undefined) {
    if (bN !== bUrlN) {
      // Another pull request's address: a miss, so the address is still its own chip and `#N` is read alone.
      return undefined;
    }
    // Labelled as spelled, so `#0N (…/pull/N)` keeps its zero while it links N.
    return { kind: "cite", label: `#${groups.bN!}`, url: bUrl };
  }
  if (sUrl !== undefined) {
    if (sN !== sUrlN) {
      return undefined;
    }
    return { kind: "cite", label: `#${groups.sN!}`, url: sUrl };
  }
  if (uUrl !== undefined && uN !== undefined) {
    return { kind: "cite", label: `#${uN}`, url: uUrl };
  }
  if (fUrl !== undefined) {
    const url = fUrl.replace(ADDRESS_TRAILING, "");
    const slug = localPageSlugOf({ url });
    // Not a page (another file, another host, an encoded separator): words, whole.
    if (slug === undefined) {
      return "words";
    }
    return { kind: "cite", label: slug, url };
  }
  if (xUrl !== undefined) {
    // Any other address is a citation of whatever its host says it is — a Slack thread, a Vanta control, a
    // Datadog monitor — every integration's address is cited — labelled by where it points,
    // never by words searched for inside it. A sentence's own closing punctuation is not the address's.
    const url = xUrl.replace(ADDRESS_TRAILING, "");
    return { kind: "cite", label: citedAddress({ url }).place, url };
  }
  if (wSlug !== undefined) {
    if (!references.boardSlugs.has(wSlug)) {
      return undefined;
    }
    // A board row has no page to open, so the row's slug reads as words, whole, never searched inside.
    return "words";
  }
  if (cN !== undefined) {
    // A monitor the census never mapped stays words, whole, so its number is never read as a pull request — unless
    // the row carries it, `two Datadog monitors (#N)`, which the scan then reads past the noun.
    if (!references.records.monitors.has(cN) && lookups.numbers.has(cN)) {
      return undefined;
    }
    return citedRecord({ label: written, record: references.records.monitors.get(cN) });
  }
  if (cL !== undefined) {
    // A later id the census never mapped may be no monitor at all — `monitor 50001 and #N fixed it` — so, exactly
    // like a value noun's `#N`, it links through a carried address and is otherwise words.
    const carried = lookups.numbers.get(cL);
    if (references.records.monitors.has(cL) || carried === undefined) {
      return citedRecord({ label: written, record: references.records.monitors.get(cL) });
    }
    return { kind: "cite", label: written, url: carried };
  }
  if (lUrl !== undefined && lKey !== undefined) {
    return { kind: "cite", label: lKey.toUpperCase(), url: lUrl };
  }
  if (iOwner !== undefined && iRepo !== undefined && iN !== undefined) {
    return { kind: "cite", label: written, url: `https://github.com/${iOwner}/${iRepo}/issues/${iN}` };
  }
  if (oOwner !== undefined && oRepo !== undefined && oN !== undefined) {
    const issue =
      oPr === undefined ? repoNumbered({ bases: lookups.issues, number: oN, word: `${oOwner}/${oRepo}` }) : undefined;
    if (issue !== undefined) {
      return { kind: "cite", label: written, url: issue };
    }
    return { kind: "cite", label: written, url: `https://github.com/${oOwner}/${oRepo}/pull/${oN}` };
  }
  if (pRepo !== undefined && pN !== undefined) {
    const spelledPull = pPr !== undefined || pWord !== undefined;
    const issue = spelledPull ? undefined : repoNumbered({ bases: lookups.issues, number: pN, word: pRepo });
    if (issue !== undefined) {
      return { kind: "cite", label: written, url: issue };
    }
    const home = namesHome({ home: references.home, word: pRepo });
    if (!home && !isKnownRepo({ bases: lookups.bases, word: pRepo })) {
      // `slopweaver #N` on an acme-admin card names another repository's number, so the `#N` inside it must
      // never fall through to home.
      // `other-org/infra PR N` names a repository the row does not know, so its number is not the row's.
      const named = namedRepositoryUrl({ lookups, number: pN, word: pRepo });
      if (named !== undefined) {
        return { kind: "cite", label: written, url: named };
      }
      if (namesOtherRepository({ lookups, word: pRepo }) || pRepo.includes("/")) {
        return "words";
      }
      return undefined;
    }
    const url = repoNumbered({ bases: lookups.bases, number: pN, word: pRepo });
    if (url !== undefined) {
      return { kind: "cite", label: written, url };
    }
    const named = home ? undefined : namedRepositoryUrl({ lookups, number: pN, word: pRepo });
    if (named !== undefined) {
      return { kind: "cite", label: written, url: named };
    }
    if (
      home &&
      hashedFits({ attested: references.attested, number: pN, repo: references.home!, spelledPull, unattested: true })
    ) {
      return { kind: "cite", label: written, url: `https://github.com/${references.home!}/pull/${pN}` };
    }
    return "words";
  }
  if (vN !== undefined) {
    const carried = lookups.numbers.get(vN);
    if (carried === undefined) {
      return "words";
    }
    return { kind: "cite", label: written, url: carried };
  }
  let url: string | undefined;
  const hashed = hN ?? qN ?? gN;
  const asKey = `PR-${String(qN)}`;
  if (written.toUpperCase() === asKey && (references.linearTeamKeys.includes("PR") || lookups.claimed.has(asKey))) {
    // `PR-15959`, in any case, is a Linear key when the install has a team `PR` or an address claims it, else a pull
    // request, including a lower-case `pr-15959` beside its carried Linear address.
    const carried = lookups.keys.get(asKey);
    if (carried !== undefined) {
      url = carried;
    } else if (lookups.claimed.has(asKey)) {
      return "words";
    } else {
      url = linearKeyUrl({ key: asKey, references });
    }
  } else if (hashed !== undefined) {
    const spelledPull = hN === undefined;
    const carried = (spelledPull ? lookups.pulls : lookups.numbers).get(hashed);
    if (carried !== undefined) {
      url = carried;
    } else if ((spelledPull ? lookups.pullClaimed : lookups.claimed).has(hashed)) {
      return "words";
    } else {
      url = numberUrl({ hashed: true, number: hashed, references, spelledPull });
    }
  } else if (rWord !== undefined && rN !== undefined) {
    const carried = repoMatches({ bases: [...lookups.bases, ...lookups.issues], number: rN, word: rWord });
    if (carried.length > 1) {
      // Its pull request and an issue of that number both carried: they disagree, so neither is guessed.
      return "words";
    }
    url = carried.at(0);
    const home = namesHome({ home: references.home, word: rWord });
    if (url === undefined && home) {
      // Qualified by home's own name, so it reads like a `#N` — and like one, never past home's attested digits
      // (`acme-admin 123456`).
      if (!hashedFits({ attested: references.attested, number: rN, repo: references.home!, unattested: true })) {
        return "words";
      }
      url = `https://github.com/${references.home!}/pull/${rN}`;
    }
    if (url === undefined && !home) {
      url = namedRepositoryUrl({ lookups, number: rN, word: rWord });
    }
    if (url === undefined && namesOtherRepository({ lookups, word: rWord })) {
      // `slopweaver 1234` on an acme-admin card: the number is another repository's, so it never reads as home's.
      return "words";
    }
  } else if (kKey !== undefined || kLower !== undefined) {
    // A known team's key resolves in any case, exactly as it is reported in any case; `utf-8` names no
    // team, so it still links only through a carried address for `UTF-8`.
    const key = (kKey ?? kLower)!.toUpperCase();
    const carried = lookups.keys.get(key);
    if (carried !== undefined) {
      url = carried;
    } else if (lookups.claimed.has(key)) {
      return "words";
    } else {
      url = linearKeyUrl({ key, references });
    }
    // Not a Linear team's: a printed Vanta control or risk, `HRS-29`, `TTX-2` — spelled in capitals only, so `hrs-29`
    // in prose stays words. A known team's key with no workspace to link
    // it in is still Linear's, and stays words, as is one whose team a carried address names.
    const team = key.split("-")[0];
    const linearTeam =
      references.linearTeamKeys.includes(team) ||
      [...lookups.keys.keys()].some((carriedKey) => carriedKey.startsWith(`${team}-`));
    const printed = kKey === undefined || linearTeam ? undefined : references.records.printed.get(key);
    if (url === undefined && printed !== undefined) {
      return citedRecord({ label: written, record: printed });
    }
  } else if (nN !== undefined) {
    // One carried address for the number wins, when the number reads as one of that address's repository's — so the
    // ISO card's `keep N` beside acme-admin's /pull/N links while `CI 93` beside #N
    // stays words. One the carried addresses claim but disagree on, or whose repository it does not fit, stays words.
    if (lookups.claimed.has(nN)) {
      url = carriedBareUrl({ attested: references.attested, number: nN, url: lookups.numbers.get(nN) });
      if (url === undefined) {
        return "words";
      }
    } else {
      url = numberUrl({ hashed: false, number: nN, references });
    }
  }
  if (url === undefined) {
    return undefined;
  }
  return { kind: "cite", label: written, url };
}
